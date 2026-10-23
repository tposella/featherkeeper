import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentifier } from '../src/integrations/identify.js';
import { accessFor } from '../src/lib/access.js';
import { exifDateToIso } from '../src/lib/images.js';
import { hashPassword, verifyPassword } from '../src/lib/passwords.js';
import { slugify } from '../src/lib/slug.js';

test('slugify', () => {
  assert.equal(slugify('  Cochrane Backyard! '), 'cochrane-backyard');
  assert.equal(slugify('Île-de-France birds'), 'ile-de-france-birds');
  assert.equal(slugify('***'), '');
});

test('passwords round-trip and reject the wrong one', async () => {
  const hash = await hashPassword('a fine password');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('a fine password', hash), true);
  assert.equal(await verifyPassword('another password', hash), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('EXIF dates honour the offset when present', () => {
  assert.equal(exifDateToIso('2024:05:18 07:42:10', '-06:00'), '2024-05-18T13:42:10.000Z');
  assert.equal(exifDateToIso('2024:05:18 07:42:10'), '2024-05-18T07:42:10.000Z');
  assert.equal(exifDateToIso('0000:00:00 00:00:00'), null);
  assert.equal(exifDateToIso(undefined), null);
});

test('access matrix', () => {
  const user = { id: 1, is_site_admin: false };
  const admin = { id: 2, is_site_admin: true };
  const cat = (visibility) => ({ visibility });

  assert.equal(accessFor(cat('private'), null, null).canView, false);
  assert.equal(accessFor(cat('private'), null, user).canView, false);
  assert.equal(accessFor(cat('private'), 'editor', user).canView, true);
  assert.equal(accessFor(cat('private'), null, admin).canManage, true);
  assert.equal(accessFor(cat('members'), null, null).canView, false);
  assert.equal(accessFor(cat('members'), null, user).canView, true);
  assert.equal(accessFor(cat('public'), null, null).canView, true);
  assert.equal(accessFor(cat('public'), null, null).canEdit, false);
  assert.deepEqual(accessFor(cat('public'), 'editor', user), { role: 'editor', canView: true, canEdit: true, canManage: false });
});

test('http identifier normalises different response shapes', async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        predictions: [
          { label: 'Varied Thrush', score: 12 },
          { scientific_name: 'Turdus migratorius', common_name: 'American Robin', confidence: 0.9 },
        ],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const id = createIdentifier({ provider: 'http', url: 'http://x/identify', apiKey: '', timeoutMs: 1000 }, fakeFetch);
  assert.equal(id.enabled, true);
  const { predictions: out } = await id.identify(Buffer.from('x'), 'image/jpeg');
  assert.equal(out[0].commonName, 'American Robin');
  assert.equal(out[1].confidence, 0.12);
  assert.equal(id.usesCandidates, false);
  assert.equal(createIdentifier({ provider: 'none' }).enabled, false);
  assert.equal(createIdentifier({ provider: 'http', url: '' }).enabled, false);
});

test('eBird client retries after being rate-limited', async () => {
  const { createEbirdClient } = await import('../src/integrations/ebird.js');
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
    return new Response(JSON.stringify(['amerob', 'bkbmag1']), { headers: { 'content-type': 'application/json' } });
  };
  const ebird = createEbirdClient({ apiKey: 'test', baseUrl: 'https://example.invalid' }, fakeFetch);
  // Region lookups fall back to the code when region info fails, so only spplist matters here.
  const { codes } = await ebird.speciesCodesFor({ regionCode: 'CA-AB' });
  assert.deepEqual(codes, ['amerob', 'bkbmag1']);
  assert.ok(calls >= 2);
});

test('bioclip identifier sends candidates and defaults to the bundled container', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, candidates: JSON.parse(init.body.get('candidates')) };
    return new Response(
      JSON.stringify({ model: 'bioclip-2', predictions: [{ id: 'ebird:amerob', scientificName: 'Turdus migratorius', commonName: 'American Robin', confidence: 0.9 }] }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const id = createIdentifier({ provider: 'bioclip', url: '', timeoutMs: 1000 }, fakeFetch);
  assert.equal(id.enabled, true);
  assert.equal(id.usesCandidates, true);
  const res = await id.identify(Buffer.from('x'), 'image/jpeg', {
    candidates: [{ id: 'ebird:amerob', scientificName: 'Turdus migratorius', commonName: 'American Robin', prior: 1 }],
  });
  assert.equal(sent.url, 'http://identifier:8000/identify');
  assert.equal(sent.candidates[0].prior, 1);
  assert.equal(res.model, 'bioclip-2');
  assert.equal(res.predictions[0].id, 'ebird:amerob');
});

