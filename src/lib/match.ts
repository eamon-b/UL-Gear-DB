import type { DB, Item } from './types';
import { brandsIn, expandQuery, gearIndex, tokenHits } from './gearIndex';
import { COMMON_WORDS, FILLER_WORDS, findTypes, isNumeric, kindsOf, MODIFIER_WORDS, QUALIFIER_WORDS, tokenize, TYPE_WORDS } from './text';

export interface Match {
  item: Item;
  score: number; // 0..1
}

/** At or above this a match is picked automatically; below it is only offered. */
export const MATCH_THRESHOLD = 0.7;

/** A number in the row belongs to the product only if it sits this close to the product's words. */
const NEAR = 3;

/**
 * Match a pack-list row (name + description, as LighterPack has them) to database items.
 *
 * The score is the share of an item's identity (brand + model words, rare words weighing most)
 * that the row mentions. A model word only one brand uses ("Duplex") stands in for the brand.
 * It is then cut when the brand is all that matched, and for anything the row says that
 * contradicts the item: another brand, another kind of gear, another size or version number,
 * words the item does not explain, a very different weight.
 */
export function matchItem(name: string, desc: string, weightG: number | null, db: DB, top = 6): Match[] {
  const ix = gearIndex(db.items);
  const nameToks = tokenize(name);
  const descToks = tokenize(desc);
  const toks = [...nameToks, ...descToks];
  if (!toks.length) return [];
  const q = expandQuery(toks, ix);
  const posOf = new Map<string, number[]>();
  toks.forEach((t, i) => (posOf.get(t) ?? posOf.set(t, []).get(t)!).push(i));
  // a brand in the name is the item's; brands in the description are often comparisons ("or Smartwater")
  const nameBrands = brandsIn(nameToks, ix);
  const qBrands = nameBrands.size ? nameBrands : brandsIn(toks, ix);
  const qBrandToks = new Set([...qBrands].flatMap((k) => k.split(' ')));
  // A field up to where the extras and remarks start: "Petzl e+Lite + 2 spare batteries", "Sun Runner w/ neck cape"
  const head = (raw: string) => tokenize(raw.split(/\s[+/-]\s|[(,;]|\sw\/|\swith\s|\sincl/i)[0]);
  // likewise the name says what kind of thing it is more reliably than the free-text description
  const nameTypes = findTypes(nameToks);
  const types = nameTypes.length ? nameTypes : findTypes(head(desc));
  const typeCats = new Set(types.flatMap((t) => t.cats));
  const typeSubs = new Set(types.flatMap((t) => t.subs ?? []));
  const maxW = Math.log(1 + ix.entries.length);
  // The words that should name the product, not just say what kind of thing it is or what size.
  // Rows put the product in either field ("Duplex | my tent" or "Tent | Zpacks Duplex"), ahead of any remarks.
  const key = (ts: string[]) =>
    ts.filter(
      (t) =>
        t.length > 1 && !isNumeric(t) && !TYPE_WORDS.has(t) && !FILLER_WORDS.has(t) && (!COMMON_WORDS.has(t) || QUALIFIER_WORDS.has(t)),
    );
  const nameKey = key(head(name).length ? head(name) : nameToks);
  const descKey = key(head(desc).length ? head(desc) : descToks);
  const keyW = (t: string) => (ix.df.has(t) ? ix.weight(t) : maxW);
  const qKinds = kindsOf(toks);
  const nameSet = new Set(nameToks);

  const cands = new Set(
    [...q.keys()].flatMap((t) => {
      const list = ix.byTok.get(t) ?? [];
      // words a big share of the database has ("jacket") find nothing by themselves
      return [...(list.length <= 400 ? list : []), ...(ix.byJoin.get(t) ?? [])];
    }),
  );

  const out: (Match & { mass: number })[] = [];
  for (const e of cands) {
    const { hit, src } = tokenHits(e, q);
    const nb = e.brand.length,
      nm = e.model.length;
    // where in the row this item's words were found
    const used = new Set<string>();
    const at: number[] = [];
    e.all.forEach((t, i) => {
      if (!hit[i] || isNumeric(t)) return;
      for (const s of src[i]) (used.add(s), at.push(...(posOf.get(s) ?? [])));
    });
    const near = (t: string) => !at.length || (posOf.get(t) ?? []).some((p) => at.some((a) => Math.abs(a - p) <= NEAR));
    const inCat = typeCats.has(e.it.category);
    let b = 0,
      bAll = true,
      bTot = 0,
      m = 0,
      mTot = 0,
      vMiss = 0,
      vTot = 0,
      got = 0,
      families = 0,
      familyInName = false,
      missedNum = false;
    e.all.forEach((t, i) => {
      const w = e.w[i];
      // "2E" at the far end of the row is a shoe width, not the "2" of this model
      let h = hit[i];
      if (h && isNumeric(t) && !near(t)) h = 0;
      if (h && isNumeric(t)) used.add(t);
      if (i < nb) {
        bTot += w;
        b += w * h;
        if (!h) bAll = false;
      } else if (i < nb + nm) {
        // "Mini Bic" need not say "Lighter": leaving out the kind of thing costs little, unless the row names another kind
        const mw = !h && TYPE_WORDS.has(t) && !MODIFIER_WORDS.has(t) && (inCat || !typeCats.size) ? w * 0.3 : w;
        mTot += mw;
        m += mw * h;
        if (h >= 0.9 && ix.family.get(t) === e.brandKey) {
          families++;
          if (src[i].some((x) => nameSet.has(x))) familyInName = true;
        }
      } else {
        vTot += w;
        // "Men's" or "Regular" left unsaid is normal; "20°F" or "Pro" left unsaid is a real difference
        vMiss += w * (1 - h) * (FILLER_WORDS.has(t) ? 0.3 : 1);
      }
      if (i >= nb) {
        got += w * h;
        if (!h && isNumeric(t)) missedNum = true;
      }
    });
    if (got === 0) continue;
    const otherBrand = qBrands.size > 0 && !qBrands.has(e.brandKey);
    // relative difference in weight; under 30 g a few grams either way mean nothing
    const off = weightG && weightG > 0 ? Math.abs(e.it.weight_g - weightG) / Math.max(weightG, e.it.weight_g, 30) : null;
    // half a brand is no brand: "First aid" is not Peak First Aid
    if (!bAll) b = 0;
    // A model word only this brand uses stands in for the brand, if the row gives a reason to read it
    // as a product name: it is in the name, or there are two such words, or the kind of gear agrees.
    if (families && (familyInName || families > 1 || inCat) && !otherBrand && (off == null || off < 0.5)) b = Math.max(b, bTot * 0.9);
    let s = (b + m) / (bTot + mTot || 1);
    // the brand alone does not pick a product: "MLD bivy" is not yet the MLD Bug Bivy
    if (mTot) s *= 0.6 + 0.4 * (m / mTot);
    // an unmentioned variant costs a little, so the variant the row does name wins
    if (vTot) s *= 1 - 0.18 * (vMiss / vTot);

    if (otherBrand) s *= 0.5;
    if (typeCats.size && !inCat) s *= 0.7;
    // right shelf, other kind (people do call a quilt a sleeping bag): only enough to break ties
    else if (typeSubs.size && !typeSubs.has(e.it.subcategory)) s *= 0.92;
    // a top is not a bottom: "Wind shirt | Tachyon" is not the Tachyon Pants
    const kinds = kindsOf(e.model);
    if (qKinds.size && kinds.size && ![...kinds].some((k) => qKinds.has(k))) s *= 0.75;
    // "PowerCore 20000" is not the PowerCore 10000, and "Lone Peak 3.5" is not the Lone Peak 9:
    // the item has a number the row lacks, and the row has another one right beside the matched words.
    if (missedNum && toks.some((t) => isNumeric(t) && !e.all.includes(t) && at.length && near(t))) s *= 0.7;
    // words in the row that this item does not explain point at some other product
    const explained = (ks: string[]) => {
      let tot = 0,
        ok = 0;
      for (const t of ks) {
        const w = keyW(t);
        tot += w;
        if (used.has(t) || qBrandToks.has(t)) ok += w;
      }
      return tot ? ok / tot : null;
    };
    const en = explained(nameKey),
      ed = explained(descKey);
    if (en != null) s *= 0.5 + 0.5 * Math.max(en, ed ?? 0);
    // the name only says "Sleep Pad": the description is commentary as often as it is the product, so go easier
    else if (ed != null) s *= 0.8 + 0.2 * ed;
    if (off != null) s *= off < 0.08 ? 1.06 : off < 0.2 ? 1.02 : off > 0.75 ? 0.6 : off > 0.5 ? 0.8 : 1;
    out.push({ item: e.it, score: s, mass: b + got });
  }

  // on a tie the item that accounts for more of the row wins: "inReach Mini 2" over "inReach Mini"
  out.sort((a, b) => b.score - a.score || b.mass - a.mass || a.item.name.length - b.item.name.length);
  // an item with other names (`aka`) was scored once per name: keep its best
  const seen = new Set<Item>();
  const best = out.filter((x) => !seen.has(x.item) && seen.add(x.item));
  return best.slice(0, top).map((x) => ({ item: x.item, score: Math.max(0, Math.min(1, x.score)) }));
}
