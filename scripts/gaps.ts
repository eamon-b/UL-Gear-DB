/**
 * gaps.ts: what real pack lists carry that the database does not have.
 *
 * Every row of every example list (data/examples/csv) goes through the same matcher the CSV import
 * uses. Rows it cannot match are grouped and ranked by how many different lists carry them, so the
 * gear to add next is whatever hikers actually use, not whatever a brand's catalogue happens to list.
 *
 *   npm run gaps                 top gaps: products of brands we know, then everything else
 *   npm run gaps -- --all        every group, not just the top of each list
 *   npm run gaps -- --json       machine-readable, for scripting a research pass
 *   npm run gaps -- more/*.csv   also read your own LighterPack exports
 *
 * It never edits data. Run `npm run data` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLighterPackCSV } from '../src/lib/csv';
import { hydrate } from '../src/lib/data';
import { brandsIn, gearIndex } from '../src/lib/gearIndex';
import { matchItem, MATCH_THRESHOLD } from '../src/lib/match';
import { COMMON_WORDS, FILLER_WORDS, isNumeric, tokenize, TYPE_WORDS } from '../src/lib/text';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'public/data/gear.json');
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const JSON_OUT = args.includes('--json');
const extra = args.filter((a) => !a.startsWith('--'));

if (!fs.existsSync(BUNDLE)) {
  console.error('public/data/gear.json is missing: run `npm run data` first.');
  process.exit(1);
}
const db = hydrate(JSON.parse(fs.readFileSync(BUNDLE, 'utf8')));
const ix = gearIndex(db.items);
const brandName = new Map(ix.entries.map((e) => [e.brandKey, e.it.brand]));

const dir = path.join(ROOT, 'data/examples/csv');
const files = [
  ...fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => path.join(dir, f)),
  ...extra,
];

interface Group {
  label: string;
  lists: Set<string>;
  rows: number;
  weights: number[];
  examples: Set<string>;
  /** the closest thing we do have, when there is one */
  nearest: Map<string, number>;
}
const known = new Map<string, Group>();
const other = new Map<string, Group>();
let total = 0,
  matched = 0;

/** The words that name a product: not its kind or size, and not a number or a unit. */
const UNITS = new Set(['mah', 'oz', 'lb', 'cm', 'mm', 'in', 'inch', 'fp', 'gm', 'gram', 'deg', 'degree']);
const productWords = (toks: string[]) =>
  toks.filter((t) => t.length > 1 && !isNumeric(t) && !TYPE_WORDS.has(t) && !FILLER_WORDS.has(t) && !UNITS.has(t));
const cut = (raw: string) => raw.split(/\s[+/-]\s|[(,;]|\sw\/|\swith\s|\sincl/i)[0];

for (const file of files) {
  const { rows } = parseLighterPackCSV(fs.readFileSync(file, 'utf8'));
  for (const r of rows) {
    total++;
    const ms = matchItem(r.name, r.desc, r.weight_g || null, db, 1);
    if (ms[0] && ms[0].score >= MATCH_THRESHOLD) {
      matched++;
      continue;
    }
    // the field that names the product is the one with a brand in it, else the name
    const fields = [cut(r.name), cut(r.desc)].map((f) => tokenize(f));
    const withBrand = fields.find((f) => brandsIn(f, ix).size);
    const add = (m: Map<string, Group>, key: string, label: string) => {
      let g = m.get(key);
      if (!g) m.set(key, (g = { label, lists: new Set(), rows: 0, weights: [], examples: new Set(), nearest: new Map() }));
      g.lists.add(file);
      g.rows++;
      if (r.weight_g > 0) g.weights.push(r.weight_g);
      if (g.examples.size < 3) g.examples.add(r.desc ? `${r.name} | ${r.desc}`.slice(0, 90) : r.name);
      if (ms[0] && ms[0].score >= 0.45) g.nearest.set(ms[0].item.name, (g.nearest.get(ms[0].item.name) ?? 0) + 1);
    };
    if (withBrand) {
      const [bk] = brandsIn(withBrand, ix);
      const bt = new Set(bk.split(' '));
      const words = productWords(withBrand.filter((t) => !bt.has(t))).slice(0, 3);
      if (!words.length) continue; // "Zpacks" alone: nothing to look up
      add(known, `${bk}|${words.join(' ')}`, `${brandName.get(bk)} · ${words.join(' ')}`);
    } else {
      // with no brand to anchor on, everyday words alone ("extra", "spare") are not a product
      const words = productWords(fields[0])
        .filter((t) => !COMMON_WORDS.has(t))
        .slice(0, 2);
      if (words.length) add(other, words.join(' '), words.join(' '));
    }
  }
}

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const rank = (m: Map<string, Group>) =>
  [...m.values()]
    .sort((a, b) => b.lists.size - a.lists.size || b.rows - a.rows || a.label.localeCompare(b.label))
    .map((g) => ({
      product: g.label,
      lists: g.lists.size,
      rows: g.rows,
      median_g: median(g.weights) == null ? null : Math.round(median(g.weights)!),
      nearest: [...g.nearest].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      examples: [...g.examples],
    }));

const out = { lists: files.length, rows: total, matched, known_brand: rank(known), other: rank(other).filter((g) => g.lists > 1) };
if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const pct = ((matched / total) * 100).toFixed(0);
  console.log(`${files.length} lists, ${total} rows: ${matched} (${pct}%) match a database item, ${total - matched} do not.\n`);
  const show = (title: string, groups: ReturnType<typeof rank>, n: number) => {
    console.log(title);
    for (const g of groups.slice(0, ALL ? Infinity : n)) {
      const w = g.median_g == null ? '' : `  ~${g.median_g} g`;
      console.log(`  ${String(g.lists).padStart(2)} lists  ${g.product}${w}${g.nearest ? `   (closest: ${g.nearest})` : ''}`);
      console.log(`            e.g. ${g.examples[0]}`);
    }
    if (!ALL && groups.length > n) console.log(`  ... and ${groups.length - n} more (--all)`);
    console.log('');
  };
  show('Products of brands the database has, but not these (best candidates to add):', out.known_brand, 40);
  show('Rows with no brand we know, in two or more lists (mostly generic or home-made):', out.other, 25);
}