test('reference photos come from iNaturalist, openly licensed only, with credit', async () => {
  const { createReferenceClient } = await import('../src/integrations/reference.js');
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (url.includes('/v1/taxa?q=')) return json({ results: [{ id: 12727, name: 'Turdus migratorius' }] });
    if (url.includes('/v1/taxa/12727')) {
      return json({
        results: [
          {
            id: 12727,
            wikipedia_url: 'http://en.wikipedia.org/wiki/American_robin',
            taxon_photos: [
              { photo: { id: 1, license_code: 'cc-by-nc', attribution: '(c) Ann, some rights reserved (CC BY-NC)', medium_url: 'https://static.example/photos/1/medium.jpg', square_url: 'https://static.example/photos/1/square.jpg' } },
              { photo: { id: 2, license_code: null, attribution: '(c) Bob, all rights reserved', medium_url: 'https://static.example/photos/2/medium.jpg' } },
              { photo: { id: 3, license_code: 'cc0', attribution: 'no rights reserved', medium_url: 'https://static.example/photos/3/medium.jpg' } },
            ],
          },
        ],
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const ref = createReferenceClient({ enabled: true, userAgent: 'test' }, fakeFetch);
  const info = await ref.forSpecies('Turdus migratorius', 'American Robin');
  assert.equal(info.photos.length, 2, 'the all-rights-reserved photo is skipped');
  assert.equal(info.photos[0].licence, 'CC BY-NC');
  assert.equal(info.photos[0].url, 'https://static.example/photos/1/large.jpg');
  assert.equal(info.photos[0].thumb, 'https://static.example/photos/1/square.jpg');
  assert.match(info.photos[0].credit, /Ann/);
  assert.equal(info.links.inaturalist, 'https://www.inaturalist.org/taxa/12727');
  const before = calls.length;
  await ref.forSpecies('turdus migratorius');
  assert.equal(calls.length, before, 'second lookup is cached');
});

test('distanceKm', async () => {
  const { distanceKm } = await import('../src/integrations/ebird.js');
  // Cochrane to Calgary city centre is roughly 30 km.
  const d = distanceKm(51.1894, -114.4682, 51.0447, -114.0719);
  assert.ok(d > 28 && d < 33, `got ${d}`);
  assert.equal(distanceKm(51, -114, 51, -114), 0);
});

test('Wikipedia habitat text is cleaned and trimmed to whole sentences', async () => {
  const { stripHtml, firstSentences } = await import('../src/integrations/wikipedia.js');
  const html = '<h3>Habitat</h3><p>The robin breeds in woodland<sup>[3]</sup> and &amp; gardens. It winters south.</p>';
  assert.equal(stripHtml(html), 'The robin breeds in woodland and & gardens. It winters south.');
  assert.equal(firstSentences('One two. Three four. Five six.', 20), 'One two. Three four.');
});

test('iNaturalist monthly species folds subspecies into species', async () => {
  const { createInaturalistClient } = await import('../src/integrations/inat.js');
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          { count: 30, taxon: { name: 'Junco hyemalis', rank: 'species', preferred_common_name: 'Dark-eyed Junco' } },
          { count: 12, taxon: { name: 'Junco hyemalis oreganus', rank: 'subspecies' } },
          { count: 5, taxon: { name: 'Corvus', rank: 'genus' } },
        ],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const inat = createInaturalistClient({ enabled: true, userAgent: 'test' }, fakeFetch);
  const list = await inat.monthlySpecies({ latitude: 51.19, longitude: -114.47, radiusKm: 25, month: 5 });
  assert.deepEqual(list, [{ scientificName: 'Junco hyemalis', commonName: 'Dark-eyed Junco', observations: 42 }]);
});

test('habitat text prefers sentences about the kind of place', async () => {
  const { habitatSentences } = await import('../src/integrations/wikipedia.js');
  const text =
    'The species breeds from Alaska to Mexico. Most migrate south in winter. It nests in open woodland and gardens, often near lakes. Eggs are blue.';
  assert.equal(habitatSentences(text), 'It nests in open woodland and gardens, often near lakes.');
  assert.equal(habitatSentences('Found from Alaska to Mexico.'), 'Found from Alaska to Mexico.');
});

test('XMP-style dates are understood, with their own offset', () => {
  assert.equal(exifDateToIso('2023-06-11T05:58:00-06:00'), '2023-06-11T11:58:00.000Z');
  assert.equal(exifDateToIso('2023-06-11T05:58'), '2023-06-11T05:58:00.000Z');
});

test('sound licences and kinds', async () => {
  const { licenceFromUrl, soundKind } = await import('../src/integrations/sounds.js');
  assert.equal(licenceFromUrl('//creativecommons.org/licenses/by-nc-sa/4.0/'), 'CC BY-NC-SA 4.0');
  assert.equal(licenceFromUrl('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(soundKind('song'), 'song');
  assert.equal(soundKind('call, flight call'), 'call');
  assert.equal(soundKind('alarm call'), 'call');
  assert.equal(soundKind('drumming'), 'drumming');
  assert.equal(soundKind(''), null);
});

test('xeno-canto results come first and alternate songs and calls', async () => {
  const { createSoundsClient } = await import('../src/integrations/sounds.js');
  const json = (b) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  const rec = (id, type, q) => ({ id, type, q, rec: 'Rec', cnt: 'Canada', loc: 'Alberta', lat: '51', lon: '-114', file: `//xeno-canto.org/${id}/download`, lic: '//creativecommons.org/licenses/by-nc-sa/4.0/', url: `//xeno-canto.org/${id}` });
  const fakeFetch = async (url) => {
    if (url.includes('xeno-canto.org/api/3')) {
      assert.match(url, /key=k123/);
      return json({ recordings: [rec(1, 'song', 'B'), rec(2, 'song', 'A'), rec(3, 'call', 'A'), rec(4, 'song', 'C')] });
    }
    throw new Error('iNaturalist should not be needed');
  };
  const sounds = createSoundsClient({ enabled: true, userAgent: 't', xenoCantoKey: 'k123' }, fakeFetch);
  const list = await sounds.forSpecies('Turdus migratorius', { latitude: 51, longitude: -114, country: 'Canada' });
  assert.deepEqual(list.map((r) => r.kind), ['song', 'call', 'song', 'song']);
  assert.equal(list[0].url, 'https://xeno-canto.org/2/download', 'best quality song first');
  assert.equal(list[0].licence, 'CC BY-NC-SA 4.0');
});
