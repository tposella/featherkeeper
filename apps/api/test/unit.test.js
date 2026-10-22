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
