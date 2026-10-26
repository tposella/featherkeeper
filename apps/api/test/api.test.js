import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, fakeGeocoder, fakeIdentifier, fakeReference, fakeSounds, makeHeic, makeJpeg, setup } from './helpers.js';

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

describe('site admin', () => {
  test('version: everyone sees it; only the admin hears about updates', async () => {
    const asVisitor = await anon.get('/api/version');
    assert.equal(asVisitor.status, 200);
    assert.equal(asVisitor.body.admin, false);
    assert.equal(asVisitor.body.latest, undefined);
    assert.ok(asVisitor.body.current);
    assert.equal((await owner.get('/api/version')).body.admin, false);

    const res = await admin.get('/api/version');
    assert.equal(res.body.admin, true);
    assert.equal(res.body.current, '0.1.0');
    assert.equal(res.body.updateAvailable, true);
    assert.equal(res.body.latest.version, '0.1.1');
    assert.equal(res.body.latest.url, 'https://example.test/r/2');
    assert.equal(res.body.releasesUrl, 'https://github.com/tposella/featherkeeper/releases');
    assert.ok((await anon.get('/api/health')).body.version);
  });

  test('only the site admin sees the user list', async () => {
    assert.equal((await anon.get('/api/admin/users')).status, 401);
    assert.equal((await owner.get('/api/admin/users')).status, 403);
    const res = await admin.get('/api/admin/users');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.users.map((u) => [u.email, u.isSiteAdmin]),
      [
        ['admin@example.com', true],
        ['owner@example.com', false],
        ['editor@example.com', false],
        ['stranger@example.com', false],
      ],
    );
  });

  test('the admin resets a password: generated or typed, and the user is signed out', async () => {
    const users = (await admin.get('/api/admin/users')).body.users;
    const strangerId = users.find((u) => u.email === 'stranger@example.com').id;
    const url = `/api/admin/users/${strangerId}/reset-password`;
    assert.equal((await owner.post(url, {})).status, 403);

    const res = await admin.post(url, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.generated, true);
    assert.match(res.body.password, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.equal((await stranger.get('/api/auth/me')).body.user, null, 'signed out everywhere');
    assert.equal((await stranger.post('/api/auth/login', { email: 'stranger@example.com', password: 'long enough pw' })).status, 401);
    assert.equal((await stranger.post('/api/auth/login', { email: 'stranger@example.com', password: res.body.password })).status, 200);

    assert.equal((await admin.post(url, { password: 'short' })).status, 400);
    const typed = await admin.post(url, { password: 'long enough pw' });
    assert.equal(typed.body.password, null, 'a typed password is not echoed back');
    assert.equal((await stranger.post('/api/auth/login', { email: 'stranger@example.com', password: 'long enough pw' })).status, 200);
  });

  test('the last site admin cannot be demoted', async () => {
    const users = (await admin.get('/api/admin/users')).body.users;
    const me = users.find((u) => u.email === 'admin@example.com');
    assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { isSiteAdmin: false })).status, 409);
  });

  test('console command: reset-password prints a temporary password that works', async () => {
    const { execFile } = await import('node:child_process');
    const run = (args) =>
      new Promise((resolve) => {
        execFile(process.execPath, ['src/admin-cli.js', ...args], { env: { ...process.env, DATABASE_URL: ctx.databaseUrl } }, (err, stdout, stderr) =>
          resolve({ code: err?.code ?? 0, stdout, stderr }),
        );
      });
    const list = await run(['list-users']);
    assert.match(list.stdout, /admin\s+admin@example\.com/);
    const missing = await run(['reset-password', 'nobody@example.com']);
    assert.equal(missing.code, 1);

    const reset = await run(['reset-password', 'stranger@example.com']);
    assert.equal(reset.code, 0, reset.stderr);
    const temp = reset.stdout.match(/Temporary password: (\S+)/)?.[1];
    assert.ok(temp, reset.stdout);
    assert.equal((await stranger.get('/api/auth/me')).body.user, null);
    assert.equal((await stranger.post('/api/auth/login', { email: 'stranger@example.com', password: temp })).status, 200);
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

  test('example photos are fetched in the background as soon as species are added', async () => {
    await ctx.examples.idle();
    const url = '/api/catalogues/cochrane-backyard/species';
    const dex = await anon.get(url);
    assert.equal(dex.body.examplesPending, 0);
    const robin = dex.body.species.find((s) => s.ebirdCode === 'amerob');
    const eagle = dex.body.species.find((s) => s.ebirdCode === 'baleag');
    assert.equal(eagle.example, null, 'no photo found for the eagle');
    assert.equal(robin.example.licence, 'CC BY-NC', 'the first photo that downloads is used');
    assert.match(robin.example.credit, /A\. Birder/);
    const img = await anon.get(robin.example.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/webp');
    assert.match(img.headers['cache-control'], /immutable/);
    assert.equal((await anon.get(`/api/species/${eagle.id}/example`)).status, 404);

    const calls = fakeReference.calls;
    const asked = await anon.get(`${url}?examples=1`);
    assert.equal(asked.body.examplesPending, 0, 'a species with no photo found is not retried straight away');
    await ctx.examples.idle();
    assert.equal(fakeReference.calls, calls, 'stored examples are not looked up again');

    // Missing ones (e.g. after an upgrade) are found and queued at startup.
    await ctx.db.query('DELETE FROM species_examples WHERE species_id = $1', [robin.id]);
    assert.equal(await ctx.examples.prepare(), 1);
    await ctx.examples.idle();
    assert.ok((await anon.get(url)).body.species.find((s) => s.ebirdCode === 'amerob').example);
  });

  test('the default dex view is a catalogue setting for the owner', async () => {
    const url = '/api/catalogues/cochrane-backyard';
    assert.equal((await anon.get(url)).body.catalogue.dexStyle, 'examples', 'greyed examples by default');
    assert.equal((await editor.patch(url, { dexStyle: 'slots' })).status, 403);
    assert.equal((await owner.patch(url, { dexStyle: 'colour' })).status, 400);
    const res = await owner.patch(url, { dexStyle: 'slots' });
    assert.equal(res.status, 200);
    assert.equal(res.body.catalogue.dexStyle, 'slots');
    await owner.patch(url, { dexStyle: 'examples' });
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

  test('a point gets a place name: nearest hotspot first, then the town', async () => {
    assert.equal((await anon.get('/api/places/reverse?latitude=51.1652&longitude=-114.3824')).status, 401);
    const park = await owner.get('/api/places/reverse?latitude=51.1652&longitude=-114.3824');
    assert.deepEqual(park.body.suggestion, { name: 'Glenbow Ranch Provincial Park', source: 'hotspot' });
    const town = await owner.get('/api/places/reverse?latitude=51.19&longitude=-114.47');
    assert.deepEqual(town.body.suggestion, { name: 'Cochrane', source: 'map' });
    const nowhere = await owner.get('/api/places/reverse?latitude=-51.19&longitude=-114.47');
    assert.equal(nowhere.body.suggestion, null);
  });

  test('place search puts eBird hotspots near the catalogue first', async () => {
    const res = await owner.get('/api/places?q=glenbow&catalogue=cochrane-backyard-2');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.places[0].name, 'Glenbow Ranch Provincial Park');
    assert.equal(res.body.places[0].source, 'hotspot');
    assert.match(res.body.places[0].label, /214 species recorded/);
    assert.equal(res.body.places[1].source, 'map');
    assert.deepEqual(fakeGeocoder.lastNear, { latitude: 51.19, longitude: -114.47 }, 'biased to the catalogue area');
    const plain = await owner.get('/api/places?q=Cochrane');
    assert.ok(plain.body.places.every((p) => p.source === 'map'));
    assert.equal((await stranger.get('/api/places?q=glenbow&catalogue=cochrane-backyard-2')).status, 404, 'private catalogue');
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
    assert.equal(res.status, 404, 'a private catalogue is invisible to non-members');
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
    assert.deepEqual(cat.body.catalogue.stats, { species: 3, photographed: 1, photos: 1, toReplace: 0 });
  });

  test('non-images and oversized files are rejected', async () => {
    const txt = await editor.upload(`/api/sightings/${sightingId}/photos`, Buffer.from('hello'), 'x.txt', 'text/plain');
    assert.equal(txt.status, 415);
    const big = await editor.upload(`/api/sightings/${sightingId}/photos`, Buffer.alloc(3 * 1024 * 1024, 1));
    assert.equal(big.status, 413);
  });

  test('iPhone (HEIC) photos are decoded, keeping their date and the original file', async (t) => {
    const heic = await makeHeic();
    if (!heic) return t.skip('heif-enc or exiftool is not installed');
    const up = await editor.upload(`/api/sightings/${sightingId}/photos`, heic, 'IMG_0001.HEIC', 'image/heic');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    try {
      const p = up.body.photo;
      assert.deepEqual(
        { width: p.width, height: p.height, camera: p.camera, takenAt: p.takenAt, latitude: p.latitude, longitude: p.longitude },
        { width: 640, height: 480, camera: 'Apple iPhone 15', takenAt: '2024-05-18T07:42:10.000Z', latitude: 51.1652, longitude: -114.3824 },
      );
      const thumb = await editor.get(p.urls.thumb);
      assert.equal(thumb.status, 200);
      assert.equal(thumb.headers['content-type'], 'image/webp');
      const original = await editor.get(p.urls.original);
      assert.equal(original.headers['content-type'], 'image/heic');
      assert.equal(original.raw.length, heic.length, 'the original HEIC is kept byte for byte');
    } finally {
      await editor.delete(`/api/photos/${up.body.photo.id}`);
    }

    // The log form asks the server for a HEIC photo's date and place, since browsers can't read them.
    const info = await editor.upload('/api/photo-info', heic, 'IMG_0001.HEIC', 'image/heic');
    assert.deepEqual(info.body, { localDateTime: '2024-05-18T07:42', latitude: 51.1652, longitude: -114.3824, camera: 'Apple iPhone 15' });
    assert.equal((await anon.upload('/api/photo-info', heic, 'IMG_0001.HEIC', 'image/heic')).status, 401);

    // AI identification reads HEIC too, and sends back a JPEG preview the browser can show.
    const id = await editor.upload('/api/catalogues/cochrane-backyard/identify', heic, 'IMG_0001.HEIC', 'image/heic');
    assert.equal(id.status, 200, JSON.stringify(id.body));
    assert.match(id.body.preview, /^data:image\/jpeg;base64,/);
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

  test('a photo can be marked to replace, listed, and unmarked', async () => {
    const url = `/api/photos/${photoId}`;
    assert.equal((await anon.patch(url, { replace: true })).status, 401);
    assert.equal((await stranger.patch(url, { replace: true })).status, 403);
    assert.equal((await editor.patch(url, {})).status, 400);

    const marked = await editor.patch(url, { replace: true, replaceNote: 'Soft focus, try again in spring' });
    assert.equal(marked.status, 200, JSON.stringify(marked.body));
    assert.equal(marked.body.photo.replace.note, 'Soft focus, try again in spring');
    const markedAt = marked.body.photo.replace.markedAt;
    assert.ok(markedAt);

    // Editing the note keeps the original date.
    const noted = await editor.patch(url, { replaceNote: 'Soft focus' });
    assert.equal(noted.body.photo.replace.note, 'Soft focus');
    assert.equal(noted.body.photo.replace.markedAt, markedAt);

    const list = await editor.get('/api/catalogues/cochrane-backyard/to-replace');
    assert.equal(list.status, 200);
    assert.equal(list.body.photos.length, 1);
    const item = list.body.photos[0];
    assert.equal(item.id, photoId);
    assert.equal(item.species.id, robinId);
    assert.equal(item.sighting.locationName, 'Bow River pathway');
    assert.equal(item.newerPhotos, 0);
    assert.equal((await anon.get('/api/catalogues/cochrane-backyard/to-replace')).status, 401);

    const cat = await editor.get('/api/catalogues/cochrane-backyard');
    assert.equal(cat.body.catalogue.stats.toReplace, 1);
    // Only editors see the mark on the species page.
    const seen = (r) => r.body.sightings[0].photos[0].replace;
    assert.ok(seen(await editor.get(`/api/catalogues/cochrane-backyard/species/${robinId}`)));
    assert.equal(seen(await anon.get(`/api/catalogues/cochrane-backyard/species/${robinId}`)), null);

    // A newer photo of the same species shows up as a possible replacement.
    const newer = await editor.upload(`/api/sightings/${sightingId}/photos`, await makeJpeg(320, 240));
    assert.equal((await editor.get('/api/catalogues/cochrane-backyard/to-replace')).body.photos[0].newerPhotos, 1);
    await editor.delete(`/api/photos/${newer.body.photo.id}`);

    const cleared = await editor.patch(url, { replace: false });
    assert.equal(cleared.body.photo.replace, null);
    assert.equal((await editor.get('/api/catalogues/cochrane-backyard/to-replace')).body.photos.length, 0);
    const again = await editor.patch(url, { replace: true });
    assert.equal(again.body.photo.replace.note, '', 'unmarking clears the old note');
    await editor.patch(url, { replace: false });
  });

  test('export: a ZIP with the checklist, sightings, photos and original files', async () => {
    const url = '/api/catalogues/cochrane-backyard/export.zip';
    assert.equal((await anon.get(url)).status, 401);
    assert.equal((await stranger.get(url)).status, 403);
    const res = await editor.get(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(res.headers['content-disposition'], /attachment; filename="featherkeeper-cochrane-backyard-\d{4}-\d{2}-\d{2}\.zip"/);

    // Read it back with Python's zipfile, an independent ZIP reader.
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fk-export-'));
    try {
      const file = path.join(dir, 'export.zip');
      await writeFile(file, res.raw);
      const script = `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({
  "names": z.namelist(),
  "species": z.read("species.csv").decode("utf-8-sig").splitlines(),
  "sightings": z.read("sightings.csv").decode("utf-8-sig").splitlines(),
  "photos": z.read("photos.csv").decode("utf-8-sig").splitlines(),
  "sizes": {i.filename: i.file_size for i in z.infolist()},
}))`;
      const out = JSON.parse(execFileSync('python3', ['-c', script, file]).toString());
      assert.deepEqual(out.names.slice(0, 4), ['README.txt', 'species.csv', 'sightings.csv', 'photos.csv']);
      const photoFile = out.names.find((n) => n.startsWith('photos/'));
      assert.match(photoFile, /^photos\/\d{3} American Robin\/\d{4}-\d{2}-\d{2} \d+\.jpg$/);
      assert.equal(out.species[0], 'plate,common_name,scientific_name,family,order,ebird_code,status,photos,sightings,first_seen,last_seen,notes');
      assert.ok(out.species.some((l) => l.includes('American Robin') && l.includes('photographed')));
      assert.ok(out.sightings[1].includes('Bow River pathway') && out.sightings[1].includes('51.19'), 'editors get exact locations');
      assert.ok(out.sightings[1].includes(photoFile));
      const photo = (await editor.get(`/api/catalogues/cochrane-backyard/species/${robinId}`)).body.sightings[0].photos[0];
      assert.equal(out.sizes[photoFile], photo.sizeBytes, 'the original file, byte for byte');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the thumbnail is the newest photo until one is chosen, and can be reset', async () => {
    const second = await editor.upload(`/api/sightings/${sightingId}/photos`, await makeJpeg(500, 500));
    assert.equal(second.status, 201);
    const url = `/api/catalogues/cochrane-backyard/species/${robinId}`;
    let entry = (await anon.get(url)).body.entry;
    assert.equal(entry.coverChosen, false);
    assert.equal(entry.coverPhotoId, second.body.photo.id, 'newest photo by default');

    assert.equal((await anon.patch(url, { coverPhotoId: photoId })).status, 401);
    const set = await editor.patch(url, { coverPhotoId: photoId });
    assert.equal(set.status, 200);
    assert.equal(set.body.entry.coverPhotoId, photoId);
    assert.equal(set.body.entry.coverChosen, true);
    entry = (await anon.get('/api/catalogues/cochrane-backyard/species')).body.species.find((s) => s.id === robinId);
    assert.equal(entry.coverUrl, `/api/photos/${photoId}/thumb`, 'the dex shows the chosen photo');

    const reset = await editor.patch(url, { coverPhotoId: null });
    assert.equal(reset.body.entry.coverChosen, false);
    assert.equal(reset.body.entry.coverPhotoId, second.body.photo.id);

    await editor.patch(url, { coverPhotoId: second.body.photo.id });
    assert.equal((await editor.delete(`/api/photos/${second.body.photo.id}`)).status, 200);
    entry = (await anon.get(url)).body.entry;
    assert.equal(entry.coverChosen, false, 'deleting the chosen photo falls back to the newest');
    assert.equal(entry.coverPhotoId, photoId);
  });

  test('editing a sighting: details, clearing the location, and moving it to another species', async () => {
    const url = `/api/sightings/${sightingId}`;
    assert.equal((await stranger.patch(url, { notes: 'x' })).status, 403);
    assert.equal((await anon.patch(url, { notes: 'x' })).status, 401);

    const res = await editor.patch(url, {
      observedAt: '2026-05-19T15:10:00.000Z',
      locationName: 'Glenbow Ranch, west trail',
      notes: 'Pair carrying nesting material.',
      latitude: 51.1652,
      longitude: -114.3824,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.sighting.observedAt, '2026-05-19T15:10:00.000Z');
    assert.equal(res.body.sighting.locationName, 'Glenbow Ranch, west trail');
    assert.equal(res.body.sighting.latitude, 51.1652);

    const cleared = await editor.patch(url, { latitude: null, longitude: null, observedAt: null });
    assert.equal(cleared.body.sighting.latitude, null);
    assert.equal(cleared.body.sighting.observedAt, null);
    assert.equal((await editor.patch(url, { latitude: 51 })).status, 400, 'latitude without longitude');

    // Move it to the chickadee and back; the robin's chosen thumbnail is released when its photo leaves.
    const dex = (await editor.get('/api/catalogues/cochrane-backyard/species')).body.species;
    const chickadee = dex.find((s) => s.ebirdCode === 'blkchi');
    await editor.patch(`/api/catalogues/cochrane-backyard/species/${robinId}`, { coverPhotoId: photoId });
    const moved = await editor.patch(url, { speciesId: chickadee.id });
    assert.equal(moved.body.sighting.speciesId, chickadee.id);
    const robin = (await editor.get(`/api/catalogues/cochrane-backyard/species/${robinId}`)).body;
    assert.equal(robin.sightings.length, 0);
    assert.equal(robin.entry.coverChosen, false);
    assert.equal(robin.entry.status, 'missing');
    const chick = (await editor.get(`/api/catalogues/cochrane-backyard/species/${chickadee.id}`)).body;
    assert.equal(chick.entry.status, 'photographed');
    await editor.patch(url, { speciesId: robinId });

    const otherCat = (await owner.get('/api/catalogues/cochrane-backyard-2/species')).body.species;
    const notInDex = otherCat.find((s) => s.commonName === 'Snowy Owl');
    assert.equal((await editor.patch(url, { speciesId: notInDex.id })).status, 400, 'species must be in this catalogue');
  });

  test('a species with sightings cannot be removed from the dex', async () => {
    const res = await editor.delete(`/api/catalogues/cochrane-backyard/species/${robinId}`);
    assert.equal(res.status, 409);
  });

  test('identification without a location compares against the catalogue only', async () => {
    const res = await editor.upload('/api/catalogues/cochrane-backyard/identify', await makeJpeg(300, 200));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.location, null);
    assert.equal(res.body.pool.usedLocation, false);
    assert.equal(fakeIdentifier.lastCandidates.length, 3, 'just the three dex species');
    assert.ok(fakeIdentifier.lastCandidates.every((c) => c.prior === 1));
    const [first, second, third] = res.body.suggestions;
    assert.equal(first.speciesId, robinId);
    assert.equal(first.inCatalogue, true);
    assert.equal(first.confidence, 0.82);
    assert.equal(second.commonName, 'Black-capped Chickadee');
    assert.equal(third.speciesId, null, 'not a known species');
  });

  test('a map pin makes eBird records near it the prior', async () => {
    const res = await editor.upload(
      '/api/catalogues/cochrane-backyard/identify',
      await makeJpeg(300, 200),
      'bird.jpg',
      'image/jpeg',
      { latitude: '51.19', longitude: '-114.47' },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.location.source, 'pin');
    assert.equal(res.body.pool.usedLocation, true);
    const prior = Object.fromEntries(fakeIdentifier.lastCandidates.map((c) => [c.id.replace('ebird:', ''), c.prior]));
    assert.equal(prior.amerob, 1, 'seen nearby this month');
    assert.equal(prior.blkchi, 0.4, 'recorded nearby');
    assert.equal(prior.baleag, 0.08, 'in the dex, not recorded nearby');
    assert.equal(res.body.suggestions[0].nearby, 'recent');
    assert.equal(res.body.suggestions[1].nearby, 'area');
  });

  test('the AI decision is saved with the uploaded photo', async () => {
    const ai = JSON.stringify({
      model: 'fake-bioclip',
      suggestions: [{ ebirdCode: 'amerob', scientificName: 'Turdus migratorius', commonName: 'American Robin', confidence: 0.82 }],
      accepted: 'amerob',
      rejected: [],
    });
    const up = await editor.upload(`/api/sightings/${sightingId}/photos`, await makeJpeg(), 'robin.jpg', 'image/jpeg', { ai });
    assert.equal(up.status, 201);
    const row = await ctx.db.one('SELECT ai_suggestions FROM photos WHERE id = $1', [up.body.photo.id]);
    assert.equal(row.ai_suggestions.accepted, 'amerob');
    assert.equal(row.ai_suggestions.suggestions[0].confidence, 0.82);
  });

  test('a species can be added by its eBird code', async () => {
    const res = await owner.post('/api/catalogues/cochrane-backyard-2/species', { ebirdCode: 'baleag' });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.commonName, 'Bald Eagle');
  });

  test('in season: reported now, usually around this month, and nearby species not in the catalogue', async () => {
    const res = await owner.get('/api/catalogues/cochrane-backyard-2/season?month=10&current=10');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.area.kind, 'area');
    assert.equal(res.body.area.label, 'Cochrane');
    const byName = Object.fromEntries(res.body.species.map((s) => [s.commonName, s]));
    assert.equal(byName['American Robin'].now.where, 'Glenbow Ranch PP');
    assert.equal(byName['American Robin'].usual.observations, 10);
    assert.equal(byName['Black-capped Chickadee'].now, null);
    assert.equal(byName['Black-capped Chickadee'].usual.observations, 42);
    assert.equal(byName['Bald Eagle'], undefined, 'neither reported nor usual');
    assert.deepEqual(res.body.notInCatalogue.map((s) => s.commonName), ['Bohemian Waxwing']);

    const may = await owner.get('/api/catalogues/cochrane-backyard-2/season?month=5&current=10');
    assert.equal(may.body.sources.now, null, 'recent reports only make sense for the current month');
    assert.ok(may.body.species.every((s) => s.now === null));
  });

  test('species insights: seasonality, time of day, habitat, recent reports', async () => {
    const dex = await owner.get('/api/catalogues/cochrane-backyard-2/species');
    const robin = dex.body.species.find((s) => s.ebirdCode === 'amerob');
    const res = await anon.get(`/api/catalogues/cochrane-backyard-2/species/${robin.id}/insights`);
    assert.equal(res.status, 404, 'private catalogue');
    const ok = await owner.get(`/api/catalogues/cochrane-backyard-2/species/${robin.id}/insights`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.months.length, 12);
    assert.equal(ok.body.hours.sample, 28);
    assert.match(ok.body.habitat.text, /woodland/);
    assert.equal(ok.body.reports[0].where, 'Glenbow Ranch PP');
    assert.equal(ok.body.links.ebird, 'https://ebird.org/species/amerob');
    assert.ok(Array.isArray(ok.body.yours));
  });

  test('sounds for a species use the catalogue area', async () => {
    const dex = await owner.get('/api/catalogues/cochrane-backyard-2/species');
    const robin = dex.body.species.find((s) => s.ebirdCode === 'amerob');
    assert.equal((await stranger.get(`/api/catalogues/cochrane-backyard-2/species/${robin.id}/sounds`)).status, 404);
    const res = await owner.get(`/api/catalogues/cochrane-backyard-2/species/${robin.id}/sounds`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.sounds[0].licence, 'CC BY-NC');
    assert.equal(fakeSounds.lastNear.latitude, 51.19);
    assert.equal(fakeSounds.lastNear.country, 'Canada');
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
