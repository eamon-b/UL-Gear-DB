import { describe, expect, it } from 'vitest';
import { applyFilters, emptyFilters } from '../src/lib/filters';
import { search, searchItems } from '../src/lib/search';
import { hydrate } from '../src/lib/data';
import { matchItem, MATCH_THRESHOLD } from '../src/lib/match';
import { loadTestDB } from './helpers';

const db = loadTestDB();
const names = (q: string, n = 5) => searchItems(db.items, q, n).map((it) => it.name);
const all = (q: string) => searchItems(db.items, q);

describe('search', () => {
  it('finds nothing for an empty query', () => {
    expect(search(db.items, '   ').items).toEqual([]);
  });

  it('matches brand, model and variant words in any order, and requires all of them', () => {
    expect(names('zpacks duplex')[0]).toMatch(/^Zpacks Duple/);
    expect(names('duplex zpacks')).toEqual(names('zpacks duplex'));
    expect(all('enlightened equipment enigma 20').every((it) => it.model === 'Enigma' && /20/.test(it.variant ?? ''))).toBe(true);
    expect(all('zpacks duplex nonexistentword')).toEqual([]);
  });

  it('matches while a word is still being typed', () => {
    expect(names('dupl').every((n) => /Duple/i.test(n))).toBe(true);
    expect(all('tarpt').length).toBeGreaterThan(10);
    expect(all('tarpt').every((it) => it.brand === 'Tarptent')).toBe(true);
  });

  it.each([
    ['hmg', 'Hyperlite Mountain Gear'],
    ['mld', 'Mountain Laurel Designs'],
    ['s2s', 'Sea to Summit'],
    ['thermarest', 'Therm-a-Rest'],
    ['zpack', 'Zpacks'],
    ['OR', 'Outdoor Research'],
    ['petzel', 'Petzl'],
    ['arcteryx', "Arc'teryx"],
  ])('knows the brand nickname %s', (q, brand) => {
    const res = all(q);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((it) => it.brand === brand)).toBe(true);
    expect(res.length).toBe(db.items.filter((it) => it.brand === brand).length);
  });

  it('does not rewrite database names with the nickname rules', () => {
    // a Hennessy hammock model is called "Hyperlite": it is not a Hyperlite Mountain Gear item
    expect(all('hmg').some((it) => it.brand === 'Hennessy Hammock')).toBe(false);
    expect(all('hennessy hyperlite').length).toBeGreaterThan(0);
  });

  it('treats words split or glued differently as the same', () => {
    const xmid = all('xmid').map((it) => it.id);
    expect(xmid.length).toBeGreaterThan(0);
    expect(xmid.every((id) => /x-mid/.test(id))).toBe(true);
    expect(all('x-mid').map((it) => it.id)).toEqual(expect.arrayContaining(xmid));
    expect(all('neo air xlite').length).toBe(all('neoair xlite').length);
    expect(all('pocket rocket').some((it) => it.model.startsWith('PocketRocket'))).toBe(true);
    expect(all('uberlight').map((it) => it.id)).toEqual(all('uberlite').map((it) => it.id));
  });

  it('understands kinds of gear the names do not spell out', () => {
    for (const [q, cat] of [
      ['puffy', 'insulation'],
      ['bear can', 'food-storage'],
      ['headtorch', 'lighting'],
      ['power bank', 'power'],
      ['rain jacket', 'rain-jacket'],
      ['trekking poles', 'trekking-poles'],
    ]) {
      const res = search(db.items, q);
      expect(res.categories, q).toContain(cat);
      expect(res.items.length, q).toBeGreaterThan(5);
      expect(res.items[0].category, q).toBe(cat);
    }
    // a kind plus a brand narrows to that brand's items of that kind
    const zt = all('zpacks tent');
    expect(zt.length).toBeGreaterThan(3);
    expect(zt.every((it) => it.brand === 'Zpacks')).toBe(true);
    expect(zt[0].category).toBe('shelter');
  });

  it('finds items by text specs such as material', () => {
    const res = all('dcf tarp');
    expect(res.length).toBeGreaterThan(5);
    expect(res.every((it) => it.category === 'shelter')).toBe(true);
  });

  it('keeps numbers exact, apart from the unit', () => {
    expect(all('toaks 750').every((it) => /750/.test(it.name + JSON.stringify(it.specs)))).toBe(true);
    expect(all('toaks 750').length).toBeGreaterThan(0);
    expect(all('enigma 2').length).toBe(0); // "2" is not a prefix of "20"
  });

  it('corrects a typo only when the query finds nothing as typed', () => {
    const typo = search(db.items, 'tarptnet');
    expect(typo.corrected).toBe('tarptent');
    expect(typo.items[0].brand).toBe('Tarptent');
    expect(search(db.items, 'ghost wisperer').items[0].model).toMatch(/Ghost Whisperer/);
    expect(search(db.items, 'tarptent').corrected).toBeNull();
    expect(search(db.items, 'qqqqzzzz').items).toEqual([]);
  });

  it('ranks a model match above a mention elsewhere, lightest first among equals', () => {
    const res = all('duplex');
    expect(res[0].model).toMatch(/^Duplex/);
    const helium = all('helium');
    for (let i = 1; i < helium.length; i++) {
      // every result names Helium in the model, so they tie and fall back to weight
      if (
        helium[i].discontinued === helium[i - 1].discontinued &&
        /\bHelium\b/.test(helium[i].model) &&
        /\bHelium\b/.test(helium[i - 1].model)
      )
        expect(helium[i].weight_g).toBeGreaterThanOrEqual(helium[i - 1].weight_g);
    }
  });
});

