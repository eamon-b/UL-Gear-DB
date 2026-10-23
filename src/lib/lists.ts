import LZString from 'lz-string';
import type { DB, Item, ListItem, PackList, CustomItem } from './types';
import { uid } from './util';
import { gPerDollar } from './filters';

export interface Resolved {
  li: ListItem;
  item: Item | null; // DB item if any
  name: string;
  cat: string;
  weight_g: number;
  price_usd: number | null;
  url: string | null;
  missing: boolean; // dbId no longer in DB
}

export function resolve(li: ListItem, db: DB): Resolved {
  const item = li.dbId ? db.byId.get(li.dbId) ?? null : null;
  if (item) {
    return {
      li, item, name: item.name,
      cat: li.cat || db.catById.get(item.category)?.name || item.category,
      weight_g: li.weight_g ?? item.weight_g,
      price_usd: li.price_usd !== undefined ? li.price_usd : item.price_usd,
      url: item.url, missing: false,
    };
  }
  const c: CustomItem = li.custom ?? { name: li.dbId ? `Unknown item (${li.dbId})` : 'Item', category: 'Misc', weight_g: 0, price_usd: null };
  return {
    li, item: null, name: c.name, cat: li.cat || c.category || 'Uncategorized',
    weight_g: li.weight_g ?? c.weight_g, price_usd: li.price_usd !== undefined ? li.price_usd : c.price_usd,
    url: c.url ?? null, missing: !!li.dbId && !li.custom,
  };
}

export interface Totals {
  base: number;
  worn: number;
  consumable: number;
  pack: number; // base + consumable
  total: number; // skin-out
  cost: number;
  costKnown: boolean;
  count: number;
  byCat: { cat: string; base: number; total: number; cost: number; n: number }[];
}

/**
 * LighterPack semantics: a worn item with qty > 1 counts one unit as worn and the rest as packed.
 * Consumables count fully as consumable.
 */
export function totals(rs: Resolved[]): Totals {
  const t: Totals = { base: 0, worn: 0, consumable: 0, pack: 0, total: 0, cost: 0, costKnown: true, count: 0, byCat: [] };
  const cats = new Map<string, Totals['byCat'][number]>();
  for (const r of rs) {
    const q = Math.max(0, r.li.qty);
    const w = r.weight_g * q;
    let base = 0;
    if (r.li.consumable) t.consumable += w;
    else if (r.li.worn) {
      const wornUnits = Math.min(1, q);
      t.worn += r.weight_g * wornUnits;
      base = r.weight_g * (q - wornUnits);
    } else base = w;
    t.base += base;
    t.total += w;
    t.count += q;
    if (r.price_usd != null) t.cost += r.price_usd * q;
    else if (q > 0) t.costKnown = false;
    let c = cats.get(r.cat);
    if (!c) cats.set(r.cat, (c = { cat: r.cat, base: 0, total: 0, cost: 0, n: 0 }));
    c.base += base;
    c.total += w;
    c.cost += (r.price_usd ?? 0) * q;
    c.n += q;
  }
  t.pack = t.base + t.consumable;
  t.byCat = [...cats.values()].sort((a, b) => b.total - a.total);
  return t;
}

// ---------------- Share via URL ----------------
type SharedRow = [string | { n: string; c: string; w: number; p?: number | null; u?: string }, number, number, string?, number?, (number | null)?];
interface SharedPayload { v: 1; n: string; i: SharedRow[] }

export function encodeList(l: PackList): string {
  const rows: SharedRow[] = l.items.map((li) => {
    const flags = (li.worn ? 1 : 0) | (li.consumable ? 2 : 0);
    const head: SharedRow[0] = li.dbId && !li.custom
      ? li.dbId
      : { n: li.custom?.name ?? 'Item', c: li.custom?.category ?? '', w: li.custom?.weight_g ?? 0, p: li.custom?.price_usd ?? null, ...(li.custom?.url ? { u: li.custom.url } : {}) };
    const row: SharedRow = [head, li.qty, flags];
    if (li.cat || li.weight_g != null || li.price_usd !== undefined) row.push(li.cat ?? '');
    if (li.weight_g != null || li.price_usd !== undefined) row.push(li.weight_g ?? -1);
    if (li.price_usd !== undefined) row.push(li.price_usd);
    return row;
  });
  const payload: SharedPayload = { v: 1, n: l.name, i: rows };
  return LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeList(s: string): PackList | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(s);
    if (!json) return null;
    const p = JSON.parse(json) as SharedPayload;
    if (!p || !Array.isArray(p.i)) return null;
    const items: ListItem[] = p.i.map(([head, qty, flags, cat, w, price]) => {
      const li: ListItem = { uid: uid(), qty: Number(qty) || 1, worn: !!(flags & 1), consumable: !!(flags & 2) };
      if (typeof head === 'string') li.dbId = head;
      else li.custom = { name: String(head.n), category: String(head.c ?? ''), weight_g: Number(head.w) || 0, price_usd: head.p ?? null, ...(head.u ? { url: head.u } : {}) };
      if (cat) li.cat = cat;
      if (w != null && w >= 0) li.weight_g = w;
      if (price !== undefined) li.price_usd = price;
      return li;
    });
    return { id: 'shared', name: String(p.n || 'Shared list'), items, created: Date.now(), updated: Date.now() };
  } catch {
    return null;
  }
}

