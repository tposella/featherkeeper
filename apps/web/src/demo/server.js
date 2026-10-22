// An in-memory stand-in for the Featherkeeper API, used only by the demo build.
// It mirrors the real API's responses closely enough to exercise every screen.
// Changes last until the page is reloaded.

import { reactive } from 'vue';
import { IMPORTABLE, LOGGED_ONLY, PHOTOGRAPHED, PLACES, placeholderPhoto, SPECIES } from './data.js';

export const demo = reactive({ viewAs: 'owner' }); // 'owner' | 'editor' | 'visitor'

const USERS = {
  owner: { id: 1, email: 'you@example.com', displayName: 'You', isSiteAdmin: true },
  editor: { id: 2, email: 'sam@example.com', displayName: 'Sam', isSiteAdmin: false },
};

const species = SPECIES.map((s) => ({ ...s }));
let nextId = 1000;
const newId = () => (nextId += 1);

const catalogues = [
  {
    id: 1,
    slug: 'bow-valley',
    name: 'Bow Valley birds',
    description: 'Everything I photograph between Banff and Calgary.',
    regionCode: 'CA-AB',
    visibility: 'public',
    hideLocations: false,
    createdAt: '2025-03-02T17:00:00Z',
    members: [
      { userId: 1, role: 'owner', addedAt: '2025-03-02T17:00:00Z' },
      { userId: 2, role: 'editor', addedAt: '2025-06-11T17:00:00Z' },
    ],
    dex: new Map(species.map((s) => [s.id, { notes: '', coverPhotoId: null }])),
  },
  {
    id: 2,
    slug: 'frank-lake-shorebirds',
    name: 'Frank Lake shorebirds',
    description: 'A spring project with Sam.',
    regionCode: 'CA-AB',
    visibility: 'members',
    hideLocations: true,
    createdAt: '2026-04-20T17:00:00Z',
    members: [
      { userId: 2, role: 'owner', addedAt: '2026-04-20T17:00:00Z' },
      { userId: 1, role: 'editor', addedAt: '2026-04-21T17:00:00Z' },
    ],
    dex: new Map([0, 3, 9, 10, 11, 12, 14, 15].map((i) => [species[i].id, { notes: '', coverPhotoId: null }])),
  },
  {
    id: 3,
    slug: 'garden-feeder',
    name: 'Garden feeder',
    description: '',
    regionCode: null,
    visibility: 'private',
    hideLocations: true,
    createdAt: '2026-09-01T17:00:00Z',
    members: [{ userId: 1, role: 'owner', addedAt: '2026-09-01T17:00:00Z' }],
    dex: new Map([22, 30, 33, 39, 40, 42].map((i) => [species[i].id, { notes: '', coverPhotoId: null }])),
  },
];

const sightings = [];
const photos = [];

function seed() {
  const day = 24 * 3600 * 1000;
  const start = Date.parse('2025-04-01T15:00:00Z');
  let n = 0;
  const add = (catalogueId, speciesIdx, withPhotos) => {
    const place = PLACES[(speciesIdx * 3 + n) % PLACES.length];
    const s = {
      id: newId(),
      catalogueId,
      speciesId: species[speciesIdx].id,
      observedAt: new Date(start + ((speciesIdx * 37 + n * 11) % 560) * day + (n % 9) * 3600 * 1000).toISOString(),
      latitude: place.lat + ((n % 7) - 3) * 0.004,
      longitude: place.lng + ((n % 5) - 2) * 0.006,
      locationName: place.name,
      notes: speciesIdx % 4 === 0 ? 'Foraging along the water’s edge with a small group.' : '',
      createdBy: n % 5 === 0 ? 'Sam' : 'You',
      createdAt: new Date(start + n * day).toISOString(),
    };
    sightings.push(s);
    n += 1;
    for (let p = 0; p < withPhotos; p += 1) {
      photos.push({
        id: newId(),
        sightingId: s.id,
        seed: speciesIdx * 3 + p,
        width: 6000,
        height: 4000,
        takenAt: s.observedAt,
        camera: 'Canon EOS R7',
        lens: 'RF100-500mm F4.5-7.1 L IS USM',
        exif: { focalLength: 500, fNumber: 7.1, exposureTime: 1 / 1600, iso: 800 },
        originalName: `IMG_${4000 + photos.length}.JPG`,
        createdAt: s.observedAt,
      });
    }
  };
  for (const i of PHOTOGRAPHED) {
    add(1, i, 1 + (i % 3));
    if (i % 4 === 0) add(1, i, 0);
  }
  for (const i of LOGGED_ONLY) add(1, i, 0);
  for (const i of [0, 9, 10, 15]) add(2, i, 1);
  add(2, 11, 0);
  for (const i of [30, 33]) add(3, i, 1);
}
seed();

