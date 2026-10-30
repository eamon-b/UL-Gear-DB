/**
 * coverage.ts: how complete the data is per category. It counts the items in each category
 * and how many have a price, a weight and a value for the category's third-dimension metric
 * (the first curated one in src/lib/metric.ts). It never edits data.
 *
 *   npm run coverage              print the table and rewrite the section in README.md
 *   npm run coverage -- --check   exit 1 if README.md is out of date (CI)
 *
 * Under GitHub Actions the table also goes to the job summary. Run `npm run data` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrate } from '../src/lib/data';
import { DEFAULT_MIN_COVERAGE, defaultMetric, metricsFor, metricTitle } from '../src/lib/metric';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'public/data/gear.json');
const README = path.join(ROOT, 'README.md');
const START = '<!-- coverage:start -->';
const END = '<!-- coverage:end -->';
const CHECK = process.argv.includes('--check');

if (!fs.existsSync(BUNDLE)) {
  console.error('public/data/gear.json is missing: run `npm run data` first.');
  process.exit(1);
}
const db = hydrate(JSON.parse(fs.readFileSync(BUNDLE, 'utf8')));

const pct = (n: number, d: number) => (d ? `${n} (${Math.floor((n / d) * 100)}%)` : '–');
// flag anything below the bar a default metric has to clear
const cell = (n: number, d: number) => (d && n / d < DEFAULT_MIN_COVERAGE ? `**${pct(n, d)}**` : pct(n, d));

const rows: string[] = [];
const tot = { items: 0, price: 0, weight: 0, mItems: 0, metric: 0 };
for (const cat of db.categories) {
  const pool = db.byCategory.get(cat.id) ?? [];
  if (!pool.length) continue;
  const price = pool.filter((it) => it.price_usd != null).length;
  const weight = pool.filter((it) => it.weight_g > 0).length;
  const m = metricsFor(cat.id, pool).find((x) => !x.auto) ?? null;
  const metric = m ? pool.filter((it) => m.get(it) != null).length : 0;
  tot.items += pool.length;
  tot.price += price;
  tot.weight += weight;
  if (m) {
    tot.mItems += pool.length;
    tot.metric += metric;
  }
  rows.push(
    `| ${cat.name} | ${pool.length} | ${cell(price, pool.length)} | ${cell(weight, pool.length)} | ${m ? metricTitle(m) : '–'} | ${m ? cell(metric, pool.length) : '–'} | ${m ? (defaultMetric(cat.id, pool) ? 'on' : 'off') : '–'} |`,
  );
}

const table = [
  '| Category | Items | Price | Weight | 3rd metric | With metric | Default |',
  '|---|--:|--:|--:|---|--:|---|',
  ...rows,
  `| **All** | **${tot.items}** | **${pct(tot.price, tot.items)}** | **${pct(tot.weight, tot.items)}** | | **${pct(tot.metric, tot.mItems)}** | |`,
].join('\n');

const section = `${START}\n${table}\n${END}`;
const readme = fs.readFileSync(README, 'utf8');
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(readme)) {
  console.error(`README.md has no ${START} … ${END} section.`);
  process.exit(1);
}
const next = readme.replace(re, section);

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Data coverage\n\n${table}\n`);

if (CHECK) {
  if (next !== readme) {
    console.error('\nREADME.md coverage table is out of date: run `npm run coverage` and commit README.md.');
    process.exit(1);
  }
} else if (next !== readme) {
  fs.writeFileSync(README, next);
  console.log('\nUpdated README.md');
}
