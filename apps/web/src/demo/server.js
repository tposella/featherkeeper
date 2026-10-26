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
    area: { label: 'Cochrane', latitude: 51.19, longitude: -114.47, radiusKm: 25 },
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

// A few sample photos marked "want to replace".
[
  [3, 'Soft focus, and the head is turned away', '2026-08-14T18:20:00Z'],
  [20, 'Backlit. Try the morning side of the pond', '2026-09-02T15:05:00Z'],
  [36, '', '2026-10-01T21:40:00Z'],
].forEach(([idx, note, markedAt]) => {
  const s = sightings.find((x) => x.catalogueId === 1 && x.speciesId === species[idx].id);
  const p = s && photos.find((x) => x.sightingId === s.id);
  if (p) p.replace = { note, markedAt };
});

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
    replace: accessFor(c).canEdit ? p.replace ?? null : null,
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
  const chosen = ps.find((p) => p.id === entry.coverPhotoId) ?? null;
  const cover = chosen ?? latest;
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
    status: ps.length ? 'photographed' : 'missing',
    coverUrl: cover ? photoUrls(cover, c).thumb : null,
    coverPhotoId: cover?.id ?? null,
    coverChosen: Boolean(chosen),
    // In a real install this is an openly licensed photo from iNaturalist, stored on the server.
    example: {
      url: placeholderPhoto(species.indexOf(sp) * 3 + 1, 480, 480),
      credit: 'Sample example photo (in a real install: the photographer’s name, from iNaturalist)',
      licence: 'CC BY-NC',
      source: 'iNaturalist',
      page: 'https://www.inaturalist.org',
    },
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
    dexStyle: c.dexStyle ?? 'examples',
    area: c.area ? (showLocations(c) ? c.area : { ...c.area, latitude: null, longitude: null }) : null,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    ownerName: Object.values(USERS).find((u) => u.id === owner.userId).displayName,
    stats: {
      species: dex.length,
      photographed: dex.filter((d) => d.photoCount > 0).length,
      photos: ps.length,
      toReplace: ps.filter((p) => p.replace).length,
    },
    coverUrl: latest ? photoUrls(latest, c).thumb : null,
    access: accessFor(c),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- routes --------------------------------------------------------------------

