import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLighterPackCSV } from '../src/lib/csv';
import { matchItem, MATCH_THRESHOLD } from '../src/lib/match';
import { loadTestDB, ROOT } from './helpers';

const db = loadTestDB();
/** The item a row is matched to automatically, or null when it is left as a custom item. */
const auto = (name: string, desc = '', weightG: number | null = null) => {
  const m = matchItem(name, desc, weightG, db)[0];
  return m && m.score >= MATCH_THRESHOLD ? m.item.id : null;
};

/**
 * Rows as hikers really write them, taken from the example lists (name | description | grams).
 * Each one is a way the matcher has been wrong before.
 */
describe('matchItem finds the item a row means', () => {
  it.each([
    // the product is in the name
    ['Zpacks Duplex', '', null, 'zpacks-duplex-classic'],
    ['Tarptent Aeon Li', '', 459, 'tarptent-aeon-li'],
    ['Durston Gear X-mid 1', '', 794, 'durston-x-mid-1'],
    ['Garmin InReach Mini 3', 'Personal Beacon', 113, 'garmin-inreach-mini-3'],
    ['Garmin inReach Mini 2', '', 100, 'garmin-inreach-mini-2'],
    ['Gossamer Gear LT5 poles', '', 280, 'gossamer-gear-lt5-three-piece-carbon'],
    ['Frogg Toggs UltraLite2 jacket', '', 160, 'frogg-toggs-ultra-lite2-jacket-mens'],
    ['Nitecore NB10000 Gen2 Battery Bank', '', 147, 'nitecore-nb10000-gen-2'],
    // ...or in the description, behind a name that only says what kind of thing it is
    ['Pack', 'ULA circuit', 1361, 'ula-circuit'],
    ['Tent', 'TT Aeon Li (w/stakes and sack)', 513, 'tarptent-aeon-li'],
    ['Quilt', 'EE Enigma 20', 605, 'enlightened-equipment-enigma-20f-850fp'],
    ['Stove', 'Snow Peak Litemax', 50, 'snow-peak-litemax'],
    ['Rescue / communication', 'Garmin InReach Mini', 102, 'garmin-inreach-mini'],
    ['Needle & Thread', 'Zpacks Sewing Repair Kit', 10, 'zpacks-sewing-repair-kit'],
    ['Poop Scoop', 'Deuce of Spades', 17, 'the-tent-lab-deuce-of-spades-2'],
    // no brand, but only one brand makes it
    ['Houdini', 'Wind', 105, 'patagonia-houdini-jacket-mens'],
    ['Pocket Rocket Deluxe', '', 82, 'msr-pocketrocket-deluxe'],
    ['Down Jacket', 'Ghost Whisperer', 213, 'mountain-hardwear-ghost-whisperer-2-jacket-mens'],
    ['NeoAir Xlite Regular', 'Sleeping Pad', 340, 'therm-a-rest-neoair-xlite-regular'],
    ['mini bic', '', 11, 'bic-mini-lighter'],
    // brand nicknames and misspellings
    ['Sleeping pad', 'Thermarest Neoair Uberlight Small', 179, 'therm-a-rest-neoair-uberlite-small'],
    ['Petzyl E-Lite (inc bat)', '', 26, 'petzl-e-lite'],
    ['Petzl eLight headlamp + 2 CR2032 batteries', '', 27, 'petzl-e-lite'],
    ['Trekking Poles', 'BD Alpine Carbon Cork', 485, 'black-diamond-alpine-carbon-cork'],
    ['Buff', 'OR Echo Ubertube', 22, 'outdoor-research-echo-ubertube'],
    ['Umbrella', 'SMD Silver Shadow Carbon', 181, 'six-moon-designs-silver-shadow-carbon-trekking-umbrella'],
    ['Pillow', 'S2S Aeros UL', 54, 'sea-to-summit-aeros-ultralight-pillow-regular'],
    ['Hyperlite Stuff Sack Pillow', '', 45, 'hyperlite-mountain-gear-pillow-stuff-sack'],
    ['Microspikes', 'Katoohla? will buy if needed', 408, 'kahtoola-microspikes'],
    ['The Duece Trowel', '', 16, 'the-tent-lab-deuce-of-spades-2'],
    ['Garmin In-Reach Mini', "So my partner won't be worried", 100, 'garmin-inreach-mini'],
    ['MSR Pocket Rocket 2', '', 74, 'msr-pocketrocket-2'],
    ['Water filter', 'Katadyn Befree 600ml', 88, 'katadyn-befree-0-6l'],
    // older versions and accessories that have a record of their own (added from `npm run gaps`)
    ['Pack', 'Granite Gear Crown2 38', 907, 'granite-gear-crown2-38'],
    ['Altra Lone Peak 2.5 trail runners', '', 700, 'altra-lone-peak-2-5'],
    ['Footprint', 'Big Agnes Tiger Wall UL 2', 170, 'big-agnes-tiger-wall-ul2-footprint'],
    ['Atom Packs Prospector 40 pack', 'With carbon frame', 700, 'atom-packs-prospector-40'],
    ['Patagonia Capilene Thermal Weight Top', '', 211, 'patagonia-capilene-thermal-weight-crew-mens'],
    ['Sleep Pad', 'Nemo Tensor Insulated', 539, 'nemo-tensor-insulated-regular-wide'],
    ['HMG Windrider 3400', 'w/ Zimmerbuilt Hip Pockets', 1036, 'hmg-windrider-55'],
    // the right size or variant, when the row gives one
    ['Sleeping Quilt', 'Enlightened Equipment Enigma (30*)', 435, 'enlightened-equipment-enigma-30f-950fp'],
    ['Zpacks Arc Haul (60l)', '', 700, 'zpacks-arc-haul-ultra-60l'],
    ['0.7L smartwater bottle + cap + leash + biner', '', 27, 'smartwater-700ml-sport'],
    ['Additional Water Storage', 'CNOC Vecto Water Bag (2L)', 73, 'cnoc-vecto-28mm-2l'],
    ['Wind Pants', 'Montbell Tachyon  (M)', 52, 'montbell-tachyon-pants-mens'],
    ['Thermal Bottoms', 'Capilene Thermal Weight (M)', 139, 'patagonia-capilene-thermal-weight-bottoms-mens'],
  ] as const)('%s | %s', (name, desc, w, id) => {
    expect(db.byId.has(id)).toBe(true);
    expect(auto(name, desc, w)).toBe(id);
  });
});

