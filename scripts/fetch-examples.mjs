#!/usr/bin/env node
/**
 * fetch-examples.mjs: snapshots the published LighterPack lists named in
 * data/examples/sources.json and writes
 *   data/examples/csv/<id>.csv   (LighterPack's own CSV export, as published)
 *   data/examples/registry.json  (sources + list title and computed weights)
 *
 * Needs network access to lighterpack.com. Lists that fail to download keep
 * their previous snapshot; lists with no snapshot at all are reported and skipped.
 *
 *   npm run fetch-examples            # fetch lists without a snapshot
 *   npm run fetch-examples -- --all   # refresh every snapshot
 *   npm run fetch-examples -- --offline  # only recompute registry.json from snapshots
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/examples');
const CSV_DIR = path.join(DIR, 'csv');
const SOURCES = path.join(DIR, 'sources.json');
const REGISTRY = path.join(DIR, 'registry.json');
const LP = 'https://lighterpack.com';

const args = new Set(process.argv.slice(2));
const ALL = args.has('--all');
const OFFLINE = args.has('--offline');

// Same unit table and LighterPack semantics as src/lib/csv.ts and src/lib/lists.ts.
const UNIT_G = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
};
const truthy = (v) => {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return !!s && !['0', 'false', 'no', 'n', 'off'].includes(s);
};
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function stats(csv) {
  const { data } = Papa.parse(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const t = { items: 0, base_g: 0, worn_g: 0, consumable_g: 0, total_g: 0, cost_usd: 0 };
  const cats = new Map();
  for (const r of data) {
    if (!String(r['item name'] ?? '').trim()) continue;
    const q = Math.max(0, num(r.qty) ?? 1);
    const g =
      (num(r.weight) ?? 0) *
      (UNIT_G[
        String(r.unit ?? '')
          .trim()
          .toLowerCase()
      ] ?? UNIT_G.oz);
    const w = g * q;
    let base = 0;
    if (truthy(r.consumable)) t.consumable_g += w;
    else if (truthy(r.worn)) {
      const wornUnits = Math.min(1, q);
      t.worn_g += g * wornUnits;
      base = g * (q - wornUnits);
    } else base = w;
    t.base_g += base;
    t.total_g += w;
    t.items += 1;
    t.cost_usd += (num(r.price) ?? 0) * q;
    const cat = String(r.category ?? '').trim() || 'Uncategorized';
    cats.set(cat, (cats.get(cat) ?? 0) + base);
  }
  for (const k of ['base_g', 'worn_g', 'consumable_g', 'total_g', 'cost_usd']) t[k] = Math.round(t[k]);
  const categories = [...cats].sort((a, b) => b[1] - a[1]).map(([name, g]) => ({ name, base_g: Math.round(g) }));
  return { ...t, categories };
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function get(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': 'ul-gear-db example-list snapshot (+https://github.com/eamon-b/UL-Gear-DB)' },
      });
      if (r.ok) return await r.text();
      if (r.status < 500 || i >= 2) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i >= 2) throw e;
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
  }
}

async function fetchList(id) {
  const csv = await get(`${LP}/csv/${id}`);
  if (!/^﻿?Item Name,/.test(csv)) throw new Error('response is not a LighterPack CSV');
  let title = null;
  try {
    const html = await get(`${LP}/r/${id}`);
    title = decode(html.match(/<h1 class="lpListName">([\s\S]*?)<\/h1>/)?.[1] ?? '') || null;
  } catch {
    /* the title is optional */
  }
  return { csv, title };
}

const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
const prev = new Map((fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).lists : []).map((l) => [l.id, l]));
fs.mkdirSync(CSV_DIR, { recursive: true });

const seen = new Set();
const lists = [];
const failed = [];
for (const src of sources) {
  if (!/^[a-z0-9]+$/.test(src.id)) {
    failed.push(`${src.id}: invalid id`);
    continue;
  }
  if (seen.has(src.id)) {
    failed.push(`${src.id}: duplicate in sources.json`);
    continue;
  }
  seen.add(src.id);
  const file = path.join(CSV_DIR, `${src.id}.csv`);
  const old = prev.get(src.id);
  let meta = { title: old?.title ?? null, fetched_at: old?.fetched_at ?? null };
  if (!OFFLINE && (ALL || !fs.existsSync(file))) {
    try {
      const { csv, title } = await fetchList(src.id);
      fs.writeFileSync(file, csv.endsWith('\n') ? csv : csv + '\n');
      meta = { title: title ?? meta.title, fetched_at: new Date().toISOString().slice(0, 10) };
      process.stdout.write(`  ✓ ${src.id}  ${meta.title ?? ''}\n`);
    } catch (e) {
      failed.push(`${src.id}: ${e.message}${fs.existsSync(file) ? ' (kept old snapshot)' : ''}`);
    }
  }
  if (!fs.existsSync(file)) continue;
  const s = stats(fs.readFileSync(file, 'utf8'));
  if (!s.items) {
    failed.push(`${src.id}: snapshot has no items`);
    continue;
  }
  lists.push({ ...src, lighterpack_url: `${LP}/r/${src.id}`, ...meta, ...s });
}

for (const f of fs.readdirSync(CSV_DIR)) {
  if (f.endsWith('.csv') && !seen.has(f.slice(0, -4))) failed.push(`${f}: snapshot not in sources.json (delete it?)`);
}

lists.sort((a, b) => a.base_g - b.base_g);
fs.writeFileSync(
  REGISTRY,
  JSON.stringify(
    { note: 'Generated by scripts/fetch-examples.mjs from data/examples/sources.json. Do not edit by hand.', lists },
    null,
    2,
  ) + '\n',
);
console.log(`\n  ${lists.length} lists in ${path.relative(ROOT, REGISTRY)}`);
if (failed.length) console.log(`  ${failed.length} problem(s):\n    ${failed.join('\n    ')}`);
