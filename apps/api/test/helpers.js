import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { createExamples } from '../src/lib/examples.js';
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
  async searchHotspots(query) {
    const all = [{ name: 'Glenbow Ranch Provincial Park', latitude: 51.1652, longitude: -114.3824, speciesAllTime: 214, distanceKm: 7.1 }];
    return all.filter((h) => h.name.toLowerCase().includes(query.toLowerCase()));
  },
  async nearestHotspot(latitude) {
    // A hotspot only near the Glenbow Ranch test point.
    return Math.abs(latitude - 51.1652) < 0.01 ? { name: 'Glenbow Ranch Provincial Park', locId: 'L1', distanceKm: 0.3 } : null;
  },
  async recentObservations() {
    return [
      { ebirdCode: 'amerob', commonName: 'American Robin', scientificName: 'Turdus migratorius', observedAt: '2026-10-20 08:15', where: 'Glenbow Ranch PP', howMany: 3 },
      { ebirdCode: 'bohwax', commonName: 'Bohemian Waxwing', scientificName: 'Bombycilla garrulus', observedAt: '2026-10-18 13:02', where: 'Cochrane Ranche', howMany: 40 },
    ];
  },
  async speciesReports() {
    return [{ where: 'Glenbow Ranch PP', observedAt: '2026-10-20 08:15', howMany: 3 }];
  },
  async recentSpeciesNear() {
    return ['amerob']; // a robin was reported nearby this month
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
  lastNear: null,
  async search(q, language, near) {
    fakeGeocoder.lastNear = near ?? null;
    return [{ label: `${q}, Alberta, Canada`, name: q, latitude: 51.19, longitude: -114.47, kind: 'town' }];
  },
  async reverse(latitude) {
    return latitude > 0 ? { name: 'Cochrane', label: 'Cochrane, Rocky View County, Alberta, Canada' } : null;
  },
};

export const fakeInat = {
  enabled: true,
  async monthlySpecies() {
    return [
      { scientificName: 'Poecile atricapillus', commonName: 'Black-capped Chickadee', observations: 42 },
      { scientificName: 'Turdus migratorius', commonName: 'American Robin', observations: 10 },
    ];
  },
  async taxonId() {
    return { id: 12727, wikipediaUrl: 'https://en.wikipedia.org/wiki/American_robin' };
  },
  async monthHistogram() {
    return [1, 1, 5, 30, 60, 55, 50, 40, 30, 12, 3, 1];
  },
  async hourHistogram() {
    const hours = new Array(24).fill(0);
    hours[7] = 12;
    hours[8] = 10;
    hours[17] = 6;
    return { hours, sample: 28 };
  },
};

export const fakeWikipedia = {
  enabled: true,
  async habitat() {
    return { text: 'Breeds in woodland, gardens and parks.', section: 'Habitat', url: 'https://en.wikipedia.org/wiki/American_robin#Habitat', title: 'American robin' };
  },
};

export const fakeSounds = {
  enabled: true,
  provider: 'inaturalist',
  lastNear: undefined,
  async forSpecies(name, near) {
    fakeSounds.lastNear = near;
    return [
      { url: 'https://static.example/sounds/1.mp3', kind: null, type: null, where: 'Cochrane, AB', credit: '(c) Ann', licence: 'CC BY-NC', source: 'iNaturalist', page: 'https://www.inaturalist.org/observations/1' },
    ];
  },
};

export const fakeIdentifier = {
  enabled: true,
  provider: 'fake',
  usesCandidates: true,
  lastCandidates: null,
  async identify(image, mime, { candidates } = {}) {
    fakeIdentifier.lastCandidates = candidates;
    // Pretend the photo looks most like a robin, then a chickadee, then something exotic.
    const pick = (sci) => candidates?.find((c) => c.scientificName.toLowerCase() === sci.toLowerCase());
    const robin = pick('Turdus migratorius');
    const chickadee = pick('Poecile atricapillus');
    return {
      model: 'fake-bioclip',
      predictions: [
        robin && { id: robin.id, scientificName: robin.scientificName, commonName: robin.commonName, confidence: 0.82 },
        chickadee && { id: chickadee.id, scientificName: chickadee.scientificName, commonName: chickadee.commonName, confidence: 0.11 },
        { id: null, scientificName: 'Ixoreus naevius', commonName: 'Varied Thrush', confidence: 0.04 },
      ].filter(Boolean),
    };
  },
};

