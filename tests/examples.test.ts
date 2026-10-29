import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReview, exportLighterPackCSV, MATCH_THRESHOLD, parseLighterPackCSV, reviewToItems } from '../src/lib/csv';
import { resolve, totals } from '../src/lib/lists';
import type { PackList } from '../src/lib/types';
import { loadTestDB, ROOT } from './helpers';

/**
 * Every example list goes through the same import path the Examples page uses
 * (parse -> fuzzy review -> list items), checked against the weights that
 * scripts/fetch-examples.mjs recorded in the registry.
 */
const DIR = path.join(ROOT, 'data/examples');
const sources: { id: string; source_url: string | null }[] = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const registry: { lists: Record<string, any>[] } = JSON.parse(fs.readFileSync(path.join(DIR, 'registry.json'), 'utf8'));
const db = loadTestDB();

describe('example list registry', () => {
  it('has unique, well-formed ids with a source page', () => {
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of sources) {
      expect(s.id).toMatch(/^[a-z0-9]+$/);
      expect(s.source_url).toMatch(/^https?:\/\//);
    }
  });

  it('has a snapshot and a registry entry for every source, and nothing else', () => {
    const csvs = fs
      .readdirSync(path.join(DIR, 'csv'))
      .filter((f) => f.endsWith('.csv'))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(csvs).toEqual(sources.map((s) => s.id).sort());
    expect(registry.lists.map((l) => l.id).sort()).toEqual(csvs);
  });

  it('is sorted by base weight', () => {
    const b = registry.lists.map((l) => l.base_g);
    expect(b).toEqual([...b].sort((x, y) => x - y));
  });
});

describe.each(registry.lists.map((l) => [l.id, l] as const))('example %s', (id, entry) => {
  const text = fs.readFileSync(path.join(DIR, 'csv', `${id}.csv`), 'utf8');
  const parsed = parseLighterPackCSV(text);
  const qtyTotal = parsed.rows.reduce((s, r) => s + r.qty, 0);

  it('parses cleanly with the expected item count', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(entry.items);
    expect(entry.lighterpack_url).toBe(`https://lighterpack.com/r/${id}`);
  });

  it('every row has a name, a finite non-negative weight and qty', () => {
    for (const r of parsed.rows) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.weight_g) && r.weight_g >= 0).toBe(true);
      expect(Number.isFinite(r.qty) && r.qty >= 0).toBe(true);
    }
  });

  it('imported as custom items, list totals match the registry', () => {
    const items = reviewToItems(parsed.rows.map((row) => ({ row, matches: [], choice: '', keepWeight: false })));
    const t = totals(items.map((li) => resolve(li, db)));
    // reviewToItems rounds each custom weight to whole grams
    const tol = 0.55 * qtyTotal + 1;
    expect(Math.abs(t.base - entry.base_g)).toBeLessThanOrEqual(tol);
    expect(Math.abs(t.worn - entry.worn_g)).toBeLessThanOrEqual(tol);
    expect(Math.abs(t.consumable - entry.consumable_g)).toBeLessThanOrEqual(tol);
    expect(Math.abs(t.total - entry.total_g)).toBeLessThanOrEqual(tol);
  });

  it('auto-match review keeps every row and its flags, and only picks real DB items', () => {
    const rev = buildReview(parsed.rows, db);
    const items = reviewToItems(rev);
    expect(items).toHaveLength(parsed.rows.length);
    items.forEach((li, i) => {
      const row = parsed.rows[i];
      expect([li.qty, li.worn, li.consumable, li.cat]).toEqual([row.qty, row.worn, row.consumable, row.category]);
      if (li.dbId) {
        expect(db.byId.has(li.dbId)).toBe(true);
        expect(rev[i].matches[0].score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      } else {
        expect(li.custom?.name).toBe(row.name);
      }
    });
  });

  it('with "keep my weights" on, the imported list weighs the same as the original', () => {
    const rev = buildReview(parsed.rows, db).map((r) => ({ ...r, keepWeight: true }));
    const t = totals(reviewToItems(rev).map((li) => resolve(li, db)));
    // rows the list records as 0 g fall back to the DB weight when matched
    const zeroMatched = rev
      .filter((r) => r.choice && !(r.row.weight_g > 0))
      .reduce((s, r) => s + db.byId.get(r.choice)!.weight_g * r.row.qty, 0);
    expect(Math.abs(t.total - zeroMatched - entry.total_g)).toBeLessThanOrEqual(0.55 * qtyTotal + 1);
  });

  it('survives export -> re-import', () => {
    const items = reviewToItems(buildReview(parsed.rows, db));
    const list: PackList = { id: id, name: entry.title ?? id, items, created: 0, updated: 0 };
    const back = parseLighterPackCSV(exportLighterPackCSV(list, db, 'g'));
    expect(back.errors).toEqual([]);
    expect(back.rows.map((r) => [r.qty, r.worn, r.consumable, r.category])).toEqual(
      items.map((li) => [li.qty, li.worn, li.consumable, li.cat]),
    );
  });
});
