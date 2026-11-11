#!/usr/bin/env node
/**
 * Playwright smoke test for the parts that need the backend: short share links, sign-in and list
 * sync between two browsers. Run it against the local Worker serving a production build:
 *   npm run build
 *   (cd worker && cp -n .dev.vars.example .dev.vars && npm run migrate:local && npm run dev) &
 *   node scripts/smoke-account.mjs http://localhost:8787/
 * It signs in through the local dev login (DEV_AUTH=1 in worker/.dev.vars), so it cannot run against production.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8787/';
const exe =
  process.env.CHROMIUM_PATH ||
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const gear = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/gear.json'), 'utf8'));
const [it1, it2] = gear.items;
const email = `smoke${Date.now()}@example.com`;

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const errors = [];

const browser = await chromium.launch({ executablePath: exe });
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => {
    // the app asks for things that may be gone (a deleted share) and reports them itself
    if (m.type() === 'error' && !/status of 40[149]/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  return page;
}
const go = async (p, to) => {
  await p.goto(new URL(to, BASE).href);
  await p.waitForSelector('#root:not([data-route]) .topbar');
};
const listNames = (p) => p.locator('.list-nav a span:first-child').allTextContents();
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const signIn = async (p) => {
  await p.click('[data-testid=sign-in-btn]');
  await p.fill('[data-testid=dev-email]', email);
  await p.click('[data-testid=dev-sign-in]');
  await p.waitForSelector('[data-testid=account-btn]');
};
/** Bring another device's changes in, as coming back to the tab does. */
const syncNow = async (p) => {
  await p.click('[data-testid=account-btn]');
  await p.click('text=Sync now');
  await p.waitForFunction(() => /Synced/.test(document.querySelector('[data-testid=sync-line]')?.textContent ?? ''));
  await p.keyboard.press('Escape');
};

