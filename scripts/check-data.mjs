#!/usr/bin/env node
/**
 * check-data.mjs: flags likely-bad records in data/raw/*.json. It never edits data.
 *
 *   npm run check-data            print a report, write data/data-issues.json
 *   npm run check-data -- --all   print every issue instead of the top ones per type
 *
 * Checks (each issue has a type, a 0-100 score for sorting, and a message):
 *   unit-suspect       far from the subcategory median, but lands near it after an oz/lb/kg conversion
 *   weight-outlier     weight > 4x or < 0.25x the median of its category+subcategory ("other" skipped)
 *   price-per-gram     $/g > 8x or < 0.125x the subcategory median (price or weight likely wrong)
 *   shipping-weight    notes say "packaged", "shipping", "in box" etc., or weight is a suspicious
 *                      round pound value well above the median
 *   missing-url        no source url
 *   duplicate          same brand+model+variant (normalized) in more than one record
 *   near-duplicate     same brand, nearly identical model+variant, weight within 5%
 *   per-pair           trekking poles / footwear weights that look like a single pole or shoe
 *   bad-subcategory    subcategory not in data/categories.json (the build remaps it silently)
 *   bad-value          non-positive / non-numeric weight, negative price
 *
 * Exit code is always 0: this is a report for humans, not a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'data/data-issues.json');
const SHOW_ALL = process.argv.includes('--all');

const categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/categories.json'), 'utf8'));
const catById = new Map(categories.map((c) => [c.id, c]));

// ---------- load ----------
const records = [];
for (const file of fs
  .readdirSync(RAW_DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort()) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
  } catch (e) {
    console.warn(`  skip ${file}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(data)) continue;
  const fileCat = file.replace(/\.json$/, '');
  data.forEach((r, index) => {
    if (!r || typeof r !== 'object') return;
    const w = typeof r.weight_g === 'number' ? r.weight_g : parseFloat(r.weight_g);
    const p =
      r.price_usd == null || r.price_usd === ''
        ? null
        : typeof r.price_usd === 'number'
          ? r.price_usd
          : parseFloat(String(r.price_usd).replace(/[$,]/g, ''));
    records.push({
      file,
      index,
      raw: r,
      id: r.id ?? null,
      category: catById.has(r.category) ? r.category : fileCat,
      subcategory: r.subcategory ?? '',
      brand: String(r.brand ?? '').trim(),
      model: String(r.model ?? '').trim(),
      variant: r.variant ? String(r.variant).trim() : '',
      w: Number.isFinite(w) ? w : null,
      p: Number.isFinite(p) ? p : null,
      text: [r.weight_note, r.notes, r.variant, r.model].filter(Boolean).join(' | '),
    });
  });
}

const issues = [];
const add = (type, rec, score, message, details = {}) =>
  issues.push({
    type,
    score: Math.round(Math.max(0, Math.min(100, score))),
    id: rec.id,
    file: rec.file,
    index: rec.index,
    name: [rec.brand, rec.model, rec.variant].filter(Boolean).join(' '),
    category: rec.category,
    subcategory: rec.subcategory,
    weight_g: rec.w,
    price_usd: rec.p,
    message,
    ...(Object.keys(details).length ? { details } : {}),
  });

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const groupBy = (xs, key) => {
  const m = new Map();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
const fmtR = (r) => (r >= 1 ? `${r.toFixed(1)}x` : `1/${(1 / r).toFixed(1)}x`);

// ---------- bad values / subcategory / url ----------
for (const r of records) {
  if (r.w == null || !(r.w > 0)) add('bad-value', r, 95, `weight_g is ${JSON.stringify(r.raw.weight_g)}`);
  if (r.p != null && r.p < 0) add('bad-value', r, 80, `negative price ${r.p}`);
  const cat = catById.get(r.category);
  if (cat && !cat.subcategories.includes(r.subcategory)) {
    add('bad-subcategory', r, 30, `subcategory "${r.subcategory}" is not one of ${cat.id}'s subcategories (the build remaps it)`);
  }
  if (!r.raw.url || !String(r.raw.url).trim()) add('missing-url', r, 15, 'no source url');
  else if (!/^https?:\/\//.test(String(r.raw.url).trim())) add('missing-url', r, 20, `url is not http(s): ${r.raw.url}`);
}

// ---------- weight outliers per category+subcategory ----------
const valid = records.filter((r) => r.w > 0);
const bySub = groupBy(valid, (r) => `${r.category}|${r.subcategory}`);
const subMedian = new Map();
for (const [k, rs] of bySub) {
  if (rs.length < 5) continue;
  const med = median(rs.map((r) => r.w));
  subMedian.set(k, med);
  for (const r of rs) {
    const ratio = r.w / med;
    // Unit slips: a value that lands near the median once converted is the strongest signal of a typo.
    const near = (x) => x / med >= 0.67 && x / med <= 1.5;
    if (ratio > 3 || ratio < 0.33) {
      const unit = near(r.w / 28.3495)
        ? 'oz value converted to g twice (or g entered as oz)'
        : near(r.w * 28.3495)
          ? 'oz value entered as grams'
          : near(r.w / 1000)
            ? 'mg / or kg-vs-g slip'
            : near(r.w * 1000)
              ? 'kg value entered as grams'
              : near(r.w * 453.592)
                ? 'lb value entered as grams'
                : near(r.w * 0.453592)
                  ? 'lb treated as kg'
                  : null;
      if (unit && (ratio > 8 || ratio < 0.125) && r.subcategory !== 'other') {
        add(
          'unit-suspect',
          r,
          90,
          `weight ${r.w} g is ${fmtR(ratio)} the ${r.subcategory} median (${Math.round(med)} g); looks like a ${unit}`,
          { median_g: Math.round(med), ratio: +ratio.toFixed(2) },
        );
        continue;
      }
    }
    // "other" buckets are mixed by design, so a median says little there
    if (/^other$/.test(r.subcategory)) continue;
    if (ratio > 4 || ratio < 0.25) {
      // score grows with log distance from the median: 4x -> ~40, 16x -> ~80
      add(
        'weight-outlier',
        r,
        20 * Math.abs(Math.log2(ratio)),
        `weight ${r.w} g is ${fmtR(ratio)} the ${r.subcategory} median (${Math.round(med)} g, n=${rs.length})`,
        { median_g: Math.round(med), ratio: +ratio.toFixed(2) },
      );
    }
  }
}

// ---------- $/g outliers ----------
for (const [k, rs] of bySub) {
  const priced = rs.filter((r) => r.p != null && r.p > 0);
  if (priced.length < 6 || k.endsWith('|other')) continue;
  const med = median(priced.map((r) => r.p / r.w));
  for (const r of priced) {
    const ratio = r.p / r.w / med;
    if (ratio > 8 || ratio < 0.125) {
      add(
        'price-per-gram',
        r,
        12 * Math.abs(Math.log2(ratio)),
        `$${r.p} for ${r.w} g is ${fmtR(ratio)} the ${r.subcategory} median $/g (${med.toFixed(3)} $/g, n=${priced.length})`,
        { usd_per_g: +(r.p / r.w).toFixed(4), median_usd_per_g: +med.toFixed(4) },
      );
    }
  }
  void k;
}

// ---------- shipping / packaged weights ----------
const SHIP = /\b(ship(ping)?|packag(ed|ing)|in (the )?box|boxed|with packaging)\b/i;
const LB = 453.592;
for (const r of valid) {
  const note = [r.raw.weight_note, r.raw.notes].filter(Boolean).join(' | ');
  if (SHIP.test(note) && !/(not|excl\.?|excluding|without|w\/o|minus) (the )?(ship|packag)/i.test(note)) {
    // "minimum weight; packaged 105 g" quotes the packaged figure for reference: only flag
    // when the stored weight IS that figure, or when no other figure is given.
    const m = note.match(
      /(\d+(?:\.\d+)?)\s*(kg|g|oz|lb)\b[^|;,]*?\b(?:packag|shipping)|(?:packag\w*|shipping)(?: weight)?\s*(?:of\s*|~\s*)?(\d+(?:\.\d+)?)\s*(kg|g|oz|lb)\b/i,
    );
    if (m) {
      const v = parseFloat(m[1] ?? m[3]);
      const u = (m[2] ?? m[4]).toLowerCase();
      const g = v * { kg: 1000, g: 1, oz: 28.3495, lb: LB }[u];
      if (Math.abs(g - r.w) / r.w > 0.01 || /\bmin(imum)?\b|trail weight/i.test(note)) continue; // stored weight is a different (trail/min) figure
      add('shipping-weight', r, 45, `stored weight matches the packaged/shipping figure in the notes: "${note.slice(0, 120)}"`);
    } else {
      add('shipping-weight', r, 35, `notes say the weight may be a packaged/shipping weight: "${note.slice(0, 120)}"`);
    }
    continue;
  }
  const med = subMedian.get(`${r.category}|${r.subcategory}`);
  const lbs = r.w / LB;
  const quarterLb = Math.abs(lbs * 4 - Math.round(lbs * 4)) < 0.004;
  if (med && quarterLb && r.w >= 1.5 * med && r.w > 200) {
    add(
      'shipping-weight',
      r,
      25,
      `${r.w} g is exactly ${(Math.round(lbs * 4) / 4).toString()} lb and ${fmtR(r.w / med)} the median: possibly a rounded shipping weight`,
    );
  }
}

// ---------- per pair vs per item ----------
const PER_ONE = /\b(per (pole|shoe|boot|sock|item|unit|piece)|each|single (pole|shoe|boot)|one (pole|shoe|boot)|half pair)\b/i;
const PER_PAIR = /\b(pair|per pair|both)\b/i;
for (const r of valid) {
  const note = [r.raw.weight_note, r.raw.notes].filter(Boolean).join(' | ');
  if (r.category === 'trekking-poles') {
    if (PER_ONE.test(note) && !PER_PAIR.test(note))
      add('per-pair', r, 70, `note says per pole ("${note.slice(0, 80)}") but poles are stored per PAIR`);
    else if (r.w < 180 && !/single|monopod|staff/i.test(r.text))
      add('per-pair', r, 45, `${r.w} g is light for a pair of poles: likely a single-pole weight`);
    else if (r.w > 900) add('per-pair', r, 30, `${r.w} g is heavy for a pair of trekking poles`);
  }
  if (r.category === 'footwear') {
    const sub = r.subcategory;
    const shoe = /trail runner|hiking shoe|hiking boot/.test(sub);
    if (shoe && PER_ONE.test(note) && !PER_PAIR.test(note))
      add('per-pair', r, 70, `note says per shoe ("${note.slice(0, 80)}") but footwear is stored per PAIR`);
    else if (sub === 'trail runner' && r.w < 380) add('per-pair', r, 50, `${r.w} g is light for a pair of trail runners: likely one shoe`);
    else if (sub === 'hiking shoe' && r.w < 450) add('per-pair', r, 50, `${r.w} g is light for a pair of hiking shoes: likely one shoe`);
    else if (sub === 'hiking boot' && r.w < 600) add('per-pair', r, 50, `${r.w} g is light for a pair of boots: likely one boot`);
    else if (sub === 'sock' && r.w > 150) add('per-pair', r, 30, `${r.w} g is heavy for one pair of socks: multi-pack?`);
  }
}

// ---------- duplicates ----------
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const byKey = groupBy(records, (r) => `${norm(r.brand)}|${norm(r.model)}|${norm(r.variant)}`);
const dupIds = new Set();
for (const [, rs] of byKey) {
  if (rs.length < 2) continue;
  const crossFile = new Set(rs.map((r) => r.file)).size > 1;
  for (const r of rs.slice(1)) {
    dupIds.add(r.id);
    add(
      'duplicate',
      r,
      crossFile ? 75 : 60,
      `same brand+model+variant as ${rs[0].file}[${rs[0].index}] (${rs[0].id})${crossFile ? ' in another file' : ''}`,
      { other: `${rs[0].file}[${rs[0].index}]`, other_id: rs[0].id },
    );
  }
}
const byId = groupBy(
  records.filter((r) => r.id),
  (r) => r.id,
);
for (const [id, rs] of byId) {
  if (rs.length < 2) continue;
  for (const r of rs.slice(1)) {
    if (dupIds.has(r.id)) continue;
    add('duplicate', r, 65, `id "${id}" also used by ${rs[0].file}[${rs[0].index}] (different brand/model/variant)`, {
      other: `${rs[0].file}[${rs[0].index}]`,
    });
  }
}

function lev(a, b) {
  const m = a.length,
    n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// Tokens that make two similar names genuinely different products.
const DISTINCT =
  /\b(men s|women s|mens|womens|unisex|short|long|regular|wide|large|small|medium|xl|plus|pro|lite|ultra|mini|max|\d+[a-z]*)\b/g;
const byBrand = groupBy(
  records.filter((r) => r.w > 0),
  (r) => norm(r.brand),
);
for (const [, rs] of byBrand) {
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i],
        b = rs[j];
      const na = norm(`${a.model} ${a.variant}`),
        nb = norm(`${b.model} ${b.variant}`);
      if (na === nb) continue; // exact dupes handled above
      if (Math.abs(a.w - b.w) / Math.max(a.w, b.w) > 0.05) continue;
      const ta = (na.match(DISTINCT) ?? []).sort().join(' '),
        tb = (nb.match(DISTINCT) ?? []).sort().join(' ');
      if (ta !== tb) continue; // differ by size/gender/version number: different products
      const wa = new Set(na.split(' ')),
        wb = new Set(nb.split(' '));
      const diff = [...wa].filter((t) => !wb.has(t)).concat([...wb].filter((t) => !wa.has(t)));
      if (diff.some((t) => /\d/.test(t))) continue; // model numbers like 66i/67i, TL120/FL120
      const sim = 1 - lev(na, nb) / Math.max(na.length, nb.length);
      const sa = na.replace(/ /g, ''),
        sb = nb.replace(/ /g, '');
      if (sim >= 0.85 || sa === sb) {
        add(
          'near-duplicate',
          b,
          a.file !== b.file ? 55 : 40,
          `looks like ${a.file}[${a.index}] "${a.brand} ${a.model}${a.variant ? ' ' + a.variant : ''}" (${a.w} g vs ${b.w} g, name similarity ${sim.toFixed(2)})`,
          { other: `${a.file}[${a.index}]`, other_id: a.id },
        );
      }
    }
  }
}

// ---------- output ----------
issues.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || String(a.id).localeCompare(String(b.id)));
const counts = {};
for (const i of issues) counts[i.type] = (counts[i.type] ?? 0) + 1;
const flagged = new Set(issues.map((i) => `${i.file}[${i.index}]`)).size;
const out = {
  generated_at: new Date().toISOString(),
  records: records.length,
  records_flagged: flagged,
  counts,
  thresholds: {
    weight_outlier: '>4x or <0.25x subcategory median (n>=5)',
    price_per_gram: '>8x or <0.125x subcategory median $/g (n>=6 priced)',
  },
  issues,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nUL Gear DB data check: ${records.length} records, ${issues.length} issues on ${flagged} records\n`);
for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(t, 18)} ${n}`);
console.log('\n  Worst issues:');
for (const i of issues.slice(0, 15))
  console.log(`  [${String(i.score).padStart(3)}] ${pad(i.type, 16)} ${i.file}[${i.index}] ${i.name}: ${i.message}`);
const perType = SHOW_ALL ? Infinity : 6;
for (const t of Object.keys(counts)) {
  const list = issues.filter((i) => i.type === t);
  console.log(`\n  ${t} (${list.length})`);
  for (const i of list.slice(0, perType)) console.log(`    [${String(i.score).padStart(3)}] ${i.file}[${i.index}] ${i.name}: ${i.message}`);
  if (list.length > perType) console.log(`    ... ${list.length - perType} more`);
}
console.log(`\n  Wrote ${path.relative(ROOT, OUT)}${SHOW_ALL ? '' : '  (run with -- --all to print everything)'}\n`);
