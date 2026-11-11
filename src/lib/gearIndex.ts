import type { Item } from './types';
import { COMMON_WORDS, editDistance, FILLER_WORDS, isNumeric, joins, NEUTRAL_WORDS, QUALIFIER_WORDS, tokenize, TYPE_WORDS } from './text';

/** One item as the matcher and search see it. */
export interface Entry {
  it: Item;
  brand: string[];
  model: string[];
  variant: string[];
  /** brand + model + variant, in order */
  all: string[];
  /** identity weight of each token in `all` */
  w: number[];
  brandKey: string;
}

export interface GearIndex {
  entries: Entry[];
  /** token or adjacent-token join -> entries that contain it */
  byTok: Map<string, Entry[]>;
  byJoin: Map<string, Entry[]>;
  df: Map<string, number>;
  vocab: string[];
  /** normalised brand tokens joined by a space -> brand key */
  brands: Map<string, string>;
  maxBrandLen: number;
  /** model words that only one brand uses ("duplex", "houdini"): they imply the brand */
  family: Map<string, string>;
  weight(tok: string): number;
}

/** Brands whose name is an everyday word: never read as a brand mention on its own. */
const WEAK_BRANDS = new Set([
  'on',
  'drop',
  'rabbit',
  'generic',
  'diy',
  'rocky',
  'coast',
  'buff',
  'spot',
  'sol',
  'keith',
  'easton',
  'matador',
]);

const cache = new WeakMap<Item[], GearIndex>();

export function gearIndex(items: Item[]): GearIndex {
  let ix = cache.get(items);
  if (ix) return ix;
  const df = new Map<string, number>();
  // One entry per name an item goes by: its model, then each `aka` in place of the model.
  const raw = items.flatMap((it) => {
    const brand = tokenize(it.brand, 'exact'),
      variant = tokenize(it.variant ?? '', 'exact');
    const seen = new Set<string>();
    return [it.model, ...(it.aka ?? [])].map((name) => {
      const model = tokenize(name, 'exact');
      const all = [...brand, ...model, ...variant];
      for (const t of new Set(all)) if (!seen.has(t)) (seen.add(t), df.set(t, (df.get(t) ?? 0) + 1));
      return { it, brand, model, variant, all, brandKey: brand.join(' ') };
    });
  });
  const n = Math.max(1, items.length);
  // Rare words carry the identity ("duplex"); words every item has ("jacket", "mens") carry little.
  const weight = (tok: string) => {
    const idf = Math.log(1 + n / (df.get(tok) ?? 1));
    const k =
      tok.length === 1
        ? 0.4
        : NEUTRAL_WORDS.has(tok)
          ? 0.2
          : FILLER_WORDS.has(tok)
            ? 0.3
            : TYPE_WORDS.has(tok) || QUALIFIER_WORDS.has(tok)
              ? 0.6
              : 1;
    return idf * k;
  };
  // A model that repeats its brand ("Kula Kula Cloth", "Atom Packs The Atom") says nothing new by it.
  const entries: Entry[] = raw.map((r) => ({
    ...r,
    w: r.all.map((t, i) => (i >= r.brand.length && r.brand.includes(t) ? 0 : weight(t))),
  }));
  const byTok = new Map<string, Entry[]>();
  const byJoin = new Map<string, Entry[]>();
  const push = (m: Map<string, Entry[]>, k: string, e: Entry) => {
    const a = m.get(k);
    if (!a) m.set(k, [e]);
    else if (a[a.length - 1] !== e) a.push(e);
  };
  const brands = new Map<string, string>();
  const modelBrands = new Map<string, Set<string>>();
  let maxBrandLen = 1;
  for (const e of entries) {
    for (const t of e.all) push(byTok, t, e);
    for (const j of joins(e.all)) push(byJoin, j, e);
    if (e.brand.length && !(e.brand.length === 1 && WEAK_BRANDS.has(e.brand[0]))) {
      brands.set(e.brandKey, e.brandKey);
      maxBrandLen = Math.max(maxBrandLen, e.brand.length);
    }
    for (const t of e.model) {
      if (t.length < 3 || isNumeric(t) || TYPE_WORDS.has(t) || COMMON_WORDS.has(t) || FILLER_WORDS.has(t)) continue;
      let s = modelBrands.get(t);
      if (!s) modelBrands.set(t, (s = new Set()));
      s.add(e.brandKey);
    }
  }
  const family = new Map<string, string>();
  for (const [t, s] of modelBrands) if (s.size === 1) family.set(t, [...s][0]);
  ix = {
    entries,
    byTok,
    byJoin,
    df,
    vocab: [...df.keys()],
    brands,
    maxBrandLen,
    family,
    weight,
  };
  cache.set(items, ix);
  return ix;
}

/** Brand keys named in a token list ("sea to summit" as three tokens in a row). */
export function brandsIn(toks: string[], ix: GearIndex): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    for (let n = Math.min(ix.maxBrandLen, toks.length - i); n >= 1; n--) {
      const k = ix.brands.get(toks.slice(i, i + n).join(' '));
      if (k) {
        out.add(k);
        break;
      }
    }
  }
  return out;
}

/** How strongly a query stands for an index token, and which of its own words say so. */
export interface QHit {
  c: number;
  src: string[];
}

/**
 * A query as a weighted set of index tokens: each word of the query, plus what it most likely
 * stands for in the vocabulary (a glued pair, a plural, a one-letter typo).
 */
export function expandQuery(toks: string[], ix: GearIndex, fuzzy = true): Map<string, QHit> {
  const q = new Map<string, QHit>();
  const add = (t: string, c: number, src: string[]) => {
    if ((q.get(t)?.c ?? 0) < c) q.set(t, { c, src });
  };
  for (const t of toks) add(t, 1, [t]);
  for (let i = 0; i + 1 < toks.length; i++) {
    const j = toks[i] + toks[i + 1];
    if (ix.df.has(j) && !(isNumeric(toks[i]) && isNumeric(toks[i + 1]))) add(j, 0.9, [toks[i], toks[i + 1]]); // "neo air" -> "neoair"
  }
  for (const t of toks) {
    if (ix.df.has(t) || isNumeric(t) || t.length < 4) continue;
    for (const v of ix.vocab) {
      if (isNumeric(v) || v.length < 4) continue;
      if (Math.abs(v.length - t.length) <= 2 && (v.startsWith(t) || t.startsWith(v))) add(v, 0.8, [t]);
      else if (fuzzy && t.length >= 5 && v.length >= 5 && editDistance(t, v, 1) <= 1) add(v, 0.7, [t]);
    }
  }
  return q;
}

/** How well each token of an entry is found in the query (0..1 per token of `e.all`), and through which query words. */
export function tokenHits(e: Entry, q: Map<string, QHit>): { hit: number[]; src: string[][] } {
  const hit: number[] = [],
    src: string[][] = [];
  e.all.forEach((t, i) => {
    const h = q.get(t);
    hit[i] = h?.c ?? 0;
    src[i] = h?.src ?? [];
  });
  // the query wrote two of our words as one: "xmid" for "x", "mid"
  for (let i = 0; i + 1 < e.all.length; i++) {
    const j = e.all[i] + e.all[i + 1];
    if (q.get(j)?.c !== 1) continue;
    for (const k of [i, i + 1]) if (hit[k] < 0.9) ((hit[k] = 0.9), (src[k] = [j]));
  }
  return { hit, src };
}