export function shareUrl(l: PackList) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/share/${encodeList(l)}`;
}

// ---------------- Lighten my pack ----------------
export interface SwapOption {
  r: Resolved;
  cand: Item;
  saved: number; // grams, x qty
  cost: number; // dollars, x qty
  perGram: number; // $ per gram saved
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isApproved = (v: unknown) => typeof v === 'string' && /IGBC|SIBBG/i.test(v);

/**
 * Is `c` a like-for-like replacement for `cur`? Same type isn't enough: a 50°F quilt
 * is lighter than a 20°F one, a 550 ml pot lighter than a 750 ml one. Only applies
 * when both items carry the spec, so sparse data never hides a candidate.
 */
export function comparable(cur: Item, c: Item): boolean {
  const a = cur.specs, b = c.specs;
  const pair = (k: string) => [num(a[k]), num(b[k])] as const;
  switch (cur.category) {
    case 'sleep-insulation': {
      const [x, y] = pair('temp_rating_f');
      return x == null || y == null || y <= x + 5;
    }
    case 'sleeping-pad': {
      const [x, y] = pair('r_value');
      return x == null || y == null || y >= x - 0.5;
    }
    case 'shelter': {
      const [x, y] = pair('capacity');
      return x == null || y == null || y >= x;
    }
    case 'backpack': {
      const [x, y] = pair('volume_l');
      return x == null || y == null || y >= x * 0.8;
    }
    case 'cookware': {
      const [x, y] = pair('capacity_ml');
      return x == null || y == null || y >= x * 0.8;
    }
    case 'water-storage': {
      const [x, y] = pair('capacity_l');
      return x == null || y == null || y >= x * 0.8;
    }
    case 'power': {
      const [x, y] = pair('capacity_mah');
      return x == null || y == null || y >= x * 0.8;
    }
    case 'food-storage':
      return !isApproved(a.approved) || isApproved(b.approved);
    default:
      return true;
  }
}

export function swapCandidates(r: Resolved, db: DB, opts: { sameSub: boolean; fullPrice: boolean; hideDisc: boolean }): SwapOption[] {
  if (!r.item || r.li.consumable) return [];
  const cur = r.item;
  const q = Math.max(1, r.li.qty);
  const pool = db.byCategory.get(cur.category) ?? [];
  const out: SwapOption[] = [];
  for (const c of pool) {
    if (c.id === cur.id || c.price_usd == null) continue;
    if (opts.sameSub && (c.subcategory !== cur.subcategory || !comparable(cur, c))) continue;
    if (opts.hideDisc && c.discontinued) continue;
    const savedEach = r.weight_g - c.weight_g;
    // ignore rounding-error "savings" (e.g. 1 g for $45): at least 5 g and 3% per unit
    if (savedEach < Math.max(5, r.weight_g * 0.03)) continue;
    const saved = savedEach * q;
    const curPrice = r.price_usd ?? 0;
    const cost = (opts.fullPrice ? c.price_usd : Math.max(0, c.price_usd - curPrice)) * q;
    out.push({ r, cand: c, saved, cost, perGram: cost / saved });
  }
  return out.sort((a, b) => a.perGram - b.perGram || b.saved - a.saved);
}

export interface LightenRow extends SwapOption {
  cumSaved: number;
  cumCost: number;
}

/** Greedy multiple-choice selection: walk all (item, candidate) pairs by $/g, at most one per list item, within budget. */
export function lightenPlan(rs: Resolved[], db: DB, budget: number, opts: { sameSub: boolean; fullPrice: boolean; hideDisc: boolean }) {
  const all: SwapOption[] = [];
  const bestPerItem: SwapOption[] = [];
  for (const r of rs) {
    const c = swapCandidates(r, db, opts);
    if (c.length) {
      bestPerItem.push(c[0]);
      all.push(...c);
    }
  }
  all.sort((a, b) => a.perGram - b.perGram || b.saved - a.saved);
  const used = new Set<string>();
  const picked: LightenRow[] = [];
  let cumSaved = 0, cumCost = 0;
  for (const o of all) {
    if (used.has(o.r.li.uid)) continue;
    if (cumCost + o.cost > budget + 1e-9) continue;
    used.add(o.r.li.uid);
    cumSaved += o.saved;
    cumCost += o.cost;
    picked.push({ ...o, cumSaved, cumCost });
  }
  return { picked, bestPerItem, used };
}

export { gPerDollar };
