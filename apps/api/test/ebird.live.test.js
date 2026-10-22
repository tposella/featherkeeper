// Calls the real eBird API. Runs only when EBIRD_API_KEY is set (in CI it comes from a repository secret).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createEbirdClient } from '../src/integrations/ebird.js';

const apiKey = process.env.EBIRD_API_KEY;
const skip = apiKey ? false : 'EBIRD_API_KEY not set';
const ebird = createEbirdClient({ ...loadConfig().ebird, apiKey });

test('species around Cochrane, Alberta from nearby hotspots', { skip, timeout: 120000 }, async () => {
  const { codes, summary } = await ebird.speciesCodesFor({ latitude: 51.19, longitude: -114.47, radiusKm: 15 });
  console.log(
    `area: ${summary.hotspotsFound} hotspots found, ${summary.hotspotsUsed} used, ${codes.length} codes, district ${summary.regionCode} (${summary.regionName})`,
  );
  console.log(`top hotspots: ${summary.topHotspots.map((h) => `${h.name} (${h.species})`).join('; ')}`);
  assert.ok(summary.hotspotsFound > 0);
  assert.ok(codes.length > 80, `expected a real list, got ${codes.length}`);
  assert.ok(codes.includes('bkbmag1'), 'Black-billed Magpie should be on any Cochrane list');
  assert.match(summary.regionCode ?? '', /^CA-AB/);

  const taxa = await ebird.taxonomy(codes);
  console.log(`taxonomy: ${taxa.length} full species, first ${taxa[0].commonName}, last ${taxa.at(-1).commonName}`);
  assert.ok(taxa.length > 60);
  assert.ok(taxa.every((t) => t.commonName && t.scientificName));
});

test('species for a whole region', { skip, timeout: 60000 }, async () => {
  const { codes, summary } = await ebird.speciesCodesFor({ regionCode: 'CA-AB' });
  console.log(`region ${summary.regionCode} (${summary.regionName}): ${codes.length} codes`);
  assert.match(summary.regionName, /^Alberta/);
  assert.ok(codes.length > 300);
});
