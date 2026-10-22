// Screenshot every main screen of the demo build. Used by CI to review layout changes.
// Usage: node scripts/screenshots.mjs <base url> <output dir>
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'screenshots';
await mkdir(out, { recursive: true });

const pages = [
  ['home', '#/'],
  ['dex', '#/c/bow-valley'],
  ['species-photographed', '#/c/bow-valley/species/37'],
  ['species-seen-only', '#/c/bow-valley/species/3'],
  ['species-missing', '#/c/bow-valley/species/6'],
  ['map', '#/c/bow-valley/map'],
  ['recent', '#/c/bow-valley/recent'],
  ['log-sighting', '#/c/bow-valley/log'],
  ['settings', '#/c/bow-valley/settings'],
  ['new-catalogue', '#/new'],
  ['sign-in', '#/login'],
];

const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
];

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const [vpName, viewport] of viewports) {
    if (scheme === 'dark' && vpName === 'mobile') continue;
    const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => console.error(`[${vpName}/${scheme}] page error:`, err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`[${vpName}/${scheme}] console:`, msg.text());
    });
    for (const [name, hash] of pages) {
      if (scheme === 'dark' && !['dex', 'species-photographed', 'home'].includes(name)) continue;
      await page.goto(new URL(hash, base).href);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-${name}.png`, fullPage: true });
    }
    if (scheme === 'light') {
      // New catalogue built from the birds around a town.
      await page.goto(new URL('#/new', base).href);
      await page.getByLabel('Name', { exact: true }).fill('Cochrane birds');
      await page.getByPlaceholder('Cochrane, Alberta').fill('Cochrane');
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await page.getByRole('button', { name: /Cochrane, Rocky View/ }).click();
      await page.getByRole('button', { name: 'Find species' }).click();
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-new-catalogue-from-town.png`, fullPage: true });

      // The public view of the dex, as a signed-out visitor sees it.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.getByRole('radio', { name: 'Visitor (signed out)' }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-dex-as-visitor.png`, fullPage: true });
      // Lightbox on a species photo.
      await page.getByRole('radio', { name: 'Owner' }).click();
      await page.goto(new URL('#/c/bow-valley/species/37', base).href);
      await page.waitForTimeout(500);
      await page.locator('.thumb').first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-lightbox.png` });
    }
    await page.close();
  }
}
await browser.close();
console.log(`Screenshots saved to ${out}/`);
