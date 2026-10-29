import type { Item } from './types';
import { loadLS, saveLS, humanizeKey } from './util';
import { paretoFrontier, specDirection, specMeta } from './filters';

/**
 * A "third dimension" for a category besides weight and price: what you get for the
 * grams and dollars (pack volume, quilt warmth, pad R-value, lumens, Wh, down fill...).
 */
export interface Metric {
  key: string;
  label: string; // short, for column headers and axes
  unit: string; // '' when unitless
  dir: 1 | -1; // 1 = higher is better
  /** "per unit" ratios (g/L, $/lumen) make sense: the quantity scales roughly linearly */
  ratio: boolean;
  get: (it: Item) => number | null;
  /** other spec keys this metric is derived from, so they aren't offered again as separate metrics */
  covers?: string[];
  /** picked up from the data rather than curated: offered, never on by default */
  auto?: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const spec = (key: string, label: string, unit: string, dir: 1 | -1, ratio: boolean): Metric => ({
  key, label, unit, dir, ratio, get: (it) => num(it.specs[key]),
});

const CU_IN_L = 0.0163871;
/** Nominal Li-ion cell voltage, used when a power bank only lists mAh. */
const LI_ION_V = 3.7;

const volumeL = (label = 'Volume'): Metric => ({
  key: 'volume_l', label, unit: 'L', dir: 1, ratio: true, covers: ['cubic_in'],
  get: (it) => num(it.specs.volume_l) ?? (num(it.specs.cubic_in) != null ? +(num(it.specs.cubic_in)! * CU_IN_L).toFixed(1) : null),
});

/** Curated metrics per category; the first is the default. */
const CURATED: Record<string, Metric[]> = {
  backpack: [volumeL(), spec('max_load_lb', 'Max load', 'lb', 1, true)],
  'sleep-insulation': [spec('temp_rating_f', 'Temp rating', '°F', -1, false), spec('fill_weight_g', 'Fill weight', 'g', 1, true)],
  'sleeping-pad': [spec('r_value', 'R-value', '', 1, true), spec('thickness_in', 'Thickness', 'in', 1, false)],
  shelter: [spec('capacity', 'Capacity', 'person', 1, true)],
  lighting: [spec('lumens', 'Brightness', 'lm', 1, true), spec('runtime_hr', 'Runtime', 'h', 1, true)],
  power: [
    {
      key: 'energy_wh', label: 'Energy', unit: 'Wh', dir: 1, ratio: true, covers: ['capacity_wh', 'capacity_mah'],
      get: (it) => num(it.specs.capacity_wh) ?? (num(it.specs.capacity_mah) ? +((num(it.specs.capacity_mah)! * LI_ION_V) / 1000).toFixed(1) : null),
    },
    spec('output_w', 'Output', 'W', 1, false),
  ],
  insulation: [spec('fill_weight_g', 'Down fill', 'g', 1, true), spec('fill_power', 'Fill power', '', 1, false)],
  cookware: [spec('capacity_ml', 'Capacity', 'ml', 1, true)],
  'water-storage': [spec('capacity_l', 'Capacity', 'L', 1, true)],
  'water-treatment': [spec('flow_rate_lpm', 'Flow rate', 'L/min', 1, false), spec('lifespan_l', 'Lifespan', 'L', 1, true)],
  stove: [
    {
      // makers quote boil times for 0.5 L or 1 L; scale to 1 L so they compare (unstated volume = 1 L)
      key: 'boil_time_min', label: 'Boil time', unit: 'min/L', dir: -1, ratio: false, covers: ['boil_volume_l'],
      get: (it) => {
        const t = num(it.specs.boil_time_min);
        return t == null ? null : +(t / (num(it.specs.boil_volume_l) || 1)).toFixed(2);
      },
    },
    spec('output_btu', 'Output', 'BTU', 1, false),
  ],
  'food-storage': [volumeL()],
  'pack-organization': [volumeL()],
  'rain-jacket': [spec('waterproof_rating_mm', 'Waterproofing', 'mm', 1, false)],
  'rain-pants': [spec('waterproof_rating_mm', 'Waterproofing', 'mm', 1, false)],
  'trekking-poles': [spec('collapsed_length_in', 'Collapsed', 'in', -1, false)],
  'base-layer': [spec('gsm', 'Fabric weight', 'gsm', 1, false)],
};

/** Curated metrics first, then any other numeric spec with a known better-direction. */
export function metricsFor(categoryId: string, pool: Item[]): Metric[] {
  const out = [...(CURATED[categoryId] ?? [])];
  const have = new Set(out.flatMap((m) => [m.key, ...(m.covers ?? [])]));
  for (const m of specMeta(pool)) {
    if (m.type !== 'number' || have.has(m.key)) continue;
    const dir = specDirection(m.key);
    if (dir === 0) continue;
    out.push({ ...spec(m.key, humanizeKey(m.key), '', dir, false), auto: true });
  }
  // drop metrics nobody in the pool has
  return out.filter((m) => pool.some((it) => m.get(it) != null));
}

/** Share of items in the category that have a value for the metric. */
export const metricCoverage = (m: Metric, pool: Item[]) => (pool.length ? pool.filter((it) => m.get(it) != null).length / pool.length : 0);

/**
 * Below this coverage a metric is offered but not on by default: items without a value can't
 * be ranked on it, so a sparse default would mostly hide data gaps rather than show trade-offs.
 */
export const DEFAULT_MIN_COVERAGE = 0.7;

/** The metric that's on until the user picks one: the first curated metric, if enough items have it. */
export function defaultMetric(categoryId: string, pool: Item[], all = metricsFor(categoryId, pool)): Metric | null {
  const m = all[0];
  return m && !m.auto && metricCoverage(m, pool) >= DEFAULT_MIN_COVERAGE ? m : null;
}

const LS_KEY = 'ulgdb.metric';
type Saved = Record<string, string>; // category -> metric key, '' = none

export function savedMetricKey(categoryId: string): string | undefined {
  return loadLS<Saved>(LS_KEY, {})[categoryId];
}
export function saveMetricKey(categoryId: string, key: string) {
  saveLS(LS_KEY, { ...loadLS<Saved>(LS_KEY, {}), [categoryId]: key });
}

/** The user's chosen metric for a category (or the default); null when none/unavailable. */
export function activeMetric(categoryId: string, pool: Item[]): Metric | null {
  const all = metricsFor(categoryId, pool);
  const k = savedMetricKey(categoryId);
  if (k === '') return null;
  return all.find((m) => m.key === k) ?? defaultMetric(categoryId, pool, all);
}

export function fmtMetric(v: number | null | undefined, m: Metric, withUnit = true): string {
  if (v == null) return '–';
  const s = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(Math.abs(v) < 10 ? 2 : 1));
  if (!withUnit || !m.unit) return s;
  return m.unit === '°F' ? `${s}°F` : `${s} ${m.unit}`;
}

