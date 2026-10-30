#!/usr/bin/env node
/**
 * build-examples.mjs: bundles data/examples/registry.json and the CSV snapshots
 * in data/examples/csv/ into public/data/examples.json for the Examples page.
 * Runs offline; use scripts/fetch-examples.mjs to add or refresh lists.
 *
 * Env override: OUT_FILE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/examples');
const OUT_FILE = path.resolve(ROOT, process.env.OUT_FILE || 'public/data/examples.json');

const reg = fs.existsSync(path.join(DIR, 'registry.json'))
  ? JSON.parse(fs.readFileSync(path.join(DIR, 'registry.json'), 'utf8'))
  : { lists: [] };
const lists = [];
for (const l of reg.lists) {
  const file = path.join(DIR, 'csv', `${l.id}.csv`);
  if (!fs.existsSync(file)) {
    console.warn(`  examples: missing snapshot ${path.relative(ROOT, file)}, skipped`);
    continue;
  }
  lists.push({ ...l, csv: fs.readFileSync(file, 'utf8') });
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify({ lists }));
console.log(
  `  Wrote ${path.relative(ROOT, OUT_FILE)} (${lists.length} example lists, ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`,
);
