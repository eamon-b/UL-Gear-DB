import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReview, exportLighterPackCSV, LP_COLUMNS, matchItem, MATCH_THRESHOLD, parseLighterPackCSV, reviewToItems } from '../src/lib/csv';
import { resolve, totals } from '../src/lib/lists';
import type { ListItem, PackList } from '../src/lib/types';
import { loadTestDB, ROOT } from './helpers';

const HEADER = LP_COLUMNS.join(',');
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');
const parse1 = (row: string) => {
  const { rows, errors } = parseLighterPackCSV(csv(row));
  expect(errors).toEqual([]);
  expect(rows).toHaveLength(1);
  return rows[0];
};
const asList = (items: ListItem[]): PackList => ({ id: 't', name: 't', items, created: 0, updated: 0 });

describe('parseLighterPackCSV', () => {
  it('converts every LighterPack unit to grams', () => {
    expect(parse1('a,c,,1,100,gram,,,,').weight_g).toBe(100);
    expect(parse1('a,c,,1,1.5,kilogram,,,,').weight_g).toBe(1500);
    expect(parse1('a,c,,1,1,ounce,,,,').weight_g).toBe(28.3);
    expect(parse1('a,c,,1,1,oz,,,,').weight_g).toBe(28.3);
    expect(parse1('a,c,,1,2,pound,,,,').weight_g).toBe(907.2);
    expect(parse1('a,c,,1,2,lb,,,,').weight_g).toBe(907.2);
    expect(parse1('a,c,,1,10,G,,,,').weight_g).toBe(10);
  });

  it('defaults a missing or unknown unit to ounces', () => {
    expect(parse1('a,c,,1,1,,,,,').weight_g).toBe(28.3);
    expect(parse1('a,c,,1,1,stone,,,,').weight_g).toBe(28.3);
  });

  it('treats a missing or bad weight as 0', () => {
    expect(parse1('a,c,,1,,oz,,,,').weight_g).toBe(0);
    expect(parse1('a,c,,1,heavy,oz,,,,').weight_g).toBe(0);
  });

  it('parses qty: empty is 1, 0 stays 0, negatives clamp to 0', () => {
    expect(parse1('a,c,,,1,oz,,,,').qty).toBe(1);
    expect(parse1('a,c,,0,1,oz,,,,').qty).toBe(0);
    expect(parse1('a,c,,-2,1,oz,,,,').qty).toBe(0);
    expect(parse1('a,c,,3,1,oz,,,,').qty).toBe(3);
  });

  it('parses prices with currency symbols and separators, empty as null', () => {
    expect(parse1('a,c,,1,1,oz,,"$1,299.00",,').price).toBe(1299);
    expect(parse1('a,c,,1,1,oz,,0,,').price).toBe(0);
    expect(parse1('a,c,,1,1,oz,,,,').price).toBeNull();
  });

  it('reads worn and consumable flags the way LighterPack writes them', () => {
    const r = parse1('a,c,,1,1,oz,,,Worn,Consumable');
    expect([r.worn, r.consumable]).toEqual([true, true]);
    expect(parse1('a,c,,1,1,oz,,,1,').worn).toBe(true);
    for (const off of ['', '0', 'false', 'No', 'n', 'off']) expect(parse1(`a,c,,1,1,oz,,,${off},${off}`).worn).toBe(false);
  });

  it('handles quoted commas, quotes, newlines, and unicode', () => {
    const r = parse1('"Tent, solo","Shelter","Says ""hi""\nline 2",1,1,oz,https://x.test/?a=1&b=2,,,');
    expect(r.name).toBe('Tent, solo');
    expect(r.desc).toBe('Says "hi"\nline 2');
    expect(r.url).toBe('https://x.test/?a=1&b=2');
    expect(parse1('Doudoune légère 20°F ✓,Vêtements,,1,1,oz,,,,').category).toBe('Vêtements');
  });

  it('strips a BOM, tolerates header case/spacing, CRLF, and blank lines', () => {
    const text = '﻿ Item Name , CATEGORY ,Desc,Qty,Weight,Unit,URL,Price,Worn,Consumable\r\nPack,Packs,,1,20,oz,,,,\r\n\r\n,,,,,,,,,\r\nQuilt,Sleep,,1,1,lb,,,,\r\n';
    const { rows, errors } = parseLighterPackCSV(text);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.name, r.category, r.weight_g])).toEqual([['Pack', 'Packs', 567], ['Quilt', 'Sleep', 453.6]]);
  });

  it('fills an empty category and skips nameless rows', () => {
    const { rows } = parseLighterPackCSV(csv('a,,,1,1,oz,,,,', ',c,,1,1,oz,,,,'));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('Uncategorized');
  });

  it('flags a file that is not a LighterPack CSV', () => {
    const { rows, errors } = parseLighterPackCSV('foo,bar\n1,2\n');
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Item Name/);
  });

  it('parses the bundled fixture', () => {
    const { rows, errors } = parseLighterPackCSV(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/lighterpack-sample.csv'), 'utf8'));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(17);
    expect(rows.filter((r) => r.worn).map((r) => r.name)).toEqual(['Gossamer Gear LT5 poles', 'Altra Lone Peak', 'Darn Tough socks']);
    expect(rows.filter((r) => r.consumable)).toHaveLength(2);
  });
});

