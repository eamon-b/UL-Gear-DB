import type { Category, DB, Item } from './types';

let cache: Promise<DB> | null = null;

interface RawBundle {
  generated_at: string;
  sample?: boolean;
  categories: Category[];
  items: Partial<Item>[];
  /** old id -> current id (merged duplicates, renamed ids) */
  aliases?: Record<string, string>;
}

export function hydrate(raw: RawBundle): DB {
  const items: Item[] = raw.items.map((r) => {
    const it = {
      variant: null,
      weight_basis: 'manufacturer',
      weight_note: null,
      price_usd: null,
      specs: {},
      url: null,
      discontinued: false,
      confidence: 'low',
      notes: null,
      ...r,
    } as Item;
    it.name = [it.brand, it.model, it.variant].filter(Boolean).join(' ');
    it.search = (it.name + ' ' + it.subcategory + ' ' + it.category).toLowerCase();
    return it;
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  // Old ids keep resolving so saved/shared lists don't break when records are merged.
  for (const [from, to] of Object.entries(raw.aliases ?? {})) {
    const target = byId.get(to);
    if (target && !byId.has(from)) byId.set(from, target);
  }
  const byCategory = new Map<string, Item[]>();
  for (const c of raw.categories) byCategory.set(c.id, []);
  for (const i of items) {
    if (!byCategory.has(i.category)) byCategory.set(i.category, []);
    byCategory.get(i.category)!.push(i);
  }
  return {
    generated_at: raw.generated_at,
    sample: !!raw.sample,
    categories: raw.categories,
    catById: new Map(raw.categories.map((c) => [c.id, c])),
    items,
    byId,
    byCategory,
  };
}

export function loadDB(): Promise<DB> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/gear.json`, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading gear.json`);
        return r.json();
      })
      .then(hydrate);
  }
  return cache;
}

/** Tokenized search across name/subcategory/category. All tokens must match. */
export function searchItems(items: Item[], q: string, limit = Infinity): Item[] {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out: { it: Item; s: number }[] = [];
  for (const it of items) {
    let ok = true;
    let s = 0;
    for (const t of toks) {
      const idx = it.search.indexOf(t);
      if (idx < 0) { ok = false; break; }
      s += idx === 0 || it.search[idx - 1] === ' ' ? 2 : 1;
      if (it.name.toLowerCase().includes(t)) s += 1;
    }
    if (ok) out.push({ it, s });
  }
  out.sort((a, b) => b.s - a.s || a.it.weight_g - b.it.weight_g);
  return out.slice(0, limit).map((x) => x.it);
}
