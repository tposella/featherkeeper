import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createStorage } from '../src/lib/storage.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://featherkeeper:featherkeeper@localhost:5432/featherkeeper_test';

export const fakeEbird = {
  enabled: true,
  async speciesCodesFor(source) {
    if (source.regionCode) {
      const regionCode = source.regionCode.toUpperCase();
      return {
        codes: regionCode === 'CA-AB' ? ['amerob', 'blkchi', 'baleag', 'x00001'] : [],
        summary: { kind: 'region', regionCode, regionName: 'Alberta' },
      };
    }
    // Around Cochrane: two hotspots' worth of species.
    return {
      codes: ['amerob', 'blkchi'],
      summary: {
        kind: 'area',
        latitude: source.latitude,
        longitude: source.longitude,
        radiusKm: source.radiusKm ?? 25,
        hotspotsFound: 2,
        hotspotsUsed: 2,
        topHotspots: [{ name: 'Glenbow Ranch PP', species: 180 }],
        regionCode: 'CA-AB-RV',
        regionName: 'Rocky View County',
      },
    };
  },
  async taxonomy(codes) {
    const all = {
      amerob: ['American Robin', 'Turdus migratorius', 'Thrushes and Allies', 'Turdidae', 'Passeriformes', 30000],
      blkchi: ['Black-capped Chickadee', 'Poecile atricapillus', 'Tits, Chickadees, and Titmice', 'Paridae', 'Passeriformes', 25000],
      baleag: ['Bald Eagle', 'Haliaeetus leucocephalus', 'Hawks, Eagles, and Kites', 'Accipitridae', 'Accipitriformes', 8000],
    };
    return codes
      .filter((c) => all[c])
      .map((c) => {
        const [commonName, scientificName, familyCommon, familyScientific, taxonOrder, taxonSort] = all[c];
        return { ebirdCode: c, commonName, scientificName, familyCommon, familyScientific, taxonOrder, taxonSort };
      })
      .sort((a, b) => a.taxonSort - b.taxonSort);
  },
};

export const fakeGeocoder = {
  enabled: true,
  async search(q) {
    return [{ label: `${q}, Alberta, Canada`, name: q, latitude: 51.19, longitude: -114.47, kind: 'town' }];
  },
};

export const fakeIdentifier = {
  enabled: true,
  provider: 'fake',
  async identify() {
    return [
      { scientificName: 'Turdus migratorius', commonName: 'American Robin', confidence: 0.91 },
      { scientificName: 'Ixoreus naevius', commonName: 'Varied Thrush', confidence: 0.05 },
    ];
  },
};

/** Fresh schema, fresh photo dir, and a running app for each test file. */
export async function setup() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fk-test-'));
  const config = {
    ...loadConfig({}),
    databaseUrl: TEST_DB,
    dataDir,
    allowRegistration: true,
    cookieSecure: false,
    maxUploadMb: 2,
  };
  const db = createDb(TEST_DB);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, { info() {} });
  const storage = createStorage(dataDir);
  await storage.ensureReady();
  const app = await buildApp({
    config,
    db,
    storage,
    ebird: fakeEbird,
    geocoder: fakeGeocoder,
    identifier: fakeIdentifier,
    logger: false,
  });
  await app.ready();

  return {
    app,
    db,
    async teardown() {
      await app.close();
      await db.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** A tiny client that remembers its session cookie, like a browser tab. */
export function client(app) {
  let cookie = '';
  async function call(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof Buffer) {
      payload = body;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await app.inject({ method, url, headers, payload });
    const set = res.headers['set-cookie'];
    if (set) {
      const first = (Array.isArray(set) ? set[0] : set).split(';')[0];
      cookie = first.endsWith('=') ? '' : first;
    }
    let json = null;
    if ((res.headers['content-type'] ?? '').includes('application/json')) json = res.json();
    return { status: res.statusCode, body: json, headers: res.headers, raw: res.rawPayload };
  }
  return {
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body),
    patch: (url, body) => call('PATCH', url, body),
    delete: (url) => call('DELETE', url),
    async upload(url, buffer, filename = 'bird.jpg', type = 'image/jpeg') {
      const boundary = `----fk${Date.now()}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return call('POST', url, Buffer.concat([head, buffer, tail]), {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
    },
  };
}

export async function makeJpeg(width = 640, height = 480) {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}
