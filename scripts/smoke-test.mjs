#!/usr/bin/env node
/**
 * Playwright smoke test. Start `npx vite preview --port 4173` first, then:
 *   node scripts/smoke-test.mjs [baseUrl]
 * Uses playwright-core with a preinstalled Chromium (CHROMIUM_PATH env overrides).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:4173/';
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  // ---- Browse home
  await page.goto(BASE);
  await page.waitForSelector('.cat-card');
  check('home shows category cards', (await page.locator('.cat-card').count()) >= 20);
  await page.screenshot({ path: path.join(SHOTS, '01-home.png') });

  // ---- Browse a category
  await page.click('.cat-card:has-text("Shelters")');
  await page.waitForSelector('table.gear tbody tr[data-id]');
  const rowCount = await page.locator('table.gear tbody tr[data-id]').count();
  check('shelter table renders', rowCount > 5, `${rowCount} rows`);
  check('scatter renders points', (await page.locator('.scatter circle.pt').count()) > 5);
  check('pareto frontier marked', (await page.locator('.scatter circle.pt.front').count()) >= 1);

  // ---- Sort by weight desc then asc
  const weights = async () => (await page.locator('table.gear tbody tr[data-id] td.num.strong').allTextContents()).slice(0, 10).map((t) => parseFloat(t.replace(/,/g, '')));
  await page.click('th.sortable:has-text("Weight")'); // toggles to desc
  let w = await weights();
  check('sort weight desc', w.every((v, i) => i === 0 || v <= w[i - 1]), w.slice(0, 4).join(','));
  await page.click('th.sortable:has-text("Price")');
  const prices = (await page.locator('table.gear tbody tr[data-id] td:nth-child(5)').allTextContents()).slice(0, 8).map((t) => parseFloat(t.replace(/[$,]/g, '')));
  check('sort price asc', prices.filter((x) => !isNaN(x)).every((v, i, a) => i === 0 || v >= a[i - 1]), prices.slice(0, 4).join(','));

  // ---- Filter: text + subcategory + spec
  const before = await page.locator('table.gear tbody tr[data-id]').count();
  await page.fill('.filters .search-in', 'durston');
  await page.waitForTimeout(150);
  const afterQ = await page.locator('table.gear tbody tr[data-id]').count();
  const names = await page.locator('table.gear tbody tr[data-id] .c-name').allTextContents();
  check('text filter', afterQ > 0 && afterQ < before && names.every((n) => /durston/i.test(n)), `${afterQ} rows`);
  await page.fill('.filters .search-in', '');
  await page.click('.ms-btn:has-text("Type")');
  await page.click('.ms-opt:has-text("tarp") input');
  await page.keyboard.press('Escape');
  await page.click('h1.cat-title');
  await page.waitForTimeout(100);
  const subs = await page.locator('table.gear tbody tr[data-id] td:nth-child(3)').allTextContents();
  check('subcategory filter', subs.length > 0 && subs.every((s) => s === 'tarp'), `${subs.length} tarps`);
  // more filters panel open by default on desktop: toggle "hide discontinued" and a boolean spec if present
  await page.click('.tog:has-text("Hide discontinued") input');
  check('spec filters generated', (await page.locator('.filter-grid .fg').count()) > 4, `${await page.locator('.filter-grid .fg').count()} filter groups`);
  await page.screenshot({ path: path.join(SHOTS, '02-browse-shelters.png') });
  await page.click('.btn:has-text("Reset")');

  // ---- Unit toggle
  await page.click('.unit-seg .seg-opt:has-text("oz")');
  const wtxt = await page.locator('table.gear tbody tr[data-id] td.num.strong').first().textContent();
  check('unit toggle to oz', /oz/.test(wtxt ?? ''), wtxt ?? '');
  await page.click('.unit-seg .seg-opt:has-text("g")');

  // ---- Compare 3 items
  const cbs = page.locator('table.gear tbody tr[data-id] td.c-cmp input');
  for (let i = 0; i < 3; i++) await cbs.nth(i).check();
  await page.click('.compare-tray a:has-text("Compare")');
  await page.waitForSelector('table.compare');
  check('compare view has 3 columns', (await page.locator('table.compare thead th').count()) === 4);
  check('compare highlights best', (await page.locator('table.compare td.best').count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, '03-compare.png') });
  await page.click('.btn:has-text("Clear all")');

  // ---- Drawer + global search
  await page.fill('.qsearch input', 'inreach mini');
  await page.waitForSelector('.qs-pop .qs-item');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawer');
  check('global search opens item drawer', /inReach/i.test((await page.locator('.drawer h2').textContent()) ?? ''));
  await page.click('.drawer .btn.primary'); // add to list (creates first list)
  await page.keyboard.press('Escape');
  await page.goto(BASE + '#/search?q=ultralight');
  await page.waitForTimeout(200);
  check('search results page', (await page.locator('table.gear tbody tr[data-id]').count()) > 0);

  // ---- Lists: create list, add items
  await page.goto(BASE + '#/lists');
  await page.waitForSelector('.list-editor');
  check('list created from drawer add', (await page.locator('.list-table tbody tr[data-uid]').count()) === 1);
  for (const q of ['duplex', 'southwest 55', 'befree', 'pocketrocket 2']) {
    await page.fill('.addbar .search-in', q);
    await page.waitForSelector('.add-res');
    await page.click('.add-res >> nth=0');
  }
  // custom item
  await page.click('.btn:has-text("Custom item")');
  await page.fill('[aria-label="Custom item name"]', 'Snacks');
  await page.fill('[aria-label="Custom item category"]', 'Food');
  await page.fill('[aria-label="Custom item weight"]', '500');
  await page.fill('[aria-label="Custom item price"]', '20');
  await page.click('.custom-form button[type=submit]');
  const nRows = await page.locator('.list-table tbody tr[data-uid]').count();
  check('list has 6 items', nRows === 6, `${nRows}`);
  // mark Snacks consumable, edit qty
  const snack = page.locator('.list-table tbody tr[data-uid]:has(input[value="Snacks"])');
  await snack.locator('input[aria-label="Consumable"]').check();
  const qty = snack.locator('input[aria-label="Quantity"]');
  await qty.fill('2');
  await qty.press('Enter');
  await page.waitForTimeout(100);
  const consTxt = await page.locator('.tot:has-text("Consumable") .tot-v').textContent();
  check('consumable total = 1000 g', /1,000|1000/.test(consTxt ?? ''), consTxt ?? '');
  check('donut renders', (await page.locator('.breakdown path').count()) >= 3);
  await page.screenshot({ path: path.join(SHOTS, '04-list.png'), fullPage: true });

  // ---- Alternatives + swap
  const tentRow = page.locator('.list-table tbody tr[data-uid]:has(.item-link:has-text("Duplex"))').first();
  const tentName = await tentRow.locator('.item-link').textContent();
  await tentRow.locator('button:has-text("Alternatives")').click();
  await page.waitForSelector('.modal table.gear tbody tr.is-ref');
  {
    const refType = (await page.locator('.modal table.gear tbody tr.is-ref td.c-type').textContent())?.trim();
    const types = await page.locator('.modal table.gear tbody tr[data-id] td.c-type').allTextContents();
    check('alternatives default to the same type', types.length > 1 && types.every((t) => t.trim() === refType), `${types.length} × ${refType}`);
    const nSame = types.length;
    await page.click('.modal .filter-row.scope .seg-opt:has-text("All shelters")');
    const types2 = await page.locator('.modal table.gear tbody tr[data-id] td.c-type').allTextContents();
    check('one click widens to all shelters', new Set(types2).size > 1 && types2.length >= nSame, `${new Set(types2).size} types`);
    await page.click('.modal .filter-row.scope .seg-opt:has-text("Same type")');
  }
  check('alternatives shows filters + scatter', (await page.locator('.modal .filters').count()) === 1 && (await page.locator('.modal .scatter circle').count()) > 3);
  await page.click('.modal .btn:has-text("More filters")');
  check('alternatives has spec filters', (await page.locator('.modal .filter-grid .fg').count()) > 4);
  await page.click('.modal .chip:has-text("Lighter & cheaper")');
  await page.waitForTimeout(100);
  await page.click('.modal .chip:has-text("Lighter & cheaper")'); // off again
  await page.click('.modal .chip:has-text("Lighter")');
  await page.waitForTimeout(100);
  const deltas = await page.locator('.modal table.gear tbody tr:not(.is-ref)[data-id] td:nth-child(5)').allTextContents();
  check('lighter chip shows only negative deltas', deltas.length > 0 && deltas.every((d) => d.startsWith('−')), `${deltas.length} lighter`);
  await page.screenshot({ path: path.join(SHOTS, '05-alternatives.png') });
  const swapRow = page.locator('.modal table.gear tbody tr:not(.is-ref)[data-id]').first();
  const swapTo = await swapRow.locator('.item-link').textContent();
  await swapRow.locator('button.swap-btn').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  const namesAfter = await page.locator('.list-table .item-link').allTextContents();
  check('swap replaced list item', namesAfter.some((n) => n.trim() === swapTo?.trim()) && !namesAfter.includes(tentName ?? '#'), `${tentName} -> ${swapTo}`);

  // ---- Lighten my pack
  await page.click('.btn:has-text("Lighten my pack")');
  await page.waitForSelector('.lighten');
  await page.fill('.lighten input.budget', '2000');
  await page.waitForTimeout(100);
  check('lighten plan has swaps', (await page.locator('.lighten table tbody tr button:has-text("Swap")').count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, '06-lighten.png'), fullPage: true });

  // ---- Share URL round trip
  const baseTxt = await page.locator('.tot:has-text("Base weight") .tot-v').textContent();
  await page.click('.btn:has-text("Share link")');
  const link = await page.locator('[data-testid=share-link]').inputValue();
  check('share link generated', link.includes('#/share/'), `${link.length} chars`);
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.waitForSelector('.list-editor');
  const base2 = await p2.locator('.tot:has-text("Base weight") .tot-v').textContent();
  check('shared view matches base weight', base2 === baseTxt, `${baseTxt} vs ${base2}`);
  check('shared view is read-only', (await p2.locator('.addbar').count()) === 0);
  await p2.screenshot({ path: path.join(SHOTS, '07-shared.png'), fullPage: true });
  await p2.click('.btn:has-text("Copy to my lists")');
  await p2.waitForSelector('.lists-layout');
  check('copy to my lists', (await p2.locator('.list-nav a').count()) === 2);
  await p2.close();

  // ---- CSV import
  await page.goto(BASE + '#/lists');
  await page.setInputFiles('[data-testid=csv-input]', path.join(ROOT, 'scripts/fixtures/lighterpack-sample.csv'));
  await page.waitForSelector('.modal table.import');
  const rows = await page.locator('.modal table.import tbody tr').count();
  const matchedTxt = await page.locator('.modal-head h2 .muted').textContent();
  check('CSV review rows', rows === 17, `${rows} rows; ${matchedTxt}`);
  const picks = await page.locator('.modal table.import tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const s = tr.querySelector('select');
    return `${tr.querySelector('td')?.childNodes[0]?.textContent} => ${s?.selectedOptions[0]?.textContent}`;
  }));
  console.log('      ' + picks.join('\n      '));
  await page.screenshot({ path: path.join(SHOTS, '08-csv-review.png'), fullPage: true });
  await page.click('.modal-foot .btn.primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  const imported = await page.locator('.list-table tbody tr[data-uid]').count();
  check('CSV imported as new list', imported === 17, `${imported}`);
  const wornTxt = await page.locator('.tot:has-text("Worn") .tot-v').first().textContent();
  check('worn weight non-zero', !/^0/.test(wornTxt ?? '0'), wornTxt ?? '');

  // ---- List layout: the table never scrolls sideways; the chart moves above it when space is short
  const layout = () => page.evaluate(() => {
    const tw = document.querySelector('.table-wrap'), side = document.querySelector('.list-side'), main = document.querySelector('.list-main');
    return { overflow: tw.scrollWidth - tw.clientWidth, beside: side.getBoundingClientRect().left >= main.getBoundingClientRect().right - 1, nav: !!document.querySelector('.list-nav').offsetParent };
  });
  for (const w of [900, 1100, 1300, 1600, 1900]) {
    await page.setViewportSize({ width: w, height: 900 });
    const l = await layout();
    check(`list ${w}px: table fits`, l.overflow <= 0, `${l.overflow}px overflow, chart ${l.beside ? 'beside' : 'above'}`);
  }
  await page.setViewportSize({ width: 1300, height: 900 });
  check('list 1300px: chart above table', !(await layout()).beside);
  await page.click('.side-toggle');
  check('lists sidebar collapses', !(await layout()).nav);
  await page.reload();
  await page.waitForSelector('.list-table tbody tr[data-uid]');
  check('sidebar collapse persists', !(await layout()).nav);
  await page.click('.side-toggle');
  check('lists sidebar expands', (await layout()).nav);
  await page.setViewportSize({ width: 1400, height: 900 });

  // ---- CSV export round trip
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.btn:has-text("Export CSV")')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check('CSV export header', csv.startsWith('Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable'));
  check('CSV export rows', csv.trim().split('\n').length === 18);

  // ---- Example lists: import the lightest one through the CSV review, keeping its weights
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/examples.json'), 'utf8')).lists;
  await page.goto(BASE + '#/examples');
  await page.waitForSelector('.examples-table tbody tr');
  check('examples page lists every example', (await page.locator('.examples-table tbody tr').count()) === examples.length, `${examples.length}`);
  const ex = [...examples].sort((a, b) => a.base_g - b.base_g)[0];
  await page.screenshot({ path: path.join(SHOTS, '12-examples.png'), fullPage: true });
  await page.locator('.examples-table tbody tr').first().locator('.btn:has-text("Import")').click();
  await page.waitForSelector('.modal table.import');
  check('example review rows', (await page.locator('.modal table.import tbody tr').count()) === ex.items, `${ex.items}`);
  await page.click('.modal .btn:has-text("Keep my weights for all")');
  await page.click('.modal-foot .btn.primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForSelector('.list-table tbody tr[data-uid]');
  check('example imported as new list', (await page.locator('.list-table tbody tr[data-uid]').count()) === ex.items);
  await page.click('.unit-seg .seg-opt:has-text("g")');
  const grams = async (label) => {
    const t = (await page.locator(`.tot:has(.tot-l:text-is("${label}")) .tot-v`).first().textContent()) ?? '';
    return t.includes('kg') ? parseFloat(t) * 1000 : parseFloat(t.replace(/,/g, ''));
  };
  const total = await grams('Skin-out total');
  check('example weight matches registry', Math.abs(total - ex.total_g) <= ex.items + 10, `${Math.round(total)} g vs ${ex.total_g} g`);

  // ---- About, theme, mobile
  await page.goto(BASE + '#/about');
  await page.waitForSelector('.about');
  check('about page', (await page.locator('.about-counts tr').count()) >= 20);
  await page.click('.theme-btn'); // light
  await page.click('.theme-btn'); // dark
  await page.goto(BASE + '#/c/backpack');
  await page.waitForSelector('table.gear tbody tr[data-id]');
  await page.screenshot({ path: path.join(SHOTS, '09-dark-backpacks.png') });

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(BASE + '#/c/sleep-insulation');
  await mp.waitForSelector('table.gear tbody tr[data-id]');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile: no page horizontal overflow', overflow <= 1, `${overflow}px`);
  await mp.screenshot({ path: path.join(SHOTS, '10-mobile-browse.png') });
  // phone-width list: every row's Alternatives button must be on screen without sideways scrolling
  const lists = await page.evaluate(() => localStorage.getItem('ulgdb.lists'));
  await mp.evaluate((v) => localStorage.setItem('ulgdb.lists', v), lists);
  await mp.goto(BASE + '#/lists');
  await mp.reload(); // hash-only navigation doesn't reload the store from localStorage
  await mp.waitForSelector('.list-table tr[data-uid]');
  const offscreen = await mp.locator('.list-table tr[data-uid] button:has-text("Alternatives")').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().right > window.innerWidth).length);
  check('mobile: list actions visible', offscreen === 0, `${offscreen} off-screen`);
  await mp.screenshot({ path: path.join(SHOTS, '11-mobile-list.png'), fullPage: true });
  await m.close();
} catch (e) {
  check('unexpected exception', false, String(e).split('\n')[0]);
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {});
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
