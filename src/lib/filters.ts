import type { Item, SpecValue } from './types';

export type SpecMeta =
  | { key: string; type: 'number'; min: number; max: number; count: number }
  | { key: string; type: 'boolean'; count: number }
  | { key: string; type: 'string'; values: { v: string; n: number }[]; count: number };

/** Derive filterable spec keys from the items present. */
export function specMeta(items: Item[]): SpecMeta[] {
  const acc = new Map<string, { nums: number[]; bools: number; strs: Map<string, number>; count: number }>();
  for (const it of items) {
    for (const [k, v] of Object.entries(it.specs)) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { nums: [], bools: 0, strs: new Map(), count: 0 }));
      a.count++;
      if (typeof v === 'number') a.nums.push(v);
      else if (typeof v === 'boolean') a.bools++;
      else a.strs.set(String(v), (a.strs.get(String(v)) ?? 0) + 1);
    }
  }
  const minCount = Math.max(2, Math.ceil(items.length * 0.05));
  const out: SpecMeta[] = [];
  for (const [key, a] of acc) {
    if (a.count < Math.min(minCount, items.length)) continue;
    if (a.nums.length >= a.count * 0.8 && a.nums.length) {
      const min = Math.min(...a.nums), max = Math.max(...a.nums);
      if (min !== max) out.push({ key, type: 'number', min, max, count: a.count });
    } else if (a.bools >= a.count * 0.8) {
      out.push({ key, type: 'boolean', count: a.count });
    } else {
      const values = [...a.strs].map(([v, n]) => ({ v, n })).sort((x, y) => y.n - x.n || x.v.localeCompare(y.v));
      if (values.length > 1 && values.length <= 60) out.push({ key, type: 'string', values, count: a.count });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Union of all spec keys (for table columns), ordered by frequency. */
export function specKeys(items: Item[]): string[] {
  const m = new Map<string, number>();
  for (const it of items) for (const k of Object.keys(it.specs)) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export type SpecFilter =
  | { type: 'range'; min: number; max: number }
  | { type: 'bool'; value: boolean }
  | { type: 'set'; values: string[] };

export type Chip = 'lighter' | 'cheaper' | 'both' | 'value' | null;

export interface Filters {
  q: string;
  subcats: string[];
  brands: string[];
  wMin: number | null; // grams
  wMax: number | null;
  pMin: number | null;
  pMax: number | null;
  hideDisc: boolean;
  hideNoPrice: boolean;
  confidence: string[];
  specs: Record<string, SpecFilter>;
  frontierOnly: boolean;
  chip: Chip;
}

export const emptyFilters = (): Filters => ({
  q: '', subcats: [], brands: [], wMin: null, wMax: null, pMin: null, pMax: null,
  hideDisc: false, hideNoPrice: false, confidence: [], specs: {}, frontierOnly: false, chip: null,
});

export function activeFilterCount(f: Filters) {
  let n = 0;
  if (f.q) n++;
  if (f.subcats.length) n++;
  if (f.brands.length) n++;
  if (f.wMin != null || f.wMax != null) n++;
  if (f.pMin != null || f.pMax != null) n++;
  if (f.hideDisc) n++;
  if (f.hideNoPrice) n++;
  if (f.confidence.length) n++;
  if (f.frontierOnly) n++;
  if (f.chip) n++;
  n += Object.keys(f.specs).length;
  return n;
}

function specPass(v: SpecValue | undefined, sf: SpecFilter) {
  if (sf.type === 'range') return typeof v === 'number' && v >= sf.min && v <= sf.max;
  if (sf.type === 'bool') return v === sf.value;
  return v != null && sf.values.includes(String(v));
}

export function applyFilters(items: Item[], f: Filters, ref?: Item | null): Item[] {
  const toks = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const specEntries = Object.entries(f.specs);
  const subs = f.subcats.length ? new Set(f.subcats) : null;
  const brands = f.brands.length ? new Set(f.brands) : null;
  const conf = f.confidence.length ? new Set(f.confidence) : null;
  return items.filter((it) => {
    if (ref && it.id === ref.id) return true; // keep reference visible
    if (toks.length) {
      const s = it.name.toLowerCase();
      for (const t of toks) if (!s.includes(t)) return false;
    }
    if (subs && !subs.has(it.subcategory)) return false;
    if (brands && !brands.has(it.brand)) return false;
    if (f.wMin != null && it.weight_g < f.wMin) return false;
    if (f.wMax != null && it.weight_g > f.wMax) return false;
    if (f.pMin != null && (it.price_usd == null || it.price_usd < f.pMin)) return false;
    if (f.pMax != null && (it.price_usd == null || it.price_usd > f.pMax)) return false;
    if (f.hideNoPrice && it.price_usd == null) return false;
    if (f.hideDisc && it.discontinued) return false;
    if (conf && !conf.has(it.confidence)) return false;
    for (const [k, sf] of specEntries) if (!specPass(it.specs[k], sf)) return false;
    if (ref && f.chip) {
      const lighter = it.weight_g < ref.weight_g;
      const cheaper = it.price_usd != null && ref.price_usd != null && it.price_usd < ref.price_usd;
      if (f.chip === 'lighter' && !lighter) return false;
      if (f.chip === 'cheaper' && !cheaper) return false;
      if (f.chip === 'both' && !(lighter && cheaper)) return false;
      if (f.chip === 'value' && !lighter) return false;
    }
    return true;
  });
}

/** Pareto frontier on (price, weight): no other item is both cheaper-or-equal and lighter. */
export function paretoFrontier(items: Item[]): Set<string> {
  const priced = items.filter((i) => i.price_usd != null).sort((a, b) => a.price_usd! - b.price_usd! || a.weight_g - b.weight_g);
  const out = new Set<string>();
  let best = Infinity;
  for (const it of priced) {
    if (it.weight_g < best) {
      out.add(it.id);
      best = it.weight_g;
    }
  }
  return out;
}

/**
 * "Grams saved per extra dollar" relative to a baseline item.
 *   Infinity  = lighter AND not more expensive (free win)
 *   null      = not lighter or price unknown
 */
export function gPerDollar(it: Item, base: Item | null | undefined): number | null {
  if (!base || it.id === base.id || it.price_usd == null || base.price_usd == null) return null;
  const saved = base.weight_g - it.weight_g;
  if (saved <= 0) return null;
  const extra = it.price_usd - base.price_usd;
  if (extra <= 0) return Infinity;
  return saved / extra;
}

/** Baseline for browse value metric: cheapest priced item in the set (ties: heaviest). */
export function cheapestBaseline(items: Item[]): Item | null {
  let b: Item | null = null;
  for (const it of items) {
    if (it.price_usd == null) continue;
    if (!b || it.price_usd < b.price_usd! || (it.price_usd === b.price_usd && it.weight_g > b.weight_g)) b = it;
  }
  return b;
}

export type SortKey = string; // 'name' | 'brand' | 'subcategory' | 'weight' | 'price' | 'value' | 'category' | 'spec:<k>'
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

export function sortItems(items: Item[], sort: Sort, valueOf: (it: Item) => number | null): Item[] {
  const { key, dir } = sort;
  const get = (it: Item): number | string | null => {
    switch (key) {
      case 'name': return it.name.toLowerCase();
      case 'subcategory': return it.subcategory;
      case 'category': return it.category;
      case 'weight': return it.weight_g;
      case 'price': return it.price_usd;
      case 'value': return valueOf(it);
      case 'confidence': return { high: 0, medium: 1, low: 2 }[it.confidence];
      default: {
        if (key.startsWith('spec:')) {
          const v = it.specs[key.slice(5)];
          if (v == null) return null;
          if (typeof v === 'boolean') return v ? 1 : 0;
          return typeof v === 'number' ? v : v.toLowerCase();
        }
        return null;
      }
    }
  };
  const arr = items.map((it) => ({ it, v: get(it) }));
  arr.sort((a, b) => {
    // nulls always last regardless of direction
    if (a.v == null && b.v == null) return a.it.weight_g - b.it.weight_g;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    if (a.v < b.v) return -dir;
    if (a.v > b.v) return dir;
    return a.it.weight_g - b.it.weight_g;
  });
  return arr.map((x) => x.it);
}

/** Which direction is "better" for a spec key (used to highlight bests in compare). */
const HIGHER = /r_value|lumens|capacity|fill_power|output|flow_rate|runtime|max_load|waterproof_rating|lifespan|doors|volume|thickness|battery_life|gsm/;
const LOWER = /temp_rating|boil_time|pore_size|weight|price|packed|collapsed/;
export function specDirection(key: string): 1 | -1 | 0 {
  if (LOWER.test(key)) return -1;
  if (HIGHER.test(key)) return 1;
  return 0;
}
export function boolBetter(key: string): boolean | null {
  if (key === 'subscription') return false;
  if (/freestanding|walls|gender/.test(key)) return null;
  return true;
}