const routes = [
  ['GET', /^\/config$/, () => ({
    version: __APP_VERSION__,
    registration: 'open',
    allowRegistration: true,
    needsSetup: false,
    maxUploadMb: 100,
    ebirdEnabled: true,
    placeSearchEnabled: true,
    referencePhotosEnabled: true,
    soundsEnabled: true,
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
    for (const k of ['name', 'slug', 'description', 'regionCode', 'visibility', 'hideLocations', 'dexStyle']) {
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

  ['GET', /^\/catalogues\/([\w-]+)\/species$/, ([slug]) => ({ species: dexList(getCatalogue(slug)), examplesPending: 0 })],
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
    if (!sp && body.ebirdCode) sp = species.find((s) => s.ebird_code === body.ebirdCode);
    if (!sp && body.ebirdCode === 'borchi2') {
      sp = { id: newId(), ebird_code: 'borchi2', common_name: 'Boreal Chickadee', scientific_name: 'Poecile hudsonicus',
        family_common: 'Tits, Chickadees, and Titmice', family_scientific: 'Paridae', taxon_order: 'Passeriformes', taxon_sort: 3105 };
      species.push(sp);
    }
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

  ['GET', /^\/places$/, async (m, body, query) => {
    if (!me()) throw new DemoError(401, 'Sign in required');
    await wait(400);
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hotspots = query.get('catalogue')
      ? PLACES.filter((p) => words.every((w) => p.name.toLowerCase().includes(w))).map((p, i) => ({
          name: p.name,
          label: `${190 - i * 23} species recorded, ${(8 + i * 11) % 60} km away`,
          latitude: p.lat,
          longitude: p.lng,
          source: 'hotspot',
          kind: 'hotspot',
        }))
      : [];
    const known = [
      { name: 'Cochrane', label: 'Cochrane, Rocky View County, Alberta, Canada', latitude: 51.1894, longitude: -114.4682 },
      { name: 'Canmore', label: 'Canmore, Bow Valley, Alberta, Canada', latitude: 51.0892, longitude: -115.3593 },
      { name: 'Calgary', label: 'Calgary, Alberta, Canada', latitude: 51.0447, longitude: -114.0719 },
      { name: 'Glenbow Ranch Provincial Park', label: 'Glenbow Ranch Provincial Park, Rocky View County, Alberta, Canada', latitude: 51.1587, longitude: -114.3797 },
      { name: 'Bow River', label: 'Bow River, Alberta, Canada', latitude: 51.0499, longitude: -114.0503 },
    ];
    const map = known
      .filter((p) => words.every((w) => p.label.toLowerCase().includes(w)))
      .map((p) => ({ ...p, source: 'map', kind: 'place' }));
    const places = [...hotspots, ...map];
    // Anything else: pretend it's somewhere near Calgary so the demo still works.
    return { places: places.length ? places : [{ name: query.get('q'), label: `${query.get('q')} (demo location)`, latitude: 51.05, longitude: -114.07, source: 'map', kind: 'place' }] };
  }],
  ['GET', /^\/places\/reverse$/, async (m, body, query) => {
    if (!me()) throw new DemoError(401, 'Sign in required');
    await wait(300);
    const lat = Number(query.get('latitude'));
    const lng = Number(query.get('longitude'));
    let best = null;
    for (const p of PLACES) {
      const d = Math.hypot(p.lat - lat, (p.lng - lng) * Math.cos((lat * Math.PI) / 180)) * 111;
      if (!best || d < best.d) best = { ...p, d };
    }
    if (best && best.d < 1) return { suggestion: { name: best.name, source: 'hotspot' } };
    return { suggestion: { name: best && best.d < 30 ? 'Near ' + best.name.split(',')[0] : 'Somewhere in Alberta', source: 'map' } };
  }],
  ['POST', /^\/ebird\/preview$/, async (m, body) => {
    if (!me()) throw new DemoError(401, 'Sign in required');
    await wait(900);
    const c = body.catalogue ? getCatalogue(body.catalogue) : null;
    const all = [
      ...species.filter((s) => s.ebird_code).map((s) => ({
        ebirdCode: s.ebird_code, commonName: s.common_name, scientificName: s.scientific_name,
        familyCommon: s.family_common, familyScientific: s.family_scientific, taxonOrder: s.taxon_order, taxonSort: s.taxon_sort,
      })),
      ...IMPORTABLE.map(([code, com, sci, famC, famS, order, sort]) => ({
        ebirdCode: code, commonName: com, scientificName: sci, familyCommon: famC, familyScientific: famS, taxonOrder: order, taxonSort: sort,
      })),
    ].sort((a, b) => a.taxonSort - b.taxonSort);
    // A smaller radius finds fewer species, so the demo trims the list.
    const keep = body.regionCode ? all.length : Math.round(all.length * Math.min(1, 0.45 + (body.radiusKm ?? 25) / 50));
    const list = all.slice(0, keep).map((t) => ({
      ...t,
      inCatalogue: Boolean(c && species.some((s) => s.ebird_code === t.ebirdCode && c.dex.has(s.id))),
    }));
    const source = body.regionCode
      ? { kind: 'region', regionCode: body.regionCode, regionName: body.regionCode === 'CA-AB' ? 'Alberta' : body.regionCode }
      : {
          kind: 'area', latitude: body.latitude, longitude: body.longitude, radiusKm: body.radiusKm ?? 25,
          hotspotsFound: 31, hotspotsUsed: 25,
          topHotspots: [{ name: 'Glenbow Ranch PP', species: 187 }, { name: 'Cochrane Ranche', species: 142 }, { name: 'Bow River--Mitford Park', species: 128 }],
          regionCode: 'CA-AB-RV', regionName: 'Rocky View County',
        };
    return { source, species: list };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/import\/ebird$/, async ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    await wait(700);
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
    if (body.latitude !== undefined) {
      c.area = { label: body.areaLabel ?? '', latitude: body.latitude, longitude: body.longitude, radiusKm: body.radiusKm ?? 25 };
    }
    if (!c.regionCode) c.regionCode = body.regionCode ?? 'CA-AB';
    return { added, alreadyPresent: 0, total: added };
  }],

  ['GET', /^\/catalogues\/([\w-]+)\/sightings$/, ([slug], body, query) => {
    const c = getCatalogue(slug);
    const all = sightings
      .filter((s) => s.catalogueId === c.id)
      .sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''));
    const located = query.get('located') === '1';
    if (located && !showLocations(c)) return { locationsHidden: true, total: all.length, sightings: [], nextOffset: null };
    const filtered = located ? all.filter((s) => s.latitude !== null) : all;
    const limit = Number(query.get('limit')) || null;
    const offset = Number(query.get('offset')) || 0;
    const ss = limit ? filtered.slice(offset, offset + limit) : filtered;
    return {
      locationsHidden: !showLocations(c),
      total: all.length,
      nextOffset: limit && ss.length === limit ? offset + limit : null,
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
  ['PATCH', /^\/sightings\/(\d+)$/, async ([id], body) => {
    const s = sightings.find((x) => x.id === Number(id));
    if (!s) throw new DemoError(404, 'Sighting not found');
    const c = getCatalogue(s.catalogueId);
    requireEdit(c);
    await wait(300);
    if ('latitude' in body !== 'longitude' in body || (body.latitude === null) !== (body.longitude === null)) {
      if ('latitude' in body || 'longitude' in body) throw new DemoError(400, 'Give both latitude and longitude, or neither');
    }
    if (body.speciesId !== undefined && !c.dex.has(body.speciesId)) throw new DemoError(400, 'That species is not in this catalogue');
    if (body.speciesId !== undefined && body.speciesId !== s.speciesId) {
      const old = c.dex.get(s.speciesId);
      if (old && photos.some((p) => p.id === old.coverPhotoId && p.sightingId === s.id)) old.coverPhotoId = null;
      s.speciesId = body.speciesId;
    }
    for (const k of ['observedAt', 'latitude', 'longitude', 'locationName', 'notes']) if (k in body) s[k] = body[k];
    return { sighting: serializeSighting(s, c) };
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
  // Account, site admin (0.2): storage, deleting accounts, sign-ups and invites, species names.
  ['GET', /^\/auth\/me\/account$/, () => {
    if (!me()) throw new DemoError(401, 'Sign in required');
    const owned = catalogues.filter((c) => c.members.some((m) => m.userId === me().id && m.role === 'owner'));
    const mine = photos.filter((p) => sightings.find((s) => s.id === p.sightingId && s.createdBy === 'You'));
    return {
      storage: { usedBytes: mine.length * 8_400_000, photos: mine.length, quotaMb: 0 },
      ownedCatalogues: owned.map((c) => ({ slug: c.slug, name: c.name, sightings: sightings.filter((s) => s.catalogueId === c.id).length, photos: 0, otherMembers: c.members.length - 1 })),
    };
  }],
  ['DELETE', /^\/auth\/me$/, () => {
    throw new DemoError(400, 'Accounts can’t be deleted in the demo.');
  }],
  ['GET', /^\/auth\/invite\/(.+)$/, () => ({ valid: true, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() })],
  ['POST', /^\/photo-info$/, () => ({ localDateTime: '', latitude: null, longitude: null, camera: '' })],
  ['POST', /^\/catalogues\/([\w-]+)\/photos\/check$/, () => ({ duplicates: {} })],
  ['GET', /^\/admin\/settings$/, () => {
    if (!me()?.isSiteAdmin) throw new DemoError(403, 'Only the site admin can do that');
    return {
      registration: demo.registration ?? 'invite',
      defaultQuotaMb: demo.defaultQuotaMb ?? 0,
      disk: { totalBytes: 512 * 1024 ** 3, freeBytes: 371 * 1024 ** 3, photosBytes: photos.length * 8_400_000, photos: photos.length },
      taxonomy: {
        ebirdEnabled: true,
        last: demo.taxonomy ?? {
          refreshedAt: '2026-10-01T09:00:00Z',
          checked: species.length,
          updated: [{ ebirdCode: 'x', from: 'Sample old name (Genus oldus)', to: 'Sample new name (Genus novus)', renamed: true }],
          renamed: 1,
          notFound: [],
          conflicts: [],
        },
      },
    };
  }],
  ['PATCH', /^\/admin\/settings$/, (m, body) => {
    if (body.registration) demo.registration = body.registration;
    if (body.defaultQuotaMb !== undefined) demo.defaultQuotaMb = body.defaultQuotaMb;
    return { ok: true };
  }],
  ['POST', /^\/admin\/taxonomy\/refresh$/, async () => {
    await wait(800);
    demo.taxonomy = { refreshedAt: new Date().toISOString(), checked: species.length, updated: [], renamed: 0, notFound: [], conflicts: [] };
    return demo.taxonomy;
  }],
  ['GET', /^\/admin\/invites$/, () => ({ invites: demo.invites ?? [] })],
  ['POST', /^\/admin\/invites$/, (m, body) => {
    demo.invites ??= [];
    const inv = { id: newId(), note: body.note || '', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (body.days ?? 7) * 864e5).toISOString(), usedAt: null, usedBy: null, expired: false };
    demo.invites.unshift(inv);
    return { id: inv.id, url: `${location.origin}${location.pathname}#/register?invite=demo-invite-link`, expiresAt: inv.expiresAt };
  }],
  ['DELETE', /^\/admin\/invites\/(\d+)$/, ([id]) => {
    demo.invites = (demo.invites ?? []).filter((i) => i.id !== Number(id));
    return { ok: true };
  }],
  ['GET', /^\/admin\/users\/(\d+)\/owned$/, ([id]) => ({
    catalogues: catalogues
      .filter((c) => c.members.some((m) => m.userId === Number(id) && m.role === 'owner'))
      .map((c) => ({ slug: c.slug, name: c.name, sightings: sightings.filter((s) => s.catalogueId === c.id).length, photos: 0, otherMembers: c.members.length - 1 })),
  })],
  ['DELETE', /^\/admin\/users\/(\d+)$/, () => {
    throw new DemoError(400, 'Accounts can’t be deleted in the demo.');
  }],
  // Version: in a real install the server checks GitHub for newer releases; the demo shows a sample alert.
  ['GET', /^\/version$/, () => {
    if (!me()?.isSiteAdmin) return { current: __APP_VERSION__, admin: false };
    const [maj, min, pat] = __APP_VERSION__.split('-')[0].split('.').map(Number);
    const next = `${maj}.${min}.${pat + 1}`;
    return {
      admin: true,
      enabled: true,
      current: __APP_VERSION__,
      updateAvailable: true,
      checkedAt: new Date().toISOString(),
      error: null,
      releasesUrl: 'https://github.com/tposella/featherkeeper/releases',
      latest: {
        version: next,
        name: `Featherkeeper ${next}`,
        url: 'https://github.com/tposella/featherkeeper/releases',
        publishedAt: new Date().toISOString(),
        prerelease: false,
        notes: `A sample alert for the demo. In a real install this shows the release notes from GitHub.\n\n### Added\n- Something new\n\n### Fixed\n- Something that was broken`,
      },
    };
  }],
  // Site admin (the demo's "You" is the site admin).
  ['GET', /^\/admin\/users$/, () => {
    if (!me()?.isSiteAdmin) throw new DemoError(me() ? 403 : 401, 'Only the site admin can do that');
    return {
      users: Object.values(USERS).map((u) => ({
        ...u,
        createdAt: '2026-09-01T17:00:00Z',
        lastSignIn: '2026-10-20T15:00:00Z',
        catalogues: catalogues.filter((c) => c.members.some((m) => m.userId === u.id)).length,
        ownedCatalogues: catalogues.filter((c) => c.members.some((m) => m.userId === u.id && m.role === 'owner')).length,
        photos: u.id === 1 ? 52 : 9,
        usedBytes: (u.id === 1 ? 52 : 9) * 8_400_000,
        quotaMb: u.quotaMb ?? null,
        effectiveQuotaMb: u.quotaMb ?? demo.defaultQuotaMb ?? 0,
      })),
    };
  }],
  ['POST', /^\/admin\/users\/(\d+)\/reset-password$/, ([id], body) => {
    if (!me()?.isSiteAdmin) throw new DemoError(403, 'Only the site admin can do that');
    const u = Object.values(USERS).find((x) => x.id === Number(id));
    if (!u) throw new DemoError(404, 'No such user');
    return body?.password ? { email: u.email, password: null, generated: false } : { email: u.email, password: 'kq7m-xr4p-t9ch-w2ne', generated: true };
  }],
  ['PATCH', /^\/admin\/users\/(\d+)$/, ([id], body) => {
    if (!me()?.isSiteAdmin) throw new DemoError(403, 'Only the site admin can do that');
    const u = Object.values(USERS).find((x) => x.id === Number(id));
    if (!u) throw new DemoError(404, 'No such user');
    if ('isSiteAdmin' in body && u.isSiteAdmin && !body.isSiteAdmin && Object.values(USERS).filter((x) => x.isSiteAdmin).length <= 1) {
      throw new DemoError(409, 'The site needs at least one admin');
    }
    if ('isSiteAdmin' in body) u.isSiteAdmin = body.isSiteAdmin;
    if ('quotaMb' in body) u.quotaMb = body.quotaMb;
    return { ok: true };
  }],
  ['PATCH', /^\/photos\/(\d+)$/, ([id], body) => {
    const p = photos.find((x) => x.id === Number(id));
    if (!p) throw new DemoError(404, 'Photo not found');
    const c = getCatalogue(sightings.find((x) => x.id === p.sightingId).catalogueId);
    requireEdit(c);
    if (body.replace === false) p.replace = null;
    else if (body.replace === true || p.replace) {
      p.replace = {
        note: body.replaceNote ?? p.replace?.note ?? '',
        markedAt: p.replace?.markedAt ?? new Date().toISOString(),
      };
    }
    return { photo: serializePhoto(p, c) };
  }],
  ['GET', /^\/catalogues\/([\w-]+)\/to-replace$/, ([slug]) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    const ofSpecies = (speciesId) =>
      photos.filter((p) => sightings.some((s) => s.id === p.sightingId && s.catalogueId === c.id && s.speciesId === speciesId));
    const list = photos
      .filter((p) => p.replace)
      .map((p) => ({ p, s: sightings.find((x) => x.id === p.sightingId) }))
      .filter(({ s }) => s.catalogueId === c.id)
      .sort((a, b) => b.p.replace.markedAt.localeCompare(a.p.replace.markedAt));
    return {
      photos: list.map(({ p, s }) => {
        const sp = species.find((x) => x.id === s.speciesId);
        const same = ofSpecies(s.speciesId);
        return {
          ...serializePhoto(p, c),
          species: { id: sp.id, commonName: sp.common_name, scientificName: sp.scientific_name, taxonSort: sp.taxon_sort },
          sighting: { id: s.id, observedAt: s.observedAt, locationName: s.locationName || '' },
          isCover: c.dex.get(s.speciesId)?.coverPhotoId === p.id,
          newerPhotos: same.filter((x) => x.id !== p.id && x.createdAt > p.replace.markedAt).length,
          speciesPhotoCount: same.length,
        };
      }),
    };
  }],
  ['DELETE', /^\/photos\/(\d+)$/, ([id]) => {
    const p = photos.find((x) => x.id === Number(id));
    if (!p) throw new DemoError(404, 'Photo not found');
    const s = sightings.find((x) => x.id === p.sightingId);
    requireEdit(getCatalogue(s.catalogueId));
    photos.splice(photos.indexOf(p), 1);
    // Every sighting has a photo: removing the last one removes the sighting.
    const last = !photos.some((x) => x.sightingId === s.id);
    if (last) sightings.splice(sightings.indexOf(s), 1);
    return { ok: true, sightingDeleted: last };
  }],
  ['POST', /^\/catalogues\/([\w-]+)\/identify$/, async ([slug], body) => {
    const c = getCatalogue(slug);
    requireEdit(c);
    await wait(1400);
    const lat = Number(body.get?.('latitude'));
    const hasPin = Number.isFinite(lat) && body.get('latitude') !== null;
    const location = hasPin
      ? { source: 'pin', latitude: lat, longitude: Number(body.get('longitude')) }
      : c.area
        ? { source: 'catalogue', latitude: c.area.latitude, longitude: c.area.longitude }
        : null;
    const pick = (code, confidence, nearby) => {
      const sp = species.find((s) => s.ebird_code === code);
      return {
        commonName: sp.common_name, scientificName: sp.scientific_name, ebirdCode: code, confidence,
        speciesId: sp.id, inCatalogue: c.dex.has(sp.id), nearby: location ? nearby : null,
      };
    };
    return {
      provider: 'demo',
      model: 'hf-hub:imageomics/bioclip-2 (demo)',
      location,
      pool: location
        ? { usedLocation: true, candidates: 271, recentNearby: 64, recordedNearby: 263, radiusKm: 25 }
        : { usedLocation: false, candidates: c.dex.size, recentNearby: 0, recordedNearby: 0, radiusKm: 25 },
      suggestions: [
        pick('bkcchi', 0.81, 'recent'),
        pick('mouchi', 0.14, 'area'),
        { commonName: 'Boreal Chickadee', scientificName: 'Poecile hudsonicus', ebirdCode: 'borchi2', confidence: 0.03,
          speciesId: null, inCatalogue: false, nearby: location ? 'elsewhere' : null },
        pick('rebnut', 0.01, 'recent'),
      ],
    };
  }],

  ['GET', /^\/reference$/, async (m, body, query) => {
    await wait(300);
    const sci = query.get('scientificName') ?? '';
    const seed = [...sci].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return {
      photos: [0, 1, 2].map((i) => ({
        thumb: placeholderPhoto(seed + i, 240, 240),
        url: placeholderPhoto(seed + i, 1200, 900),
        medium: placeholderPhoto(seed + i, 800, 600),
        credit: `Sample reference photo ${i + 1} (in a real install: iNaturalist, with the photographer's credit)`,
        licence: 'CC BY-NC',
        source: 'iNaturalist',
        page: 'https://www.inaturalist.org',
      })),
      links: { inaturalist: 'https://www.inaturalist.org', wikipedia: null },
    };
  }],
  ['GET', /^\/catalogues\/([\w-]+)\/season$/, async ([slug], body, query) => {
    const c = getCatalogue(slug);
    await wait(500);
    const current = Number(query.get('current')) || new Date().getMonth() + 1;
    const month = Number(query.get('month')) || current;
    if (!c.area) return { month, currentMonth: current, area: null, sources: {}, species: [], notInCatalogue: [] };
    const dex = dexList(c);
    const daysAgo = (n) => {
      const d = new Date(Date.now() - n * 86400000);
      return `${d.toISOString().slice(0, 10)} 08:${String(10 + n).padStart(2, '0')}`;
    };
    // Pretend summer birds are around May-September and everything else all year.
    const summer = new Set(['rufhum', 'easkin', 'treswa', 'yelwar', 'westan', 'sposan', 'fragul', 'amwpel', 'osprey', 'killde', 'moublu', 'sancra']);
    const winter = new Set(['bohwax', 'comgol', 'goleag']);
    const inSeason = (code) => (summer.has(code) ? month >= 5 && month <= 9 : winter.has(code) ? month <= 3 || month >= 10 : true);
    const species = [];
    dex.forEach((d, i) => {
      if (!d.ebirdCode || !inSeason(d.ebirdCode)) return;
      const nowHit = month === current && i % 3 !== 1;
      species.push({
        ...d,
        plate: i + 1,
        now: nowHit ? { observedAt: daysAgo(i % 9), where: PLACES[i % PLACES.length].name, howMany: 1 + (i % 5) } : null,
        usual: { observations: 8 + ((i * 37) % 140) },
      });
    });
    return {
      month,
      currentMonth: current,
      area: { kind: 'area', label: c.area.label, radiusKm: c.area.radiusKm, regionCode: null },
      sources: { now: month === current ? 'ebird' : null, usual: 'inaturalist', nowError: null, usualError: null },
      species,
      notInCatalogue:
        month === current
          ? [
              { ebirdCode: 'snoowl1', commonName: 'Snowy Owl', scientificName: 'Bubo scandiacus', observedAt: daysAgo(2), where: 'Horse Creek Road' },
              { ebirdCode: 'clanut', commonName: "Clark's Nutcracker", scientificName: 'Nucifraga columbiana', observedAt: daysAgo(6), where: 'Ghost Reservoir' },
            ]
          : [],
    };
  }],
  ['GET', /^\/catalogues\/([\w-]+)\/species\/(\d+)\/sounds$/, async () => {
    await wait(300);
    // A short synthesized chirp so the players work in the demo; real installs play real recordings.
    const chirp = demoChirp();
    const one = (kind, type, where, i) => ({
      url: chirp, kind, type, quality: kind ? 'A' : null, length: '0:02', where,
      credit: `Sample recording ${i} (in a real install: the recordist's name)`, licence: 'CC BY-NC-SA 4.0',
      source: kind ? 'xeno-canto' : 'iNaturalist', page: 'https://xeno-canto.org',
    });
    return {
      provider: 'xeno-canto',
      sounds: [
        one('song', 'song', 'Glenbow Ranch, Alberta, Canada', 1),
        one('call', 'alarm call', 'Fish Creek, Alberta, Canada', 2),
        one('song', 'dawn song', 'Banff, Alberta, Canada', 3),
        one(null, null, 'Cochrane, AB', 4),
      ],
    };
  }],
  ['GET', /^\/catalogues\/([\w-]+)\/species\/(\d+)\/insights$/, async ([slug, id]) => {
    const c = getCatalogue(slug);
    await wait(500);
    const sp = species.find((x) => x.id === Number(id));
    const seed = Number(id);
    const peak = 3 + (seed % 5);
    const months = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(120 * Math.exp(-((i - peak) ** 2) / (2 + (seed % 4)))) + (seed % 3)));
    const hours = Array.from({ length: 24 }, (_, h) => (h < 5 || h > 21 ? 0 : Math.round(20 * Math.exp(-((h - 8 - (seed % 3)) ** 2) / 8) + 6 * Math.exp(-((h - 18) ** 2) / 4))));
    const mine = sightings
      .filter((s) => s.catalogueId === c.id && s.speciesId === sp.id && s.observedAt)
      .map((s) => ({ observedAt: s.observedAt, where: s.locationName }));
    return {
      area: c.area ? { kind: 'area', label: c.area.label, radiusKm: c.area.radiusKm, regionCode: null } : null,
      months,
      hours: { hours, sample: hours.reduce((a, b) => a + b, 0) },
      habitat: {
        text: `Sample habitat text for the ${sp.common_name}. In a real install this is the opening of the habitat section of its Wikipedia article, for example "open woodland, forest edges and lakeshores".`,
        section: 'Distribution and habitat',
        url: 'https://en.wikipedia.org',
        title: sp.common_name,
      },
      reports: [
        { where: PLACES[seed % PLACES.length].name, observedAt: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) + ' 07:45', howMany: 2 },
        { where: PLACES[(seed + 2) % PLACES.length].name, observedAt: new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10) + ' 16:20', howMany: 1 },
      ],
      yours: mine,
      links: { inaturalist: 'https://www.inaturalist.org', ebird: sp.ebird_code ? `https://ebird.org/species/${sp.ebird_code}` : null },
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

let chirpUrl = null;
/** A two-second WAV of three falling chirps, generated once. */
function demoChirp() {
  if (chirpUrl) return chirpUrl;
  const rate = 22050;
  const n = rate * 2;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const k = Math.floor(t / 0.45);
    const local = t - k * 0.45;
    const on = k < 3 && local < 0.22;
    const f = 4200 - local * 9000;
    phase += (2 * Math.PI * f) / rate;
    const env = on ? Math.sin((Math.PI * local) / 0.22) : 0;
    v.setInt16(44 + i * 2, Math.round(env * 0.35 * 32767 * Math.sin(phase)), true);
  }
  chirpUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return chirpUrl;
}
