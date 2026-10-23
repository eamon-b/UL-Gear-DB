#!/usr/bin/env node
// Applies data/patches/*.json to data/raw/*.json.
// Patch format: { "updates": [{ "id", "set": {...} }], "additions": [item, ...] }
// Updates are merged into the existing record (specs merged key-by-key).
// Additions go into data/raw/<category>.json; ids that already exist are skipped.
// Applied patches are moved to data/patches/applied/.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rawDir = path.join(root, 'data/raw');
const patchDir = path.join(root, 'data/patches');
const appliedDir = path.join(patchDir, 'applied');
const dryRun = process.argv.includes('--dry-run');

const files = {};
const byId = new Map();
for (const f of fs.readdirSync(rawDir)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const cat = f.replace(/\.json$/, '');
  files[cat] = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
  for (const item of files[cat]) byId.set(item.id, { item, cat });
}

const patches = fs.existsSync(patchDir)
  ? fs.readdirSync(patchDir).filter((f) => f.endsWith('.json'))
  : [];
if (!patches.length) {
  console.log('No patches to apply.');
  process.exit(0);
}

const touched = new Set();
for (const p of patches) {
  const patch = JSON.parse(fs.readFileSync(path.join(patchDir, p), 'utf8'));
  let updated = 0, added = 0, missing = [], dupes = [], moved = 0;

  for (const { id, set } of patch.updates ?? []) {
    const hit = byId.get(id);
    if (!hit) { missing.push(id); continue; }
    const { specs, ...rest } = set;
    Object.assign(hit.item, rest);
    if (specs) hit.item.specs = { ...(hit.item.specs ?? {}), ...specs };
    // A category change moves the record to another file.
    if (rest.category && rest.category !== hit.cat && files[rest.category]) {
      files[hit.cat] = files[hit.cat].filter((i) => i !== hit.item);
      files[rest.category].push(hit.item);
      touched.add(hit.cat);
      hit.cat = rest.category;
      moved++;
    }
    touched.add(hit.cat);
    updated++;
  }

  for (const item of patch.additions ?? []) {
    if (byId.has(item.id)) { dupes.push(item.id); continue; }
    if (!files[item.category]) { missing.push(`${item.id} (unknown category ${item.category})`); continue; }
    files[item.category].push(item);
    byId.set(item.id, { item, cat: item.category });
    touched.add(item.category);
    added++;
  }

  console.log(`${p}: ${updated} updated (${moved} moved), ${added} added`);
  if (missing.length) console.log(`  skipped, not found: ${missing.join(', ')}`);
  if (dupes.length) console.log(`  skipped, id already exists: ${dupes.join(', ')}`);
}

if (dryRun) {
  console.log('Dry run: nothing written.');
  process.exit(0);
}

for (const cat of touched) {
  fs.writeFileSync(path.join(rawDir, `${cat}.json`), JSON.stringify(files[cat], null, 2) + '\n');
}
fs.mkdirSync(appliedDir, { recursive: true });
for (const p of patches) fs.renameSync(path.join(patchDir, p), path.join(appliedDir, p));
console.log(`Wrote ${touched.size} files.`);