describe('review and import', () => {
  const db = loadTestDB();
  const { rows } = parseLighterPackCSV(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/lighterpack-sample.csv'), 'utf8'));

  it('auto-selects only matches at or above the threshold, and every pick is a real DB id', () => {
    const rev = buildReview(rows, db);
    expect(rev).toHaveLength(rows.length);
    for (const r of rev) {
      if (r.choice) {
        expect(db.byId.has(r.choice)).toBe(true);
        expect(r.matches[0].item.id).toBe(r.choice);
        expect(r.matches[0].score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      } else {
        expect(!r.matches[0] || r.matches[0].score < MATCH_THRESHOLD).toBe(true);
      }
      for (const m of r.matches) expect(m.score).toBeGreaterThanOrEqual(0), expect(m.score).toBeLessThanOrEqual(1);
    }
    expect(rev.filter((r) => r.choice).length).toBeGreaterThan(0);
  });

  it('matches well-known products to the right DB item', () => {
    const top = (name: string, desc = '') => matchItem(name, desc, null, db)[0]?.item;
    expect(top('Zpacks Duplex')?.model).toMatch(/Duplex/);
    expect(top('Sawyer Squeeze')?.model).toMatch(/Squeeze/);
    expect(top('Thermarest NeoAir XLite NXT')?.model).toMatch(/XLite/i);
    expect(matchItem('', '', null, db)).toEqual([]);
  });

  it('keeps qty, worn, consumable and the original category on every imported row', () => {
    const items = reviewToItems(buildReview(rows, db));
    expect(items).toHaveLength(rows.length);
    items.forEach((li, i) => {
      expect([li.qty, li.worn, li.consumable, li.cat]).toEqual([rows[i].qty, rows[i].worn, rows[i].consumable, rows[i].category]);
      expect(!!li.dbId !== !!li.custom).toBe(true);
    });
    expect(new Set(items.map((i) => i.uid)).size).toBe(items.length);
  });

  it('custom rows keep the CSV name, weight, price, url and desc', () => {
    const rev = buildReview(rows, db).map((r) => ({ ...r, choice: '' }));
    const items = reviewToItems(rev);
    expect(items[0].custom).toEqual({ name: 'Zpacks Duplex', category: 'Big Three', weight_g: 539, price_usd: 699, url: 'https://zpacks.com', desc: 'DCF tent' });
    expect(items.find((i) => i.custom?.name === 'Sawyer Squeeze')!.custom).toEqual({ name: 'Sawyer Squeeze', category: 'Water', weight_g: 85, price_usd: 40 });
  });

  it('matched rows use the DB weight unless "keep my weight" is set', () => {
    const rev = buildReview(rows, db).filter((r) => r.choice);
    const dbW = reviewToItems(rev);
    expect(dbW.every((li) => li.weight_g === undefined && !li.custom)).toBe(true);
    const kept = reviewToItems(rev.map((r) => ({ ...r, keepWeight: true })));
    kept.forEach((li, i) => expect(li.weight_g).toBe(Math.round(rev[i].row.weight_g)));
  });

  it('totals of an all-custom import equal the CSV totals (LighterPack worn semantics)', () => {
    const items = reviewToItems(buildReview(rows, db).map((r) => ({ ...r, choice: '' })));
    const t = totals(items.map((li) => resolve(li, db)));
    // Socks: qty 2 worn -> one worn, one packed.
    expect(t.worn).toBe(284 + 595 + 62);
    expect(t.consumable).toBe(3 * 680 + 198);
    expect(t.base).toBe(t.total - t.worn - t.consumable);
    expect(t.count).toBe(rows.reduce((s, r) => s + r.qty, 0));
  });

  it('export -> re-import round-trips an all-custom list in grams', () => {
    const items = reviewToItems(buildReview(rows, db).map((r) => ({ ...r, choice: '' })));
    const out = exportLighterPackCSV(asList(items), db, 'g');
    expect(out.split(/\r?\n/)[0]).toBe(HEADER);
    const back = reviewToItems(parseLighterPackCSV(out).rows.map((row) => ({ row, matches: [], choice: '', keepWeight: false })));
    expect(back.map(({ uid: _, ...li }) => li)).toEqual(items.map(({ uid: _, ...li }) => li));
  });

  it('export -> re-import in oz and lb stays within rounding', () => {
    const items = reviewToItems(buildReview(rows, db));
    const before = totals(items.map((li) => resolve(li, db)));
    for (const unit of ['oz', 'lb'] as const) {
      const back = parseLighterPackCSV(exportLighterPackCSV(asList(items), db, unit)).rows;
      expect(back).toHaveLength(items.length);
      const total = back.reduce((s, r) => s + r.weight_g * r.qty, 0);
      // export rounds to 0.01 unit per row
      const tol = back.reduce((s, r) => s + r.qty, 0) * (unit === 'oz' ? 0.15 : 2.3);
      expect(Math.abs(total - before.total)).toBeLessThanOrEqual(tol);
    }
  });
});
