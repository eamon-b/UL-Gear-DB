import type { Item } from './types';
import { gearIndex, type GearIndex } from './gearIndex';
import { editDistance, findTypes, isNumeric, tokenize, type TypeHit } from './text';

export interface SearchResult {
  items: Item[];
  /** What the query was read as when nothing matched as typed ("thermarest xlight" -> ...), else null. */
  corrected: string | null;
  /** Categories the query names as a kind of gear ("puffy" -> insulation), most specific first. */
  categories: string[];
}

/** An item's words, by where they come from. Built once per item. */
interface Words {
  brand: string[];
  model: string[];
  variant: string[];
  /** other names for the same product */
  aka: string[];
  /** also findable by: category, type and text specs (material, fuel...) */
  extra: string[];
}
const wordsCache = new WeakMap<Item, Words>();
function wordsOf(it: Item): Words {
  let w = wordsCache.get(it);
  if (!w) {
    const specs = Object.values(it.specs).filter((v): v is string => typeof v === 'string');
    w = {
      brand: tokenize(it.brand, 'exact'),
      model: tokenize(it.model, 'exact'),
      variant: tokenize(it.variant ?? '', 'exact'),
      aka: tokenize((it.aka ?? []).join(' '), 'exact'),
      extra: tokenize([it.category.replace(/-/g, ' '), it.subcategory, ...specs].join(' '), 'exact'),
    };
    wordsCache.set(it, w);
  }
  return w;
}

/** How well one query word is found in a list of an item's words: 0 = not at all. */
function wordScore(t: string, words: string[], prev: string | undefined, next: string | undefined): number {
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let s = 0;
    if (w === t) s = 3;
    else if (isNumeric(t) || isNumeric(w))
      s = w === t + 'ml' ? 2.5 : 0; // "750" finds "750ml", but "20" must not find "200"
    else if (t.length >= 2 && w.startsWith(t)) s = 2.2;
    else if (t.length >= 3 && w.includes(t)) s = 1.2;
    // written as one word here, two there: "xmid" / "x mid", "neo air" / "neoair"
    if (!s && i + 1 < words.length && w + words[i + 1] === t) s = 2.5;
    if (!s && i > 0 && words[i - 1] + w === t) s = 2.5;
    if (!s && ((next && t + next === w) || (prev && prev + t === w))) s = 2.5;
    if (s > best) best = s;
  }
  return best;
}

/** How well an item answers a tokenised query; 0 unless every word is found. */
function score(it: Item, toks: string[], types: TypeHit[]): number {
  const w = wordsOf(it);
  let total = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i],
      prev = toks[i - 1],
      next = toks[i + 1];
    let s = Math.max(
      wordScore(t, w.model, prev, next),
      0.95 * wordScore(t, w.aka, prev, next),
      0.9 * wordScore(t, w.brand, prev, next),
      0.7 * wordScore(t, w.variant, prev, next),
      0.4 * wordScore(t, w.extra, prev, next),
    );
    // "puffy", "bear can": the word names a kind of gear this item is
    const type = types.find((h) => i >= h.at && i < h.at + h.len);
    if (type && type.cats.includes(it.category) && (!type.subs || type.subs.includes(it.subcategory))) s = Math.max(s, 3.5);
    if (!s) return 0;
    total += s;
  }
  return total;
}

function run(pool: Item[], toks: string[]): Item[] {
  const types = findTypes(toks);
  const out: { it: Item; s: number }[] = [];
  for (const it of pool) {
    const s = score(it, toks, types);
    if (s) out.push({ it, s });
  }
  return out.sort((a, b) => b.s - a.s || +a.it.discontinued - +b.it.discontinued || a.it.weight_g - b.it.weight_g).map((x) => x.it);
}

/** The closest word the database knows for a mistyped one, or null. */
function nearestWord(t: string, ix: GearIndex): string | null {
  if (t.length < 4 || isNumeric(t)) return null;
  const max = t.length >= 7 ? 2 : 1;
  let best: string | null = null,
    bestD = max + 1,
    bestDf = 0;
  for (const v of ix.vocab) {
    if (v.length < 4 || isNumeric(v)) continue;
    const d = editDistance(t, v, max);
    const df = ix.df.get(v) ?? 0;
    if (d < bestD || (d === bestD && df > bestDf)) ((best = v), (bestD = d), (bestDf = df));
  }
  return bestD <= max ? best : null;
}

/**
 * Search items by brand, model, variant, kind of gear and text specs. Every word must be found.
 * Understands brand nicknames ("HMG", "thermarest"), kinds of gear ("puffy", "bear can"),
 * words split or glued differently ("x mid", "neo air") and, when nothing matches, typos.
 */
export function search(items: Item[], q: string, limit = Infinity): SearchResult {
  const toks = tokenize(q, 'query');
  if (!toks.length) return { items: [], corrected: null, categories: [] };
  const categories = [...new Set(findTypes(toks).flatMap((t) => t.cats))];
  let hits = run(items, toks);
  let corrected: string | null = null;
  if (!hits.length) {
    // fix only the words nothing in the database starts with
    const ix = gearIndex(items);
    const fixed = toks.map((t) => (ix.vocab.some((v) => v.startsWith(t)) ? t : (nearestWord(t, ix) ?? t)));
    if (fixed.some((t, i) => t !== toks[i])) {
      hits = run(items, fixed);
      if (hits.length) corrected = fixed.join(' ');
    }
  }
  return { items: hits.slice(0, limit), corrected, categories };
}

export const searchItems = (items: Item[], q: string, limit = Infinity): Item[] => search(items, q, limit).items;

/** The same matching as a yes/no test, for filtering a list that keeps its own order. */
export function textFilter(q: string): ((it: Item) => boolean) | null {
  const toks = tokenize(q, 'query');
  if (!toks.length) return null;
  const types = findTypes(toks);
  return (it) => score(it, toks, types) > 0;
}
