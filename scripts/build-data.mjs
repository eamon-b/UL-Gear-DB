#!/usr/bin/env node
/**
 * build-data.mjs: validates data/raw/*.json against data/SCHEMA.md and writes
 *   public/data/gear.json  (compact bundle used by the app, categories embedded)
 *   data/report.json       (validation report)
 *
 * Files whose name starts with "_" (e.g. _sample.json) are fixtures; they are
 * only used when no other raw file yields any valid item.
 *
 * Env overrides (handy for testing): RAW_DIR, OUT_FILE, REPORT_FILE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.resolve(ROOT, process.env.RAW_DIR || 'data/raw');
const CATS_FILE = path.join(ROOT, 'data/categories.json');
const ALIASES_FILE = path.join(ROOT, 'data/aliases.json');
const OUT_FILE = path.resolve(ROOT, process.env.OUT_FILE || 'public/data/gear.json');
const REPORT_FILE = path.resolve(ROOT, process.env.REPORT_FILE || 'data/report.json');

const WEIGHT_BASIS = ['manufacturer', 'measured', 'estimate'];
const CONFIDENCE = ['high', 'medium', 'low'];

const categories = JSON.parse(fs.readFileSync(CATS_FILE, 'utf8'));
const catById = new Map(categories.map((c) => [c.id, c]));

// ---------- helpers ----------
const isStr = (v) => typeof v === 'string';
const clean = (v) => (isStr(v) ? v.replace(/\s+/g, ' ').trim() : v);
const nonEmpty = (v) => (isStr(v) ? (clean(v) || null) : v == null ? null : String(v).trim() || null);
const slugify = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/°/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isStr(v)) {
    const t = v.replace(/[\s$,]/g, '').replace(/(usd|g|grams)$/i, '');
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const norm = (s) => String(s).toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim();
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  let inter = 0;
  tx.forEach((t) => {
    if (ty.has(t) || ty.has(t.replace(/s$/, '')) || ty.has(t + 's')) inter++;
  });
  const jac = inter / (tx.size + ty.size - inter);
  const contains = x.includes(y) || y.includes(x) ? 0.75 : 0;
  return Math.max(lev, jac, contains);
}

function matchSubcategory(raw, cat) {
  const subs = cat.subcategories;
  const v = nonEmpty(raw);
  if (v && subs.includes(v)) return { value: v, changed: false };
  if (v) {
    const ci = subs.find((s) => s.toLowerCase() === v.toLowerCase());
    if (ci) return { value: ci, changed: true, how: 'case' };
    let best = null, bestScore = 0;
    for (const s of subs) {
      const sc = similarity(v, s);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (best && bestScore >= 0.6) return { value: best, changed: true, how: `closest (${bestScore.toFixed(2)})` };
  }
  if (subs.includes('other')) return { value: 'other', changed: true, how: 'other' };
  // No "other" bucket: fall back to the closest subcategory even when weak.
  let best = subs[0], bestScore = -1;
  if (v) for (const s of subs) { const sc = similarity(v, s); if (sc > bestScore) { bestScore = sc; best = s; } }
  return { value: best, changed: true, how: v ? `weak closest (${Math.max(0, bestScore).toFixed(2)})` : 'missing, defaulted' };
}

function cleanSpecs(specs, fixes) {
  if (specs == null) return {};
  if (typeof specs !== 'object' || Array.isArray(specs)) { fixes.push('specs not an object, dropped'); return {}; }
  const out = {};
  for (const [k0, v0] of Object.entries(specs)) {
    const k = slugify(k0).replace(/-/g, '_');
    if (!k) continue;
    let v = v0;
    if (v == null || v === '') continue;
    if (isStr(v)) {
      v = clean(v);
      if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
      else if (/^(true|yes)$/i.test(v)) v = true;
      else if (/^(false|no)$/i.test(v)) v = false;
    } else if (Array.isArray(v)) {
      v = v.map((x) => (isStr(x) ? clean(x) : x)).filter((x) => x !== '' && x != null).join(', ');
      if (!v) continue;
    } else if (typeof v === 'object') {
      v = JSON.stringify(v);
    }
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

// ---------- read files ----------
const allFiles = fs.existsSync(RAW_DIR) ? fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')).sort() : [];
const realFiles = allFiles.filter((f) => !f.startsWith('_'));
const fixtureFiles = allFiles.filter((f) => f.startsWith('_'));

const report = {
  generated_at: new Date().toISOString(),
  files: [],
  counts: {},
  total: 0,
  dropped: [],
  fixed: [],
  duplicate_ids: [],
  possible_duplicates: [],
  used_fixtures: false,
};

function processFiles(files) {
  const items = [];
  for (const file of files) {
    const fileInfo = { file, read: 0, kept: 0, dropped: 0, error: null };
    report.files.push(fileInfo);
    let data;
    try {
      const txt = fs.readFileSync(path.join(RAW_DIR, file), 'utf8');
      if (!txt.trim()) throw new Error('empty file');
      data = JSON.parse(txt);
    } catch (e) {
      fileInfo.error = `unreadable JSON: ${e.message}`;
      continue;
    }
    if (!Array.isArray(data)) data = Array.isArray(data?.items) ? data.items : null;
    if (!data) { fileInfo.error = 'not an array'; continue; }
    const fileCat = file.replace(/^_/, '').replace(/\.json$/, '');
    data.forEach((raw, idx) => {
      fileInfo.read++;
      const where = `${file}[${idx}]`;
      const fixes = [];
      const drop = (reason) => {
        fileInfo.dropped++;
        report.dropped.push({ where, id: raw?.id ?? null, reason });
      };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return drop('not an object');

      // category
      let category = nonEmpty(raw.category);
      if (!category || !catById.has(category)) {
        const slug = category ? slugify(category) : null;
        if (slug && catById.has(slug)) { fixes.push(`category "${category}" -> "${slug}"`); category = slug; }
        else if (catById.has(fileCat)) { fixes.push(`category "${category}" -> "${fileCat}" (from filename)`); category = fileCat; }
        else return drop(`invalid category "${category}"`);
      }
      const cat = catById.get(category);

      const brand = nonEmpty(raw.brand);
      const model = nonEmpty(raw.model);
      if (!brand) return drop('missing brand');
      if (!model) return drop('missing model');

      // weight
      let w = toNumber(raw.weight_g);
      if (w == null && raw.weight_oz != null) {
        const oz = toNumber(raw.weight_oz);
        if (oz != null) { w = oz * 28.3495; fixes.push('weight from weight_oz'); }
      }
      if (w == null) return drop(`invalid weight_g ${JSON.stringify(raw.weight_g)}`);
      if (typeof raw.weight_g !== 'number' && raw.weight_oz == null) fixes.push('weight_g coerced from string');
      const wr = Math.round(w);
      if (wr !== w) fixes.push(`weight_g rounded ${w} -> ${wr}`);
      if (!(wr > 0)) return drop(`weight_g not > 0 (${w})`);

      // price
      let price = null;
      if (raw.price_usd != null && raw.price_usd !== '') {
        price = toNumber(raw.price_usd);
        if (price == null || price < 0) { fixes.push(`price_usd ${JSON.stringify(raw.price_usd)} -> null`); price = null; }
        else if (typeof raw.price_usd !== 'number') fixes.push('price_usd coerced from string');
        if (price != null) price = Math.round(price * 100) / 100;
      }

      // subcategory
      const sm = matchSubcategory(raw.subcategory, cat);
      if (sm.changed) fixes.push(`subcategory "${raw.subcategory ?? ''}" -> "${sm.value}" (${sm.how})`);

      const variant = nonEmpty(raw.variant);
      let id = nonEmpty(raw.id);
      const idSlug = id ? slugify(id) : slugify([brand, model, variant].filter(Boolean).join(' '));
      if (!id) fixes.push(`id generated "${idSlug}"`);
      else if (idSlug !== id) fixes.push(`id "${id}" -> "${idSlug}"`);
      id = idSlug;
      if (!id) return drop('could not derive id');

      const wb = nonEmpty(raw.weight_basis);
      const conf = nonEmpty(raw.confidence);
      const item = {
        id,
        category,
        subcategory: sm.value,
        brand,
        model,
        variant,
        weight_g: wr,
        weight_basis: WEIGHT_BASIS.includes(wb) ? wb : 'manufacturer',
        weight_note: nonEmpty(raw.weight_note),
        price_usd: price,
        specs: cleanSpecs(raw.specs, fixes),
        url: nonEmpty(raw.url),
        discontinued: raw.discontinued === true || raw.discontinued === 'true',
        confidence: CONFIDENCE.includes(conf) ? conf : 'low',
        notes: nonEmpty(raw.notes),
      };
      if (wb && !WEIGHT_BASIS.includes(wb)) fixes.push(`weight_basis "${wb}" -> manufacturer`);
      if (conf && !CONFIDENCE.includes(conf)) fixes.push(`confidence "${conf}" -> low`);
      if (!conf) fixes.push('confidence missing -> low');
      if (fixes.length) report.fixed.push({ where, id, fixes });
      fileInfo.kept++;
      items.push({ item, where });
    });
  }
  return items;
}

let entries = processFiles(realFiles);
if (entries.length === 0 && fixtureFiles.length) {
  report.used_fixtures = true;
  entries = processFiles(fixtureFiles);
}

// ---------- duplicates ----------
const seen = new Map();
const byContent = new Map();
for (const e of entries) {
  const it = e.item;
  const base = it.id;
  if (seen.has(base)) {
    let n = 2;
    while (seen.has(`${base}-${n}`)) n++;
    it.id = `${base}-${n}`;
    report.duplicate_ids.push({ id: base, renamed_to: it.id, where: e.where, first: seen.get(base) });
  }
  seen.set(it.id, e.where);
  const key = [it.category, it.brand, it.model, it.variant || ''].map(norm).join('|');
  if (byContent.has(key)) report.possible_duplicates.push({ key, a: byContent.get(key), b: `${e.where} (${it.id})` });
  else byContent.set(key, `${e.where} (${it.id})`);
}

const items = entries.map((e) => e.item);

// ---------- id aliases (old id -> current id), for merged duplicates / renamed ids ----------
const aliases = {};
report.aliases = { kept: 0, ignored: [] };
if (fs.existsSync(ALIASES_FILE)) {
  const raw = JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf8'));
  for (const [from, to] of Object.entries(raw)) {
    if (from.startsWith('_')) continue;
    if (seen.has(from)) report.aliases.ignored.push({ from, to, reason: 'old id is still a real item' });
    else if (!seen.has(to)) report.aliases.ignored.push({ from, to, reason: 'target id not found' });
    else { aliases[from] = to; report.aliases.kept++; }
  }
}
items.sort((a, b) => a.category.localeCompare(b.category) || a.weight_g - b.weight_g);
for (const c of categories) report.counts[c.id] = 0;
for (const it of items) report.counts[it.category]++;
report.total = items.length;

// ---------- write ----------
// Compact: drop null / default-valued fields; the client re-hydrates defaults.
const compactItems = items.map((it) => {
  const o = {};
  for (const [k, v] of Object.entries(it)) {
    if (v == null) continue;
    if (k === 'discontinued' && v === false) continue;
    if (k === 'weight_basis' && v === 'manufacturer') continue;
    if (k === 'specs' && Object.keys(v).length === 0) continue;
    o[k] = v;
  }
  return o;
});
const bundle = {
  v: 1,
  generated_at: report.generated_at,
  sample: report.used_fixtures,
  categories: categories.map((c) => ({ ...c, count: report.counts[c.id] })),
  items: compactItems,
  aliases,
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(bundle));
fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');

// ---------- console report ----------
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nUL Gear DB data build  (${path.relative(ROOT, RAW_DIR)})`);
if (report.used_fixtures) console.log('  NOTE: no real data files with valid items; using _fixture files.');
for (const f of report.files) {
  console.log(`  ${pad(f.file, 30)} read ${pad(f.read, 5)} kept ${pad(f.kept, 5)} dropped ${f.dropped}${f.error ? `  ERROR: ${f.error}` : ''}`);
}
console.log('\n  Items per category:');
for (const c of categories) if (report.counts[c.id]) console.log(`    ${pad(c.id, 22)} ${report.counts[c.id]}`);
const empty = categories.filter((c) => !report.counts[c.id]).map((c) => c.id);
if (empty.length) console.log(`    (empty: ${empty.join(', ')})`);
console.log(`\n  Total: ${report.total}   fixed: ${report.fixed.length}   dropped: ${report.dropped.length}   duplicate ids: ${report.duplicate_ids.length}   possible dupes: ${report.possible_duplicates.length}`);
for (const d of report.dropped.slice(0, 25)) console.log(`    DROP ${d.where} ${d.id ?? ''}: ${d.reason}`);
if (report.dropped.length > 25) console.log(`    ... ${report.dropped.length - 25} more (see data/report.json)`);
for (const d of report.duplicate_ids.slice(0, 25)) console.log(`    DUP  ${d.id} at ${d.where} -> ${d.renamed_to} (first at ${d.first})`);
for (const d of report.possible_duplicates.slice(0, 10)) console.log(`    SAME? ${d.a}  ~  ${d.b}`);
for (const d of report.aliases.ignored) console.log(`    ALIAS ignored ${d.from} -> ${d.to}: ${d.reason}`);
console.log(`\n  Wrote ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${path.relative(ROOT, REPORT_FILE)}\n`);

// --strict (used in CI): fail on problems that would otherwise only show up in the report.
if (process.argv.includes('--strict')) {
  const problems = [
    ...report.files.filter((f) => f.error).map((f) => `${f.file}: ${f.error}`),
    ...report.dropped.map((d) => `dropped ${d.where} ${d.id ?? ''}: ${d.reason}`),
    ...report.duplicate_ids.map((d) => `duplicate id ${d.id} at ${d.where}`),
    ...report.aliases.ignored.map((d) => `alias ${d.from} -> ${d.to}: ${d.reason}`),
    ...(report.used_fixtures ? ['no real data: fell back to fixtures'] : []),
  ];
  if (problems.length) {
    console.error(`  --strict: ${problems.length} data problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
}
