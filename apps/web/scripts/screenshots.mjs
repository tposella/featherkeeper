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
  ['families', '#/c/bow-valley/families'],
  ['season', '#/c/bow-valley/season'],
  ['dex-one-family', '#/c/bow-valley?family=Woodpeckers'],
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
      await page.waitForTimeout(name.startsWith('species') ? 1800 : 700);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-${name}.png`, fullPage: true });
    }
    if (scheme === 'light' && process.env.FIXTURES && vpName === 'desktop') {
      // Does the log form pick up date, time and place from real camera metadata?
      for (const name of ['camera.jpg', 'phone.jpg', 'xmp.jpg']) {
        await page.goto(new URL('#/c/bow-valley/log', base).href);
        await page.waitForTimeout(400);
        await page.locator('input[type=file]').first().setInputFiles(`${process.env.FIXTURES}/${name}`);
        await page.waitForTimeout(1500);
        const date = await page.locator('input[type=datetime-local]').inputValue();
        const lat = await page.getByLabel('Latitude').inputValue();
        const place = await page.getByLabel('Place name').inputValue();
        const summary = (await page.locator('.from-photo').textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
        console.log(`EXIF ${name}: date="${date}" lat="${lat}" place="${place}" summary="${summary}"`);
        await page.screenshot({ path: `${out}/exif-${name.replace('.jpg', '')}.png`, fullPage: true });
      }
    }
    if (scheme === 'light') {
      // AI suggestions for an unidentified photo, then accepting the top match.
      await page.goto(new URL('#/c/bow-valley/log', base).href);
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGklEQVR4nGNgoBpgZGRkZGRkYGBgYGRkZgYAAU0AF0w0OTQAAAAASUVORK5CYII=',
        'base64',
      );
      await page.locator('input[type=file]').first().setInputFiles({ name: 'unknown-bird.png', mimeType: 'image/png', buffer: png });
      await page.getByText('Strong match').first().waitFor({ timeout: 8000 });
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-ai-suggestions.png`, fullPage: true });
      await page.locator('.ref').first().waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-ai-suggestions-with-examples.png`, fullPage: true });
      await page.locator('.ref').first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-ai-compare.png` });
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('button', { name: 'Accept' }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-ai-accepted.png`, fullPage: true });

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