// ---- helpers -------------------------------------------------------------------

class DemoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function me() {
  return demo.viewAs === 'visitor' ? null : USERS[demo.viewAs];
}

function accessFor(c) {
  const user = me();
  const role = user ? c.members.find((m) => m.userId === user.id)?.role ?? null : null;
  const admin = Boolean(user?.isSiteAdmin);
  return {
    role,
    canView: c.visibility === 'public' || (user && c.visibility === 'members') || Boolean(role) || admin,
    canEdit: role === 'owner' || role === 'editor' || admin,
    canManage: role === 'owner' || admin,
  };
}

function getCatalogue(ref) {
  const c = catalogues.find((x) => x.slug === ref || x.id === ref);
  if (!c || !accessFor(c).canView) throw new DemoError(404, 'Catalogue not found');
  return c;
}

function requireEdit(c) {
  if (!me()) throw new DemoError(401, 'Sign in required');
  if (!accessFor(c).canEdit) throw new DemoError(403, 'Only the owner and editors can change this catalogue');
}
function requireManage(c) {
  if (!me()) throw new DemoError(401, 'Sign in required');
  if (!accessFor(c).canManage) throw new DemoError(403, 'Only the catalogue owner can do that');
}

const showLocations = (c) => !c.hideLocations || accessFor(c).canEdit;

function photoUrls(p, c) {
  return {
    thumb: p.blobUrl ?? placeholderPhoto(p.seed, 480, 480),
    display: p.blobUrl ?? placeholderPhoto(p.seed, 1200, 900),
    original: showLocations(c) ? p.blobUrl ?? placeholderPhoto(p.seed, 1200, 900) : null,
  };
}

function serializePhoto(p, c) {
  const loc = showLocations(c);
  const s = sightings.find((x) => x.id === p.sightingId);
  return {
    id: p.id,
    sightingId: p.sightingId,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    camera: p.camera,
    lens: p.lens,
    latitude: loc ? s?.latitude ?? null : null,
    longitude: loc ? s?.longitude ?? null : null,
    exif: p.exif,
    originalName: p.originalName,
    sizeBytes: 8_400_000,
    createdAt: p.createdAt,
    urls: photoUrls(p, c),
  };
}

function serializeSighting(s, c) {
  const loc = showLocations(c);
  return {
    id: s.id,
    catalogueId: s.catalogueId,
    speciesId: s.speciesId,
    observedAt: s.observedAt,
    latitude: loc ? s.latitude : null,
    longitude: loc ? s.longitude : null,
    locationName: s.locationName,
    notes: s.notes,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
  };
}

