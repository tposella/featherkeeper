// Calls the real iNaturalist and Wikipedia APIs, to catch changes in their responses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReferenceClient } from '../src/integrations/reference.js';

const skip = process.env.CI ? false : 'only runs in CI (set CI=1 to run)';

test('reference photos for a real species', { skip, timeout: 60000 }, async () => {
  const ref = createReferenceClient({ enabled: true, userAgent: 'Featherkeeper-CI (+https://github.com/Tyler-Posella/featherkeeper)' });
  const info = await ref.forSpecies('Pica hudsonia', 'Black-billed Magpie');
  console.log(`photos: ${info.photos.length}; first: ${info.photos[0]?.source} ${info.photos[0]?.licence} ${info.photos[0]?.url}`);
  console.log(`credit: ${info.photos[0]?.credit}; links: ${JSON.stringify(info.links)}`);
  assert.ok(info.photos.length >= 2);
  assert.ok(info.photos.every((p) => p.url.startsWith('https://') && p.thumb.startsWith('https://') && p.credit && p.licence));
  assert.match(info.links.inaturalist ?? '', /inaturalist\.org\/taxa\/\d+/);
});
