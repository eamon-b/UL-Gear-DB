import { describe, expect, it } from 'vitest';
import { lightenPlan, resolve, swapCandidates, totals } from '../src/lib/lists';
import { newListItem } from '../src/lib/store';
import { loadTestDB } from './helpers';

const opts = { sameSub: false, fullPrice: true, hideDisc: false };

describe('qty 0 lines', () => {
  const db = loadTestDB();
  // heaviest priced item in a category that has lighter alternatives
  const heavy = [...db.items].filter((i) => i.price_usd != null).sort((a, b) => b.weight_g - a.weight_g)
    .find((i) => swapCandidates(resolve(newListItem(i.id), db), db, opts).length > 0)!;

  it('count nothing in totals', () => {
    const t = totals([resolve(newListItem(heavy.id, { qty: 0 }), db)]);
    expect([t.base, t.total, t.cost, t.count]).toEqual([0, 0, 0, 0]);
  });

  it('get no lighten suggestions (no phantom savings)', () => {
    const r = resolve(newListItem(heavy.id, { qty: 0 }), db);
    expect(swapCandidates(r, db, opts)).toEqual([]);
    expect(lightenPlan([r], db, Infinity, opts).picked).toEqual([]);
  });

  it('savings and cost scale with qty', () => {
    const one = swapCandidates(resolve(newListItem(heavy.id), db), db, opts)[0];
    const two = swapCandidates(resolve(newListItem(heavy.id, { qty: 2 }), db), db, opts)[0];
    expect(two.saved).toBeCloseTo(one.saved * 2);
    expect(two.cost).toBeCloseTo(one.cost * 2);
  });
});
