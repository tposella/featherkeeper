import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, makeJpeg, setup } from './helpers.js';

let ctx;
let owner;
let editor;
let stranger;
let anon;
let admin;

before(async () => {
  ctx = await setup();
  admin = client(ctx.app);
  owner = client(ctx.app);
  editor = client(ctx.app);
  stranger = client(ctx.app);
  anon = client(ctx.app);
});
after(async () => ctx.teardown());

describe('accounts', () => {
  test('first account becomes site admin', async () => {
    const cfg = await anon.get('/api/config');
    assert.equal(cfg.body.needsSetup, true);
    const res = await admin.post('/api/auth/register', {
      email: 'Admin@Example.com',
      password: 'correct horse battery',
      displayName: 'Admin',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.isSiteAdmin, true);
    assert.equal(res.body.user.email, 'admin@example.com');
  });

  test('later accounts are not admins', async () => {
    for (const [c, email, name] of [
      [owner, 'owner@example.com', 'Owner'],
      [editor, 'editor@example.com', 'Editor'],
      [stranger, 'stranger@example.com', 'Stranger'],
    ]) {
      const res = await c.post('/api/auth/register', { email, password: 'long enough pw', displayName: name });
      assert.equal(res.status, 201);
      assert.equal(res.body.user.isSiteAdmin, false);
    }
  });

  test('duplicate email and short password are rejected', async () => {
    const dup = await anon.post('/api/auth/register', {
      email: 'owner@example.com',
      password: 'long enough pw',
      displayName: 'X',
    });
    assert.equal(dup.status, 409);
    const short = await anon.post('/api/auth/register', { email: 'a@b.co', password: 'short', displayName: 'X' });
    assert.equal(short.status, 400);
  });

  test('login, me and logout', async () => {
    const c = (await import('./helpers.js')).client(ctx.app);
    const bad = await c.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong password' });
    assert.equal(bad.status, 401);
    const ok = await c.post('/api/auth/login', { email: 'OWNER@example.com', password: 'long enough pw' });
    assert.equal(ok.status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user.displayName, 'Owner');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).body.user, null);
  });
});

describe('catalogue visibility and roles', () => {
  test('owner creates a private catalogue with a generated slug', async () => {
    const res = await owner.post('/api/catalogues', { name: 'Cochrane Backyard', regionCode: 'ca-ab' });
    assert.equal(res.status, 201);
    assert.equal(res.body.catalogue.slug, 'cochrane-backyard');
    assert.equal(res.body.catalogue.visibility, 'private');
    assert.equal(res.body.catalogue.regionCode, 'CA-AB');
    assert.equal(res.body.catalogue.access.role, 'owner');
    const again = await owner.post('/api/catalogues', { name: 'Cochrane Backyard' });
    assert.equal(again.body.catalogue.slug, 'cochrane-backyard-2');
  });

  test('private: only members and site admins can see it', async () => {
    assert.equal((await anon.get('/api/catalogues/cochrane-backyard')).status, 404);
    assert.equal((await stranger.get('/api/catalogues/cochrane-backyard')).status, 404);
    assert.equal((await owner.get('/api/catalogues/cochrane-backyard')).status, 200);
    assert.equal((await admin.get('/api/catalogues/cochrane-backyard')).status, 200);
    const list = await stranger.get('/api/catalogues');
    assert.equal(list.body.catalogues.some((c) => c.slug === 'cochrane-backyard'), false);
  });

  test('members: any signed-in user can view, visitors cannot', async () => {
    const res = await owner.patch('/api/catalogues/cochrane-backyard', { visibility: 'members' });
    assert.equal(res.status, 200);
    assert.equal((await anon.get('/api/catalogues/cochrane-backyard')).status, 404);
    const seen = await stranger.get('/api/catalogues/cochrane-backyard');
    assert.equal(seen.status, 200);
    assert.equal(seen.body.catalogue.access.canEdit, false);
  });

  test('public: logged-out visitors can view but not edit', async () => {
    await owner.patch('/api/catalogues/cochrane-backyard', { visibility: 'public' });
    const res = await anon.get('/api/catalogues/cochrane-backyard');
    assert.equal(res.status, 200);
    assert.equal(res.body.catalogue.access.canEdit, false);
    assert.equal((await anon.post('/api/catalogues/cochrane-backyard/species', { commonName: 'X', scientificName: 'Y z' })).status, 401);
    assert.equal(
      (await stranger.post('/api/catalogues/cochrane-backyard/species', { commonName: 'X', scientificName: 'Y z' })).status,
      403,
    );
  });

  test('owner adds an editor; editor can edit content but not settings', async () => {
    const add = await owner.post('/api/catalogues/cochrane-backyard/members', { email: 'editor@example.com' });
    assert.equal(add.status, 201);
    const missing = await owner.post('/api/catalogues/cochrane-backyard/members', { email: 'nobody@example.com' });
    assert.equal(missing.status, 404);
    const c = await editor.get('/api/catalogues/cochrane-backyard');
    assert.equal(c.body.catalogue.access.role, 'editor');
    assert.equal(c.body.catalogue.access.canEdit, true);
    assert.equal(c.body.catalogue.access.canManage, false);
    assert.equal((await editor.patch('/api/catalogues/cochrane-backyard', { name: 'Hijacked' })).status, 403);
    assert.equal((await editor.post('/api/catalogues/cochrane-backyard/members', { email: 'stranger@example.com' })).status, 403);
    const members = await editor.get('/api/catalogues/cochrane-backyard/members');
    assert.equal(members.body.members.length, 2);
    assert.equal(members.body.members[0].email, null, 'editors do not see emails');
  });

  test('slug changes are validated and must be unique', async () => {
    assert.equal((await owner.patch('/api/catalogues/cochrane-backyard-2', { slug: 'Bad Slug' })).status, 400);
    assert.equal((await owner.patch('/api/catalogues/cochrane-backyard-2', { slug: 'cochrane-backyard' })).status, 409);
  });
});

