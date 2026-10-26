import { describe, expect, it } from 'vitest';
import { metricsFor, paretoFrontier3, type Metric } from '../src/lib/metric';
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

  it('keeps exact duplicates and skips items without price or metric', () => {
    const a = item('a', 500, 100, { volume_l: 40 });
    const b = item('b', 500, 100, { volume_l: 40 });
    const noPrice = item('np', 100, null, { volume_l: 90 });
    const noVol = item('nv', 100, 10);
    expect(paretoFrontier3([a, b, noPrice, noVol], vol)).toEqual(new Set(['a', 'b']));
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
