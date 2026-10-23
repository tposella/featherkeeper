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
  ['to-replace', '#/c/bow-valley/to-replace'],
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
      // Searching for the sighting's location by name.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.goto(new URL('#/c/bow-valley/log', base).href);
      await page.waitForTimeout(600);
      await page.getByPlaceholder('A park, hotspot, lake or town').fill('glenbow');
      await page.getByPlaceholder('A park, hotspot, lake or town').press('Enter');
      await page.locator('.results button').first().waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-location-search.png`, fullPage: true });
      await page.locator('.results button').first().click();
      await page.waitForTimeout(800);
      console.log(
        `LOCATION search: place="${await page.getByLabel('Place name').inputValue()}" ` +
          `lat="${await page.getByLabel('Latitude').inputValue()}" stillOnLogPage=${page.url().includes('/log')}`,
      );
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-location-chosen.png`, fullPage: true });

      // Editing a sighting: change the notes and place, then move it to another species.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.goto(new URL('#/c/bow-valley/species/21', base).href);
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-edit-sighting.png`, fullPage: true });
      await page.getByRole('dialog').getByLabel('Notes').fill('Edited in the screenshot test.');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForTimeout(900);
      const notesShown = await page.getByText('Edited in the screenshot test.').count();
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
      await page.getByRole('button', { name: 'Change species' }).click();
      await page.getByPlaceholder('Type a common or scientific name').fill('raven');
      await page.getByRole('dialog').getByRole('button', { name: /Common Raven/ }).click();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-edit-sighting-move.png`, fullPage: true });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForTimeout(900);
      const movedNotice = await page.getByText('Sighting moved to').count();
      console.log(`EDIT notesShown=${notesShown} movedNotice=${movedNotice} dialogOpen=${await page.getByRole('dialog').count()}`);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-edit-sighting-moved.png`, fullPage: true });

      // A species with several photos: the album, and choosing a thumbnail.
      await page.goto(new URL('#/c/bow-valley/species/21', base).href);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-species-album.png`, fullPage: true });
      await page.getByRole('button', { name: 'Change thumbnail' }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-thumbnail-picker.png` });
      await page.locator('.grid .tile').last().click();
      await page.waitForTimeout(800);
      const badge = await page.locator('.album-tile .badge').count();
      const thumbIndex = await page.locator('.album-tile').evaluateAll((tiles) => tiles.findIndex((t) => t.querySelector('.badge')));
      console.log(`THUMBNAIL picker closed=${!(await page.locator('.grid .tile').count())} badges=${badge} badgeOnTile=${thumbIndex}`);
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(700);

      // Marking a photo "want to replace", then finding it on the To replace tab.
      await page.goto(new URL('#/c/bow-valley/to-replace', base).href);
      await page.waitForTimeout(900);
      const before = await page.locator('.list .card').count();
      await page.goto(new URL('#/c/bow-valley/species/2', base).href);
      await page.waitForTimeout(1500);
      await page.locator('.album-tile').first().click();
      await page.getByRole('button', { name: 'Want to replace' }).click();
      await page.getByLabel(/better shot/).fill('Too far away, screenshot test');
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-replace-mark.png` });
      await page.getByRole('button', { name: 'Mark to replace' }).click();
      await page.waitForTimeout(600);
      const markedText = await page.getByText('Marked to replace').count();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-replace-marked.png` });
      await page.keyboard.press('Escape');
      const flags = await page.locator('.album-tile .flag').count();
      await page.getByRole('link', { name: /^To replace/ }).click();
      await page.waitForTimeout(900);
      const after = await page.locator('.list .card').count();
      const noteShown = await page.getByText('Too far away, screenshot test').count();
      const tabCount = (await page.locator('.tab-count').textContent())?.trim();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-replace-tab.png`, fullPage: true });
      await page.locator('.list .card').filter({ hasText: 'Too far away' }).getByRole('button', { name: 'Unmark' }).click();
      await page.waitForTimeout(600);
      console.log(
        `REPLACE before=${before} after=${after} markedText=${markedText} flags=${flags} noteShown=${noteShown} ` +
          `tabCount="${tabCount}" afterUnmark=${await page.locator('.list .card').count()}`,
      );

      // The greyed-examples dex view, then back to empty slots for the rest of the run.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(1000);
      await page.getByRole('radio', { name: 'Greyed examples' }).click();
      await page.waitForTimeout(1200);
      const greyed = await page.locator('.plate .example-img').count();
      const ownPhotos = await page.locator('.plate.photographed .frame img:not(.example-img)').count();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-dex-examples.png`, fullPage: true });
      await page.goto(new URL('#/c/bow-valley/species/6', base).href);
      await page.waitForTimeout(1200);
      const heroNote = await page.locator('.example-note').count();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-species-example.png`, fullPage: true });
      await page.goto(new URL('#/c/bow-valley/families', base).href);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-families-examples.png`, fullPage: true });
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(900);
      const remembered = await page.getByRole('radio', { name: 'Greyed examples' }).getAttribute('aria-checked');
      await page.getByRole('radio', { name: 'Empty slots' }).click();
      await page.waitForTimeout(500);
      console.log(
        `EXAMPLES greyed=${greyed} ownPhotos=${ownPhotos} heroNote=${heroNote} remembered=${remembered} ` +
          `afterSwitchBack=${await page.locator('.plate .example-img').count()}`,
      );

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