describe('dex, sightings and photos', () => {
  let robinId;
  let sightingId;
  let photoId;

  test('eBird import from a region adds species in taxonomic order and is idempotent', async () => {
    const preview = await editor.post('/api/ebird/preview', { regionCode: 'ca-ab', catalogue: 'cochrane-backyard' });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.source.regionName, 'Alberta');
    assert.deepEqual(
      preview.body.species.map((s) => s.ebirdCode),
      ['baleag', 'blkchi', 'amerob'],
    );
    const first = await editor.post('/api/catalogues/cochrane-backyard/import/ebird', {
      regionCode: 'CA-AB',
      codes: ['amerob', 'blkchi'],
    });
    assert.equal(first.body.added, 2);
    const all = await editor.post('/api/catalogues/cochrane-backyard/import/ebird', { regionCode: 'CA-AB' });
    assert.equal(all.body.added, 1);
    assert.equal(all.body.alreadyPresent, 2);

    const dex = await anon.get('/api/catalogues/cochrane-backyard/species');
    assert.deepEqual(
      dex.body.species.map((s) => s.commonName),
      ['Bald Eagle', 'Black-capped Chickadee', 'American Robin'],
    );
    assert.ok(dex.body.species.every((s) => s.status === 'missing'));
    robinId = dex.body.species.find((s) => s.ebirdCode === 'amerob').id;
  });

  test('eBird import from a place saves the area on the catalogue', async () => {
    const places = await owner.get('/api/places?q=Cochrane');
    assert.equal(places.status, 200);
    const { latitude, longitude } = places.body.places[0];
    assert.equal((await anon.post('/api/ebird/preview', { latitude, longitude, radiusKm: 15 })).status, 401);
    const preview = await owner.post('/api/ebird/preview', { latitude, longitude, radiusKm: 15 });
    assert.equal(preview.body.source.kind, 'area');
    assert.equal(preview.body.species.length, 2);
    assert.equal(preview.body.species[0].inCatalogue, false);

    const res = await owner.post('/api/catalogues/cochrane-backyard-2/import/ebird', {
      latitude,
      longitude,
      radiusKm: 15,
      areaLabel: 'Cochrane',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.added, 2);
    const cat = await owner.get('/api/catalogues/cochrane-backyard-2');
    assert.deepEqual(cat.body.catalogue.area, { label: 'Cochrane', latitude: 51.19, longitude: -114.47, radiusKm: 15 });
    assert.equal(cat.body.catalogue.regionCode, 'CA-AB-RV');
  });

  test('an import needs a region or a place', async () => {
    const res = await owner.post('/api/catalogues/cochrane-backyard-2/import/ebird', { radiusKm: 10 });
    assert.equal(res.status, 400);
  });

  test('manual species entry reuses an existing scientific name', async () => {
    const res = await editor.post('/api/catalogues/cochrane-backyard-2/species', {
      commonName: 'Robin',
      scientificName: 'turdus migratorius',
    });
    assert.equal(res.status, 403, 'editor is not a member of the second catalogue');
    const own = await owner.post('/api/catalogues/cochrane-backyard-2/species', {
      commonName: 'Robin',
      scientificName: 'turdus migratorius',
    });
    assert.equal(own.status, 200, 'already added by the area import');
    assert.equal(own.body.added, false);
    assert.equal(own.body.entry.id, robinId);
  });

  test('sightings require the species to be in the dex', async () => {
    const other = await owner.post('/api/catalogues/cochrane-backyard-2/species', {
      commonName: 'Snowy Owl',
      scientificName: 'Bubo scandiacus',
    });
    const res = await editor.post('/api/catalogues/cochrane-backyard/sightings', { speciesId: other.body.entry.id });
    assert.equal(res.status, 400);
  });

  test('editor logs a sighting and uploads a photo', async () => {
    const s = await editor.post('/api/catalogues/cochrane-backyard/sightings', {
      speciesId: robinId,
      observedAt: '2026-05-18T14:42:00Z',
      latitude: 51.19,
      longitude: -114.47,
      locationName: 'Bow River pathway',
    });
    assert.equal(s.status, 201);
    sightingId = s.body.sighting.id;

    const up = await editor.upload(`/api/sightings/${sightingId}/photos`, await makeJpeg());
    assert.equal(up.status, 201, JSON.stringify(up.body));
    photoId = up.body.photo.id;
    assert.equal(up.body.photo.width, 640);

    const dex = await anon.get('/api/catalogues/cochrane-backyard/species');
    const robin = dex.body.species.find((x) => x.id === robinId);
    assert.equal(robin.status, 'photographed');
    assert.equal(robin.coverUrl, `/api/photos/${photoId}/thumb`);
    const cat = await anon.get('/api/catalogues/cochrane-backyard');
    assert.deepEqual(cat.body.catalogue.stats, { species: 3, logged: 1, photographed: 1, photos: 1 });
  });

  test('non-images and oversized files are rejected', async () => {
    const txt = await editor.upload(`/api/sightings/${sightingId}/photos`, Buffer.from('hello'), 'x.txt', 'text/plain');
    assert.equal(txt.status, 415);
    const big = await editor.upload(`/api/sightings/${sightingId}/photos`, Buffer.alloc(3 * 1024 * 1024, 1));
    assert.equal(big.status, 413);
  });

  test('visitors get stripped derivatives; originals follow location privacy', async () => {
    const thumb = await anon.get(`/api/photos/${photoId}/thumb`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers['content-type'], 'image/webp');
    assert.equal((await anon.get(`/api/photos/${photoId}/original`)).status, 200);

    await owner.patch('/api/catalogues/cochrane-backyard', { hideLocations: true });
    assert.equal((await anon.get(`/api/photos/${photoId}/original`)).status, 404);
    assert.equal((await editor.get(`/api/photos/${photoId}/original`)).status, 200);
    const list = await anon.get('/api/catalogues/cochrane-backyard/sightings');
    assert.equal(list.body.locationsHidden, true);
    assert.equal(list.body.sightings[0].latitude, null);
    const mine = await editor.get('/api/catalogues/cochrane-backyard/sightings');
    assert.equal(mine.body.sightings[0].latitude, 51.19);
  });

  test('species detail returns sightings with photos', async () => {
    const res = await anon.get(`/api/catalogues/cochrane-backyard/species/${robinId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.sightings.length, 1);
    assert.equal(res.body.sightings[0].photos.length, 1);
    assert.equal(res.body.sightings[0].photos[0].urls.original, null);
  });

  test('a species with sightings cannot be removed from the dex', async () => {
    const res = await editor.delete(`/api/catalogues/cochrane-backyard/species/${robinId}`);
    assert.equal(res.status, 409);
  });

  test('identification suggestions are matched to the dex', async () => {
    const res = await editor.upload('/api/catalogues/cochrane-backyard/identify', await makeJpeg(300, 200));
    assert.equal(res.status, 200);
    assert.equal(res.body.suggestions[0].speciesId, robinId);
    assert.equal(res.body.suggestions[0].inCatalogue, true);
    assert.equal(res.body.suggestions[1].speciesId, null);
  });

  test('deleting a sighting removes its photos', async () => {
    assert.equal((await stranger.delete(`/api/sightings/${sightingId}`)).status, 403);
    assert.equal((await editor.delete(`/api/sightings/${sightingId}`)).status, 200);
    assert.equal((await anon.get(`/api/photos/${photoId}/thumb`)).status, 404);
  });

  test('ownership transfer and catalogue deletion', async () => {
    const members = await owner.get('/api/catalogues/cochrane-backyard/members');
    const editorId = members.body.members.find((m) => m.role === 'editor').userId;
    assert.equal((await owner.patch(`/api/catalogues/cochrane-backyard/members/${editorId}`, { role: 'owner' })).status, 200);
    assert.equal((await owner.delete('/api/catalogues/cochrane-backyard')).status, 403);
    assert.equal((await editor.delete('/api/catalogues/cochrane-backyard')).status, 200);
    assert.equal((await editor.get('/api/catalogues/cochrane-backyard')).status, 404);
  });
});