function dexEntry(c, speciesId) {
  const sp = species.find((s) => s.id === speciesId);
  const entry = c.dex.get(speciesId);
  const ss = sightings.filter((s) => s.catalogueId === c.id && s.speciesId === speciesId);
  const ps = photos.filter((p) => ss.some((s) => s.id === p.sightingId));
  const dates = ss.map((s) => s.observedAt).filter(Boolean).sort();
  const latest = [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const cover = ps.find((p) => p.id === entry.coverPhotoId) ?? latest;
  return {
    id: sp.id,
    ebirdCode: sp.ebird_code,
    commonName: sp.common_name,
    scientificName: sp.scientific_name,
    familyCommon: sp.family_common,
    familyScientific: sp.family_scientific,
    taxonOrder: sp.taxon_order,
    taxonSort: sp.taxon_sort,
    notes: entry.notes,
    addedAt: c.createdAt,
    sightingCount: ss.length,
    photoCount: ps.length,
    firstObserved: dates[0] ?? null,
    lastObserved: dates.at(-1) ?? null,
    status: ps.length ? 'photographed' : ss.length ? 'logged' : 'missing',
    coverUrl: cover ? photoUrls(cover, c).thumb : null,
  };
}

function dexList(c) {
  return [...c.dex.keys()]
    .map((id) => dexEntry(c, id))
    .sort((a, b) => (a.taxonSort ?? 1e9) - (b.taxonSort ?? 1e9) || a.commonName.localeCompare(b.commonName));
}

function serializeCatalogue(c) {
  const dex = dexList(c);
  const ps = photos.filter((p) => sightings.some((s) => s.id === p.sightingId && s.catalogueId === c.id));
  const latest = [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const owner = c.members.find((m) => m.role === 'owner');
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    regionCode: c.regionCode,
    visibility: c.visibility,
    hideLocations: c.hideLocations,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    ownerName: Object.values(USERS).find((u) => u.id === owner.userId).displayName,
    stats: {
      species: dex.length,
      logged: dex.filter((d) => d.sightingCount > 0).length,
      photographed: dex.filter((d) => d.photoCount > 0).length,
      photos: ps.length,
    },
    coverUrl: latest ? photoUrls(latest, c).thumb : null,
    access: accessFor(c),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- routes --------------------------------------------------------------------

const routes = [
  ['GET', /^\/config$/, () => ({
    version: 'demo',
    allowRegistration: true,
    needsSetup: false,
    maxUploadMb: 25,
    ebirdEnabled: true,
    identifyEnabled: true,
  })],
  ['GET', /^\/auth\/me$/, () => ({ user: me() })],
  ['POST', /^\/auth\/(login|register)$/, () => {
    demo.viewAs = 'owner';
    return { user: me() };
  }],
  ['POST', /^\/auth\/logout$/, () => {
    demo.viewAs = 'visitor';
    return { ok: true };
  }],
  ['PATCH', /^\/auth\/me$/, (m, body) => {
    const u = me();
    if (!u) throw new DemoError(401, 'Sign in required');
    if (body.displayName) u.displayName = body.displayName;
    return { user: u };
  }],

  ['GET', /^\/catalogues$/, () => ({
    catalogues: catalogues.filter((c) => accessFor(c).canView).map(serializeCatalogue),
  })],
  ['POST', /^\/catalogues$/, (m, body) => {
    const u = me();
    if (!u) throw new DemoError(401, 'Sign in required');
    const base = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'catalogue';
    let slug = base;
    for (let i = 2; catalogues.some((c) => c.slug === slug); i += 1) slug = `${base}-${i}`;
    const c = {
      id: newId(),
      slug,
      name: body.name,
      description: body.description ?? '',
      regionCode: body.regionCode ?? null,
      visibility: body.visibility ?? 'private',
      hideLocations: false,
      createdAt: new Date().toISOString(),
      members: [{ userId: u.id, role: 'owner', addedAt: new Date().toISOString() }],
      dex: new Map(),
    };
    catalogues.push(c);
    return { catalogue: serializeCatalogue(c) };
  }],
  ['GET', /^\/catalogues\/([\w-]+)$/, ([slug]) => ({ catalogue: serializeCatalogue(getCatalogue(slug)) })],
  ['PATCH', /^\/catalogues\/([\w-]+)$/, ([slug], body) => {
    const c = getCatalogue(slug);
    requireManage(c);
    for (const k of ['name', 'slug', 'description', 'regionCode', 'visibility', 'hideLocations']) {
      if (k in body) c[k] = body[k];
    }
    return { catalogue: serializeCatalogue(c) };
  }],
  ['DELETE', /^\/catalogues\/([\w-]+)$/, ([slug]) => {
    const c = getCatalogue(slug);
    requireManage(c);
    catalogues.splice(catalogues.indexOf(c), 1);
    return { ok: true };
  }],

  ['GET', /^\/catalogues\/([\w-]+)\/species$/, ([slug]) => ({ species: dexList(getCatalogue(slug)) })],
  ['GET', /^\/catalogues\/([\w-]+)\/species\/(\d+)$/, ([slug, id]) => {
    const c = getCatalogue(slug);
    const speciesId = Number(id);
    if (!c.dex.has(speciesId)) throw new DemoError(404, 'That species is not in this catalogue');
    const ss = sightings
      .filter((s) => s.catalogueId === c.id && s.speciesId === speciesId)
      .sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''));
    return {
      entry: dexEntry(c, speciesId),
      sightings: ss.map((s) => ({
        ...serializeSighting(s, c),
        photos: photos.filter((p) => p.sightingId === s.id).map((p) => serializePhoto(p, c)),
      })),
    };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/species$/, ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    let sp = body.speciesId ? species.find((s) => s.id === body.speciesId) : null;
    if (!sp) {
      sp = species.find((s) => s.scientific_name.toLowerCase() === (body.scientificName ?? '').toLowerCase());
    }
    if (!sp) {
      sp = {
        id: newId(),
        ebird_code: null,
        common_name: body.commonName,
        scientific_name: body.scientificName,
        family_common: body.familyCommon ?? null,
        family_scientific: null,
        taxon_order: null,
        taxon_sort: null,
      };
      species.push(sp);
    }
    const added = !c.dex.has(sp.id);
    if (added) c.dex.set(sp.id, { notes: '', coverPhotoId: null });
    return { entry: dexEntry(c, sp.id), added };
  }],
  ['PATCH', /^\/catalogues\/([\w-]+)\/species\/(\d+)$/, ([slug, id], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    const entry = c.dex.get(Number(id));
    if (!entry) throw new DemoError(404, 'That species is not in this catalogue');
    if ('notes' in body) entry.notes = body.notes;
    if ('coverPhotoId' in body) entry.coverPhotoId = body.coverPhotoId;
    return { entry: dexEntry(c, Number(id)) };
  }],
  ['DELETE', /^\/catalogues\/([\w-]+)\/species\/(\d+)$/, ([slug, id]) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    if (sightings.some((s) => s.catalogueId === c.id && s.speciesId === Number(id))) {
      throw new DemoError(409, 'This species has sightings. Delete them first.');
    }
    c.dex.delete(Number(id));
    return { ok: true };
  }],
  ['GET', /^\/species$/, (m, body, query) => {
    const q = (query.get('q') ?? '').toLowerCase();
    return {
      species: species
        .filter((s) => s.common_name.toLowerCase().includes(q) || s.scientific_name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((s) => ({
          id: s.id,
          ebirdCode: s.ebird_code,
          commonName: s.common_name,
          scientificName: s.scientific_name,
          familyCommon: s.family_common,
          familyScientific: s.family_scientific,
          taxonOrder: s.taxon_order,
          taxonSort: s.taxon_sort,
        })),
    };
  }],

  ['POST', /^\/catalogues\/([\w-]+)\/import\/ebird\/preview$/, async ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    await wait(500);
    const all = [
      ...species.filter((s) => s.ebird_code).map((s) => ({
        ebirdCode: s.ebird_code,
        commonName: s.common_name,
        scientificName: s.scientific_name,
        familyCommon: s.family_common,
        familyScientific: s.family_scientific,
        taxonOrder: s.taxon_order,
        taxonSort: s.taxon_sort,
        inCatalogue: c.dex.has(s.id),
      })),
      ...IMPORTABLE.map(([code, com, sci, famC, famS, order, sort]) => ({
        ebirdCode: code,
        commonName: com,
        scientificName: sci,
        familyCommon: famC,
        familyScientific: famS,
        taxonOrder: order,
        taxonSort: sort,
        inCatalogue: species.some((s) => s.ebird_code === code && c.dex.has(s.id)),
      })),
    ].sort((a, b) => a.taxonSort - b.taxonSort);
    return { regionCode: body.regionCode.toUpperCase(), species: all };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/import\/ebird$/, async ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    await wait(600);
    let added = 0;
    for (const code of body.codes ?? []) {
      let sp = species.find((s) => s.ebird_code === code);
      const extra = IMPORTABLE.find((t) => t[0] === code);
      if (!sp && extra) {
        const [, com, sci, famC, famS, order, sort] = extra;
        sp = { id: newId(), ebird_code: code, common_name: com, scientific_name: sci, family_common: famC, family_scientific: famS, taxon_order: order, taxon_sort: sort };
        species.push(sp);
      }
      if (sp && !c.dex.has(sp.id)) {
        c.dex.set(sp.id, { notes: '', coverPhotoId: null });
        added += 1;
      }
    }
    return { added, alreadyPresent: 0, total: added };
  }],

  ['GET', /^\/catalogues\/([\w-]+)\/sightings$/, ([slug]) => {
    const c = getCatalogue(slug);
    const ss = sightings
      .filter((s) => s.catalogueId === c.id)
      .sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''));
    return {
      locationsHidden: !showLocations(c),
      sightings: ss.map((s) => {
        const sp = species.find((x) => x.id === s.speciesId);
        const ps = photos.filter((p) => p.sightingId === s.id);
        return {
          ...serializeSighting(s, c),
          commonName: sp.common_name,
          scientificName: sp.scientific_name,
          photoCount: ps.length,
          thumbUrl: ps[0] ? photoUrls(ps[0], c).thumb : null,
        };
      }),
    };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/sightings$/, ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    const s = {
      id: newId(),
      catalogueId: c.id,
      speciesId: body.speciesId,
      observedAt: body.observedAt ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      locationName: body.locationName ?? '',
      notes: body.notes ?? '',
      createdBy: me().displayName,
      createdAt: new Date().toISOString(),
    };
    sightings.push(s);
    return { sighting: { ...serializeSighting(s, c), photos: [] } };
  }],
  ['DELETE', /^\/sightings\/(\d+)$/, ([id]) => {
    const s = sightings.find((x) => x.id === Number(id));
    if (!s) throw new DemoError(404, 'Sighting not found');
    requireEdit(getCatalogue(s.catalogueId));
    sightings.splice(sightings.indexOf(s), 1);
    for (let i = photos.length - 1; i >= 0; i -= 1) if (photos[i].sightingId === s.id) photos.splice(i, 1);
    return { ok: true };
  }],
  ['POST', /^\/sightings\/(\d+)\/photos$/, async ([id], body) => {
    const s = sightings.find((x) => x.id === Number(id));
    if (!s) throw new DemoError(404, 'Sighting not found');
    const c = getCatalogue(s.catalogueId);
    requireEdit(c);
    await wait(400);
    const file = body.get('file');
    const p = {
      id: newId(),
      sightingId: s.id,
      seed: nextId,
      blobUrl: URL.createObjectURL(file),
      width: null,
      height: null,
      takenAt: s.observedAt,
      camera: null,
      lens: null,
      exif: null,
      originalName: file.name,
      createdAt: new Date().toISOString(),
    };
    photos.push(p);
    return { photo: serializePhoto(p, c) };
  }],
  ['DELETE', /^\/photos\/(\d+)$/, ([id]) => {
    const p = photos.find((x) => x.id === Number(id));
    if (!p) throw new DemoError(404, 'Photo not found');
    const s = sightings.find((x) => x.id === p.sightingId);
    requireEdit(getCatalogue(s.catalogueId));
    photos.splice(photos.indexOf(p), 1);
    return { ok: true };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/identify$/, async ([slug]) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    await wait(900);
    const pick = (code, confidence) => {
      const sp = species.find((s) => s.ebird_code === code);
      return { commonName: sp.common_name, scientificName: sp.scientific_name, confidence, speciesId: sp.id, inCatalogue: c.dex.has(sp.id) };
    };
    return {
      provider: 'demo',
      suggestions: [
        pick('bkcchi', 0.87),
        pick('mouchi', 0.09),
        { commonName: 'Boreal Chickadee', scientificName: 'Poecile hudsonicus', confidence: 0.03, speciesId: null, inCatalogue: false },
      ],
    };
  }],

  ['GET', /^\/catalogues\/([\w-]+)\/members$/, ([slug]) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    const manage = accessFor(c).canManage;
    return {
      members: c.members
        .map((m) => {
          const u = Object.values(USERS).find((x) => x.id === m.userId);
          return { userId: u.id, displayName: u.displayName, email: manage ? u.email : null, role: m.role, addedAt: m.addedAt };
        })
        .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)),
    };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/members$/, () => {
    throw new DemoError(404, 'No account uses that email. Ask them to register first. (In the demo, only Sam exists.)');
  }],
  ['PATCH', /^\/catalogues\/([\w-]+)\/members\/(\d+)$/, ([slug, userId]) => {
    const c = getCatalogue(slug);
    requireManage(c);
    for (const m of c.members) m.role = m.userId === Number(userId) ? 'owner' : 'editor';
    return { ok: true };
  }],
  ['DELETE', /^\/catalogues\/([\w-]+)\/members\/(\d+)$/, ([slug, userId]) => {
    const c = getCatalogue(slug);
    const m = c.members.find((x) => x.userId === Number(userId));
    if (m?.role === 'owner') throw new DemoError(409, 'Transfer ownership before removing the owner');
    c.members = c.members.filter((x) => x.userId !== Number(userId));
    return { ok: true };
  }],
];

/** Handle one API call. Mirrors fetch semantics: resolves with JSON data or rejects with { status, message }. */
export async function demoRequest(method, url, body) {
  await wait(120);
  const [path, qs] = url.split('?');
  const query = new URLSearchParams(qs ?? '');
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const match = path.match(pattern);
    if (match) return handler(match.slice(1), body ?? {}, query);
  }
  throw new DemoError(404, `The demo doesn't implement ${method} ${path}`);
}