describe('matchItem leaves a row alone rather than guess', () => {
  it.each([
    // things the database does not hold
    ['iPhone 11 Pro', '', 188],
    ['Fujifilm X-T2', 'With 16-55 f/2.8 lens', 1250],
    ['2L', 'Water', 1996],
    ["LT Hiker's Guide", 'My custom made summary', 59],
    ['Glasses', 'Transitions Double as Sunglasses', null],
    ['Credit card, cash, drivers license', '', 16],
    ['GoPro Tripod Mount 1/4"', 'Mount a gopro to 1/4" tripod thread', 23],
    ['Joy Walker Waterproof Backpack Rain Cover', '', 100],
    // a kind of thing, not a product
    ['Down jacket', '', 352],
    ['Toothbrush', '', 9],
    ['Sunscreen', '1oz Travel Size', 34],
    ['Trail running shoes', '', 737],
    ['Dry bag', '', 60],
    ['Trekking poles', 'generic Amazon 2 @ 5.6 = 11.2', 318],
    ['First aid', 'neosporin, tape', 45],
    ['Peanut butter jar', 'For soaking food', 54],
    // another brand's product
    ['Gaiters', 'Mountain Hardwear Scree', 62],
    ['Toothbrush', 'Litesmith', 5],
    ['Down Jacket', 'Dark Peak Nessh', 365],
    ['Head Net', "Coghlan's Mosquito Head Net", 17],
    ['Pillow', 'Cocoon AIR CORE Travel Pillow', 74],
    // the same line, but another size, version or garment
    ['Anker 20000 PowerCore II', 'Battery. 2x recharge speed', 385],
    ['Shoes', 'Altra Lone Peak 8 Size 13 2E', null],
    ['Garmin Fenix 3 watch', '', 82],
    ['Down Jacket', 'Goosefeet Gear. 3.5oz of 950 DownTek. 53% Fill.', 186],
    ['Camp Chair', 'Helinox Ground Chair', 626],
  ] as const)('%s | %s', (name, desc, w) => {
    expect(auto(name, desc, w)).toBeNull();
  });
});

describe('matchItem over every example list', () => {
  const dir = path.join(ROOT, 'data/examples/csv');
  const rows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .flatMap((f) => parseLighterPackCSV(fs.readFileSync(path.join(dir, f), 'utf8')).rows);

  it('scores stay within 0..1 and sorted', () => {
    for (const r of rows.slice(0, 400)) {
      const ms = matchItem(r.name, r.desc, r.weight_g || null, db);
      ms.forEach((m, i) => {
        expect(m.score).toBeGreaterThanOrEqual(0);
        expect(m.score).toBeLessThanOrEqual(1);
        if (i) expect(m.score).toBeLessThanOrEqual(ms[i - 1].score);
      });
    }
  });

  // A floor, not a target: it catches a change that quietly stops matching. Raising the share by
  // loosening the matcher is only a gain if the cases above still pass.
  it('still matches a useful share of rows automatically', () => {
    const n = rows.filter((r) => auto(r.name, r.desc, r.weight_g || null)).length;
    expect(n / rows.length).toBeGreaterThan(0.19);
  });
});