try {
  // ---------- no account ----------
  const a = await device('A');
  await go(a, 'lists');
  const now = Date.now();
  await a.evaluate(
    ([id1, id2, now]) =>
      localStorage.setItem(
        'ulgdb.lists',
        JSON.stringify({
          activeId: 'smokelist001',
          lists: [
            {
              id: 'smokelist001',
              name: 'Smoke <b>trip</b>',
              created: now,
              updated: now,
              items: [
                { uid: 'u1', dbId: id1, qty: 1, worn: false, consumable: false },
                { uid: 'u2', dbId: id2, qty: 2, worn: false, consumable: false },
              ],
            },
          ],
        }),
      ),
    [it1.id, it2.id, now],
  );
  await go(a, 'lists');
  check('anonymous: sign-in is offered, list is local', (await a.locator('[data-testid=sign-in-btn]').count()) === 1);
  check('anonymous: sidebar says where lists live', /stored in this browser/.test(await a.textContent('[data-testid=lists-where]')));

  await a.click('text=Share link');
  await a.waitForSelector('[data-testid=share-link]');
  const snap = await a.inputValue('[data-testid=share-link]');
  check('anonymous share: short link', /\/l\/[A-Za-z0-9]{8}$/.test(snap), snap);
  check('anonymous share: says it is a snapshot', /as it is right now/.test(await a.textContent('[data-testid=share-note]')));
  check('anonymous share: copied', (await a.evaluate(() => navigator.clipboard.readText())) === snap);

  const raw = await (await fetch(snap)).text();
  check(
    'share page: preview tags in raw HTML, name escaped',
    raw.includes('<title>Smoke &lt;b&gt;trip&lt;/b&gt;</title>') &&
      /og:description" content="Base weight [\d.]+ kg/.test(raw) &&
      !raw.includes('<b>trip'),
  );
  check('share page: not indexed', /name="robots" content="noindex"/.test(raw));

  const viewer = await device('viewer');
  await go(viewer, snap);
  await viewer.waitForSelector('.list-title-ro');
  check('share page: shows the list', (await viewer.textContent('.list-title-ro')) === 'Smoke <b>trip</b>');
  check('share page: title follows the list', /Shared list/.test(await viewer.title()));
  await viewer.click('text=Copy to my lists');
  await viewer.waitForURL(/\/lists\/[a-z0-9]+$/);
  check('share page: copy to my lists', (await listNames(viewer)).includes('Smoke <b>trip</b>'));
  await go(viewer, 'l/zzzzzzzz');
  check('share page: unknown id', /does not exist/.test(await viewer.textContent('.warn')));

  // ---------- sign in: local lists go up ----------
  await signIn(a);
  check('signed in: sidebar shows sync state', await until(async () => /Synced/.test(await a.textContent('[data-testid=lists-where]'))));

  const b = await device('B');
  await go(b, 'lists');
  check('second device: starts empty', (await listNames(b)).length === 0);
  await signIn(b);
  check('second device: list arrives after sign-in', await until(async () => (await listNames(b)).includes('Smoke <b>trip</b>')));

  // ---------- edits travel both ways ----------
  await b.click('.list-title');
  await b.keyboard.press('Control+A');
  await b.keyboard.type('Renamed on B');
  await b.keyboard.press('Enter');
  await until(async () => (await listNames(b)).includes('Renamed on B'));
  await b.waitForTimeout(2500); // debounced upload
  await syncNow(a);
  check('edit on B reaches A', await until(async () => (await listNames(a)).includes('Renamed on B')), (await listNames(a)).join(' | '));

  await a.click('text=＋ New');
  await a.waitForTimeout(2500);
  await syncNow(b);
  check('new list on A reaches B', await until(async () => (await listNames(b)).length === 2), (await listNames(b)).join(' | '));

  // ---------- live link ----------
  await a.click('.list-nav a:has-text("Renamed on B")');
  await a.click('text=Share link');
  await a.waitForSelector('text=Stop sharing');
  const live = await a.inputValue('[data-testid=share-link]');
  check('signed-in share: live link', /\/l\/[A-Za-z0-9]{8}$/.test(live) && live !== snap, live);
  await a.click('.list-title');
  await a.keyboard.press('Control+A');
  await a.keyboard.type('Live name');
  await a.keyboard.press('Enter');
  await a.waitForTimeout(2500);
  await go(viewer, live);
  await viewer.waitForSelector('.list-title-ro');
  check('live link: follows later edits', (await viewer.textContent('.list-title-ro')) === 'Live name');
  await go(viewer, snap);
  await viewer.waitForSelector('.list-title-ro');
  check('snapshot link: unchanged', (await viewer.textContent('.list-title-ro')) === 'Smoke <b>trip</b>');

  await a.click('[data-testid=account-btn]');
  check('account: lists the live link', await until(async () => (await a.locator('.account-links li').count()) >= 1));
  await a.keyboard.press('Escape');
  await a.click('text=Stop sharing');
  await a.waitForSelector('[data-testid=share-link]', { state: 'detached' });
  check('stop sharing: link is gone', (await fetch(live)).status === 404);

  // ---------- delete travels ----------
  a.once('dialog', (d) => d.accept());
  await a.click('.list-head >> text=Delete');
  await a.waitForTimeout(2500);
  await syncNow(b);
  check('delete on A reaches B', await until(async () => !(await listNames(b)).includes('Live name')), (await listNames(b)).join(' | '));

  // ---------- survives a reload, and signing out keeps the lists ----------
  await go(b, 'lists');
  check(
    'B: still signed in after reload, with no flash of the signed-out header',
    (await b.locator('[data-testid=account-btn]').count()) === 1,
  );
  const before = await listNames(b);
  await b.click('[data-testid=account-btn]');
  await b.click('[data-testid=sign-out]');
  await b.waitForSelector('[data-testid=sign-in-btn]');
  check('sign out: lists stay in the browser', (await listNames(b)).join('|') === before.join('|') && before.length > 0);
  await b.click('text=＋ New');
  await b.waitForTimeout(2500);
  await syncNow(a);
  check('signed-out edits stay local', (await listNames(a)).length === before.length, (await listNames(a)).join(' | '));

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