/** Fresh schema, fresh photo dir, and a running app for each test file. */
/** Reference photos: one for every species except the Bald Eagle, so both outcomes are covered. */
export const fakeReference = {
  enabled: true,
  calls: 0,
  async forSpecies(scientificName) {
    this.calls += 1;
    if (scientificName === 'Haliaeetus leucocephalus') return { photos: [], links: {} };
    return {
      photos: [
        { medium: 'https://example.test/broken.jpg', credit: 'nobody', licence: 'CC BY', source: 'iNaturalist', page: null },
        {
          medium: 'https://example.test/robin.jpg',
          credit: '(c) A. Birder, some rights reserved (CC BY-NC)',
          licence: 'CC BY-NC',
          source: 'iNaturalist',
          page: 'https://www.inaturalist.org/photos/1',
        },
      ],
      links: {},
    };
  },
};

/** Stands in for fetch when downloading example photos: the "broken" URL fails, the rest return a JPEG. */
async function fakeImageFetch(url) {
  if (url.includes('broken')) return { ok: false, status: 404 };
  const buf = await makeJpeg(600, 450);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
}

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
  const examples = createExamples({ db, reference: fakeReference, userAgent: 'test', fetchImpl: fakeImageFetch, pauseMs: 0 });
  const app = await buildApp({
    config,
    db,
    storage,
    ebird: fakeEbird,
    geocoder: fakeGeocoder,
    identifier: fakeIdentifier,
    inat: fakeInat,
    wikipedia: fakeWikipedia,
    sounds: fakeSounds,
    reference: fakeReference,
    examples,
    logger: false,
  });
  await app.ready();

  return {
    app,
    db,
    examples,
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
    async upload(url, buffer, filename = 'bird.jpg', type = 'image/jpeg', fields = {}) {
      const boundary = `----fk${Date.now()}`;
      const fieldParts = Object.entries(fields)
        .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
        .join('');
      const head = Buffer.from(
        `${fieldParts}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return call('POST', url, Buffer.concat([head, buffer, tail]), {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
    },
  };
}

/**
 * An iPhone-style HEIC photo made with libheif's heif-enc, with camera, capture date and GPS
 * written into its EXIF by exiftool (heif-enc doesn't carry EXIF over from the JPEG).
 * Returns null when heif-enc or exiftool isn't installed (the test is then skipped).
 */
export async function makeHeic() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fk-heic-test-'));
  try {
    const jpg = path.join(dir, 'in.jpg');
    const heic = path.join(dir, 'out.heic');
    await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 60 } } })
      .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone 15' }, IFD2: { DateTimeOriginal: '2024:05:18 07:42:10' } })
      .jpeg()
      .toFile(jpg);
    const tool = (cmd, args) =>
      new Promise((resolve, reject) => {
        execFile(cmd, args, (err, stdout, stderr) => {
          if (!err) resolve(true);
          else if (err.code === 'ENOENT') resolve(false);
          else reject(new Error(`${cmd} failed: ${stderr || err.message}`));
        });
      });
    if (!(await tool('heif-enc', ['-q', '50', '-o', heic, jpg]))) return null;
    const tagged = await tool('exiftool', [
      '-q',
      '-overwrite_original',
      '-Make=Apple',
      '-Model=iPhone 15',
      '-DateTimeOriginal=2024:05:18 07:42:10',
      '-GPSLatitude=51.1652',
      '-GPSLatitudeRef=N',
      '-GPSLongitude=114.3824',
      '-GPSLongitudeRef=W',
      heic,
    ]);
    return tagged ? await readFile(heic) : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function makeJpeg(width = 640, height = 480) {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}