export const metricTitle = (m: Metric) => (m.unit ? `${m.label} (${m.unit})` : m.label);

/** a better than or equal to b on the metric */
const geq = (a: number, b: number, dir: 1 | -1) => (dir === 1 ? a >= b : a <= b);

/**
 * 3D Pareto frontier on (price, weight, metric): an item is on it when no other item is
 * at least as cheap, as light and as good on the metric, and strictly better on one.
 * Items without a price are left out. Items without a metric value can't be ranked on it,
 * so they keep their place on the 2D weight/price frontier: picking a metric never takes
 * a ★ away for missing data.
 */
export function paretoFrontier3(items: Item[], m: Metric): Set<string> {
  const pts = items
    .map((it) => ({ it, p: it.price_usd, w: it.weight_g, v: m.get(it) }))
    .filter((x): x is { it: Item; p: number; w: number; v: number } => x.p != null && x.v != null);
  const out = new Set<string>();
  for (const a of pts) {
    const dominated = pts.some((b) =>
      b !== a && b.p <= a.p && b.w <= a.w && geq(b.v, a.v, m.dir) && (b.p < a.p || b.w < a.w || b.v !== a.v),
    );
    if (!dominated) out.add(a.it.id);
  }
  const front2 = paretoFrontier(items);
  for (const it of items) if (m.get(it) == null && front2.has(it.id)) out.add(it.id);
  return out;
}
