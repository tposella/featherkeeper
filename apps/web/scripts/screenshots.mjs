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
  ['admin', '#/admin'],
  ['account', '#/account'],
  ['log-bulk', '#/c/bow-valley/log/bulk'],
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
    // The phone run behaves like a phone: touch, and the page laid out to the device width.
    const phone = vpName === 'mobile';
    const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
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
      if (phone) {
        // Nothing should be wider than the screen (that makes the whole page scroll sideways).
        const wide = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const out = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') {
              const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
              out.push(`${el.tagName.toLowerCase()}${cls}(${Math.round(r.right)})`);
            }
          }
          return { scrollWidth: document.documentElement.scrollWidth, width: w, offenders: out.slice(0, 6) };
        });
        console.log(`OVERFLOW ${name} scrollWidth=${wide.scrollWidth} width=${wide.width} ${wide.offenders.join(' ')}`);
      }
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
      // Hovering a month and an hour in "When and where to find it" shows the count and share.
      await page.locator('.bars.months .bar').nth(4).hover();
      const monthTip = (await page.locator('.bars.months .tip').innerText()).replace(/\s+/g, ' ');
      await page.locator('.bars.months').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-insights-tip.png` });
      await page.locator('.bars.hours .bar').nth(4).hover();
      const hourTip = (await page.locator('.bars.hours .tip').innerText()).replace(/\s+/g, ' ');
      console.log(`TIPS month="${monthTip}" hour="${hourTip}"`);
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
      if (phone) {
        // On phones the less-used sections are in the bottom bar's More sheet.
        await page.getByRole('button', { name: 'More' }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/${vpName}-${scheme}-more-sheet.png` });
      }
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

      // Greyed examples are the default dex view; empty slots are one click away and remembered.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(1200);
      const byDefault = await page.getByRole('switch', { name: 'Greyed examples' }).getAttribute('aria-checked');
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
      await page.getByRole('switch', { name: 'Greyed examples' }).click();
      await page.waitForTimeout(500);
      const slotsShown = await page.locator('.plate .example-img').count();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-dex-slots.png`, fullPage: true });
      await page.goto(new URL('#/c/bow-valley/families', base).href);
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(900);
      const remembered = (await page.getByRole('switch', { name: 'Greyed examples' }).getAttribute('aria-checked')) === 'false';
      await page.getByRole('switch', { name: 'Greyed examples' }).click();
      await page.waitForTimeout(500);
      console.log(
        `EXAMPLES byDefault=${byDefault} greyed=${greyed} ownPhotos=${ownPhotos} heroNote=${heroNote} ` +
          `slotsShown=${slotsShown} slotsRemembered=${remembered} afterSwitchBack=${await page.locator('.plate .example-img').count()}`,
      );

      // Version badge: in the top bar next to the logo; the demo admin sees a sample update.
      await page.goto(new URL('#/c/bow-valley', base).href);
      await page.waitForTimeout(900);
      const versionBadge = page.locator('.topbar .version .badge');
      await versionBadge.scrollIntoViewIfNeeded();
      const badgeText = (await versionBadge.innerText()).replace(/\s+/g, ' ');
      await versionBadge.click();
      await page.waitForTimeout(300);
      const panelText = (await page.locator('.version .panel').innerText()).replace(/\s+/g, ' ').slice(0, 120);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-version-panel.png` });
      await page.getByRole('button', { name: 'Not now' }).click();
      const afterNotNow = (await versionBadge.innerText()).replace(/\s+/g, ' ');
      const box = await versionBadge.boundingBox();
      const brand = await page.locator('.topbar .brand').boundingBox();
      console.log(
        `VERSION badge="${badgeText}" panel="${panelText}" afterNotNow="${afterNotNow}" ` +
          `rightOfLogo=${box.x > brand.x + brand.width - 1 && Math.abs(box.y + box.height / 2 - (brand.y + brand.height / 2)) < 12}`,
      );

      // Light/dark toggle: starts from the system setting, flips, survives a reload, and flips back.
      const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const themeSwitch = page.getByRole('switch', { name: 'Dark mode' });
      const startDark = await themeSwitch.getAttribute('aria-checked');
      const startBg = await bg();
      await themeSwitch.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-theme-toggled.png` });
      await page.reload();
      await page.waitForTimeout(1200);
      const afterReload = await page.getByRole('switch', { name: 'Dark mode' }).getAttribute('aria-checked');
      const toggledBg = await bg();
      await page.getByRole('switch', { name: 'Dark mode' }).click();
      await page.waitForTimeout(200);
      console.log(
        `THEME system=${scheme} startDark=${startDark} afterReload=${afterReload} bgChanged=${startBg !== toggledBg} ` +
          `backToSystem=${(await bg()) === startBg} stored=${await page.evaluate(() => localStorage.getItem('featherkeeper:theme'))}`,
      );

      if (phone) {
        // Bottom bar: every section reachable, Log in the middle, and swiping in the photo viewer.
        await page.goto(new URL('#/c/bow-valley', base).href);
        await page.waitForTimeout(900);
        const bar = page.getByRole('navigation', { name: 'Catalogue sections' }).filter({ has: page.locator('.log-tab') });
        const barItems = await bar.locator('a, button').allInnerTexts();
        await bar.getByRole('link', { name: 'Families' }).click();
        await page.waitForTimeout(600);
        const onFamilies = page.url().includes('/families');
        await page.goto(new URL('#/c/bow-valley/species/21', base).href);
        await page.waitForTimeout(1500);
        await page.locator('.album-tile').first().click();
        await page.waitForTimeout(300);
        const before = await page.locator('.lightbox .count').innerText();
        const box = await page.locator('.lightbox .stage').boundingBox();
        const y = box.y + box.height / 2;
        await page.locator('.lightbox .stage').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: box.x + box.width - 30, clientY: y }] });
        await page.locator('.lightbox .stage').dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: box.x + 30, clientY: y }] });
        await page.waitForTimeout(300);
        const after = await page.locator('.lightbox .count').innerText();
        await page.screenshot({ path: `${out}/${vpName}-${scheme}-lightbox-phone.png` });
        await page.keyboard.press('Escape');
        console.log(`PHONE bar=${JSON.stringify(barItems.map((t) => t.trim()))} onFamilies=${onFamilies} swipe="${before}" -> "${after}"`);
      }

      // AI suggestions for an unidentified photo, then accepting the top match.
      await page.goto(new URL('#/c/bow-valley/log', base).href);
      // Wait for the log page itself, so the previous page's "Add photos" field isn't picked by mistake.
      await page.getByRole('heading', { name: 'Log a sighting' }).waitFor();
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGklEQVR4nGNgoBpgZGRkZGRkYGBgYGRkZgYAAU0AF0w0OTQAAAAASUVORK5CYII=',
        'base64',
      );
      await page.locator('input[type=file]').first().setInputFiles({ name: 'unknown-bird.png', mimeType: 'image/png', buffer: png });
      await page
        .getByText('Strong match')
        .first()
        .waitFor({ timeout: 8000 })
        .catch(async (err) => {
          await page.screenshot({ path: `${out}/${vpName}-${scheme}-ai-failed.png`, fullPage: true });
          console.log(`AI-FAILED url=${page.url()} text=${(await page.locator('main').innerText()).slice(0, 600).replace(/\s+/g, ' ')}`);
          throw err;
        });
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

      // Bulk upload: two photos, a species for the first, "Same for next", save.
      await page.goto(new URL('#/c/bow-valley/log/bulk', base).href);
      await page.getByRole('heading', { name: 'Bulk upload' }).waitFor();
      await page.locator('input[type=file]').first().setInputFiles([
        { name: 'shoot-1.png', mimeType: 'image/png', buffer: png },
        { name: 'shoot-2.png', mimeType: 'image/png', buffer: png },
      ]);
      await page.waitForTimeout(800);
      const bulkItems = await page.locator('.items .item').count();
      await page.locator('.items .item').first().getByPlaceholder('Species').fill('Mallard');
      await page.locator('.items .item').first().getByRole('button', { name: 'Same for next' }).click();
      const readyText = (await page.locator('.savebar').innerText()).replace(/\s+/g, ' ');
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-bulk-ready.png`, fullPage: true });
      await page.getByRole('button', { name: /^Save \d+ photo/ }).click();
      await page.getByText(/^Saved \d+ sighting/).waitFor({ timeout: 8000 });
      const savedText = (await page.locator('.savebar').innerText()).replace(/\s+/g, ' ');
      console.log(`BULK items=${bulkItems} ready="${readyText.slice(0, 80)}" saved="${savedText.slice(0, 80)}"`);

      // Site admin: an invite link for a new account.
      await page.goto(new URL('#/admin', base).href);
      await page.getByRole('button', { name: 'Make invite link' }).waitFor();
      await page.getByLabel(/^Note/).fill('Sam from the birding club');
      await page.getByRole('button', { name: 'Make invite link' }).click();
      await page.waitForTimeout(400);
      const inviteShown = await page.locator('.new-invite code').innerText();
      await page.screenshot({ path: `${out}/${vpName}-${scheme}-admin-invite.png`, fullPage: true });
      console.log(`ADMIN invite="${inviteShown.slice(0, 60)}" pending=${await page.locator('.invites li').count()}`);

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