describe('the in-category text filter uses the same matching', () => {
  const pool = db.byCategory.get('sleeping-pad')!;
  const filter = (q: string) => applyFilters(pool, { ...emptyFilters(), q });

  it('accepts nicknames and split words, and keeps the list order', () => {
    const res = filter('thermarest x lite');
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((it) => it.brand === 'Therm-a-Rest' && /XLite/.test(it.model))).toBe(true);
    expect(res).toEqual(pool.filter((it) => res.includes(it)));
  });

  it('an empty query filters nothing out', () => {
    expect(filter('')).toHaveLength(pool.length);
  });
});

describe('other names for an item (aka)', () => {
  const tiny = hydrate({
    generated_at: '',
    categories: [],
    items: [
      {
        id: 'evernew-pot-900',
        category: 'cookware',
        subcategory: 'pot',
        brand: 'Evernew',
        model: 'Titanium Ultralight Pot 900',
        weight_g: 99,
      },
      {
        id: 'evernew-pot-600',
        category: 'cookware',
        subcategory: 'pot',
        brand: 'Evernew',
        model: 'Titanium Ultralight Pot 600',
        weight_g: 80,
      },
    ],
  });
  const withAka = hydrate({
    generated_at: '',
    categories: [],
    items: tiny.items.map((it) => (it.id === 'evernew-pot-900' ? { ...it, aka: ['ECA252R'] } : it)),
  });
  const top = (db: typeof tiny) => matchItem('Evernew ECA-252R (0.9L)', '', 100, db)[0];

  it('search finds the item by either name', () => {
    expect(searchItems(tiny.items, 'eca252r')).toEqual([]);
    expect(searchItems(withAka.items, 'eca252r').map((it) => it.id)).toEqual(['evernew-pot-900']);
    expect(searchItems(withAka.items, 'evernew pot 900').map((it) => it.id)).toEqual(['evernew-pot-900']);
  });

  it('the import matcher does too, and lists the item once', () => {
    expect((top(tiny)?.score ?? 0) < MATCH_THRESHOLD).toBe(true);
    expect(top(withAka).item.id).toBe('evernew-pot-900');
    expect(top(withAka).score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    const ids = matchItem('Evernew titanium pot', '', null, withAka).map((m) => m.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
