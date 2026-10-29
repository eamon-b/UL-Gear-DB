import { describe, expect, it } from 'vitest';
import { activeMetric, defaultMetric, metricsFor, paretoFrontier3, type Metric } from '../src/lib/metric';
import { paretoFrontier } from '../src/lib/filters';
import type { Item } from '../src/lib/types';
import { loadTestDB } from './helpers';

const item = (id: string, weight_g: number, price_usd: number | null, specs: Item['specs'] = {}, category = 'backpack'): Item => ({
  id, category, subcategory: 'x', brand: 'B', model: id, variant: null, weight_g, weight_basis: 'manufacturer',
  weight_note: null, price_usd, specs, url: null, discontinued: false, confidence: 'high', notes: null, name: id, search: id,
});

const vol: Metric = { key: 'volume_l', label: 'Volume', unit: 'L', dir: 1, ratio: true, get: (it) => (typeof it.specs.volume_l === 'number' ? it.specs.volume_l : null) };
const temp: Metric = { ...vol, key: 't', dir: -1, get: (it) => (typeof it.specs.t === 'number' ? it.specs.t : null) };

describe('paretoFrontier3', () => {
  it('keeps a heavier, pricier item when it is better on the metric', () => {
    const a = item('a', 500, 100, { volume_l: 30 });
    const b = item('b', 800, 200, { volume_l: 60 });
    expect(paretoFrontier([a, b])).toEqual(new Set(['a']));
    expect(paretoFrontier3([a, b], vol)).toEqual(new Set(['a', 'b']));
  });

  it('drops an item beaten on all three', () => {
    const a = item('a', 500, 100, { volume_l: 40 });
    const b = item('b', 600, 150, { volume_l: 30 });
    expect(paretoFrontier3([a, b], vol)).toEqual(new Set(['a']));
  });

  it('respects lower-is-better metrics', () => {
    const warm = item('warm', 700, 300, { t: 10 });
    const cold = item('cold', 500, 200, { t: 40 });
    const worse = item('worse', 700, 300, { t: 20 });
    expect(paretoFrontier3([warm, cold, worse], temp)).toEqual(new Set(['warm', 'cold']));
  });

  it('keeps exact duplicates and skips items without price', () => {
    const a = item('a', 500, 100, { volume_l: 40 });
    const b = item('b', 500, 100, { volume_l: 40 });
    const noPrice = item('np', 100, null, { volume_l: 90 });
    expect(paretoFrontier3([a, b, noPrice], vol)).toEqual(new Set(['a', 'b']));
  });

  it('keeps 2D frontier items that have no metric value, and only those', () => {
    const a = item('a', 500, 100, { volume_l: 40 });
    const light = item('light', 100, 10); // lightest and cheapest, volume unknown
    const meh = item('meh', 600, 120); // beaten on weight and price, volume unknown
    expect(paretoFrontier3([a, light, meh], vol)).toEqual(new Set(['a', 'light']));
  });

  it('on the real data, drops a 2D frontier item only for a same weight and price item better on the metric', () => {
    const db = loadTestDB();
    for (const [cat, pool] of db.byCategory) {
      const f2 = paretoFrontier(pool);
      for (const m of metricsFor(cat, pool)) {
        const f3 = paretoFrontier3(pool, m);
        for (const id of f2) {
          if (f3.has(id)) continue;
          const a = db.byId.get(id)!, v = m.get(a);
          const tie = v != null && pool.some((b) => b.price_usd === a.price_usd && b.weight_g === a.weight_g && m.get(b) != null && m.get(b)! * m.dir > v * m.dir);
          expect(tie, `${cat} ${m.key} ${id}`).toBe(true);
        }
      }
    }
  });
});

describe('metricsFor', () => {
  it('derives power bank Wh from mAh when no Wh is listed', () => {
    const pool = [item('pb', 200, 50, { capacity_mah: 10000 }, 'power'), item('pb2', 300, 80, { capacity_mah: 20000, capacity_wh: 72 }, 'power')];
    const [m] = metricsFor('power', pool);
    expect(m.key).toBe('energy_wh');
    expect(m.get(pool[0])).toBe(37);
    expect(m.get(pool[1])).toBe(72);
  });

  it('does not offer the specs a derived metric is built from', () => {
    const pool = [item('pb', 200, 50, { capacity_mah: 10000, capacity_wh: 37, output_w: 18 }, 'power'), item('pb2', 300, 80, { capacity_mah: 20000, capacity_wh: 74, output_w: 20 }, 'power')];
    expect(metricsFor('power', pool).map((m) => m.key)).toEqual(['energy_wh', 'output_w']);
  });

  it('converts cubic inches to liters for food storage', () => {
    const pool = [item('can', 1000, 90, { cubic_in: 700 }, 'food-storage')];
    expect(metricsFor('food-storage', pool)[0].get(pool[0])).toBeCloseTo(11.5, 1);
  });

  it('has a default metric for the main categories in the real data', () => {
    const db = loadTestDB();
    const want: Record<string, string> = {
      backpack: 'volume_l', 'sleep-insulation': 'temp_rating_f', 'sleeping-pad': 'r_value', shelter: 'capacity',
      lighting: 'lumens', power: 'energy_wh', insulation: 'fill_weight_g', cookware: 'capacity_ml',
    };
    for (const [cat, key] of Object.entries(want)) expect(metricsFor(cat, db.byCategory.get(cat) ?? [])[0]?.key, cat).toBe(key);
  });
});

describe('defaultMetric', () => {
  const vols = (n: number, withVol: number) => Array.from({ length: n }, (_, i) => item('p' + i, 500 + i, 100, i < withVol ? { volume_l: 30 + i } : {}));

  it('is the first curated metric when most items have it', () => {
    expect(defaultMetric('backpack', vols(10, 7))?.key).toBe('volume_l');
    expect(activeMetric('backpack', vols(10, 7))?.key).toBe('volume_l');
  });

  it('is off when too few items have the metric, though it is still offered', () => {
    const pool = vols(10, 6);
    expect(defaultMetric('backpack', pool)).toBeNull();
    expect(activeMetric('backpack', pool)).toBeNull();
    expect(metricsFor('backpack', pool)[0].key).toBe('volume_l');
  });

  it('is never a metric picked up from the data in an uncurated category', () => {
    const pool = [item('a', 100, 10, { capacity_ml: 500 }, 'cook-accessory'), item('b', 200, 20, { capacity_ml: 700 }, 'cook-accessory')];
    expect(metricsFor('cook-accessory', pool).map((m) => m.key)).toEqual(['capacity_ml']);
    expect(defaultMetric('cook-accessory', pool)).toBeNull();
  });
});

describe('stove boil time', () => {
  it('scales boil times quoted for other volumes to 1 L', () => {
    const [m] = metricsFor('stove', [item('half', 80, 50, { boil_time_min: 1.75, boil_volume_l: 0.5 }, 'stove'), item('litre', 80, 50, { boil_time_min: 3.5 }, 'stove')]);
    expect(m.key).toBe('boil_time_min');
    expect(m.get(item('half', 80, 50, { boil_time_min: 1.75, boil_volume_l: 0.5 }, 'stove'))).toBe(3.5);
    expect(m.get(item('litre', 80, 50, { boil_time_min: 3.5 }, 'stove'))).toBe(3.5);
  });
});
