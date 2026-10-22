// Calls the real iNaturalist and Wikipedia APIs (CI only) to check response shapes and the time-of-day handling.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInaturalistClient } from '../src/integrations/inat.js';
import { createWikipediaClient } from '../src/integrations/wikipedia.js';

const skip = process.env.CI ? false : 'only runs in CI (set CI=1 to run)';
const opts = { enabled: true, userAgent: 'Featherkeeper-CI (+https://github.com/tposella/featherkeeper)' };
const cochrane = { latitude: 51.19, longitude: -114.47, radiusKm: 25 };

test('iNaturalist: seasonality and time of day for American Robin near Cochrane', { skip, timeout: 90000 }, async () => {
  const inat = createInaturalistClient(opts);
  const taxon = await inat.taxonId('Turdus migratorius');
  console.log(`taxon: ${JSON.stringify(taxon)}`);
  assert.ok(taxon?.id);
  const months = await inat.monthHistogram(taxon.id, cochrane);
  console.log(`months: ${months.join(' ')}`);
  const summer = months.slice(3, 9).reduce((a, b) => a + b, 0);
  const winter = months[0] + months[1] + months[11];
  assert.ok(summer > winter, 'robins are summer birds in Alberta');
  const { hours, sample } = await inat.hourHistogram(taxon.id, cochrane);
  console.log(`hours (sample ${sample}): ${hours.join(' ')}`);
  const day = hours.slice(6, 21).reduce((a, b) => a + b, 0);
  assert.ok(sample >= 20);
  assert.ok(day / sample > 0.8, 'hours should be local time, so mostly daytime');
});

test('iNaturalist: species usually photographed near Cochrane in May', { skip, timeout: 60000 }, async () => {
  const inat = createInaturalistClient(opts);
  const list = await inat.monthlySpecies({ ...cochrane, month: 5 });
  console.log(`May species: ${list.length}; top: ${list.slice(0, 5).map((s) => `${s.commonName} (${s.observations})`).join(', ')}`);
  assert.ok(list.length > 40);
});

test('Wikipedia: habitat text for a species', { skip, timeout: 60000 }, async () => {
  const wiki = createWikipediaClient(opts);
  const habitat = await wiki.habitat(['American robin', 'Turdus migratorius']);
  console.log(`habitat [${habitat?.section}]: ${habitat?.text}`);
  assert.ok(habitat && habitat.text.length > 40);
  assert.match(habitat.url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
});
