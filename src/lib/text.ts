/**
 * Text normalisation shared by global search, the in-category filter and the
 * LighterPack import matcher, so "Thermarest X-Lite", "HMG" and "neo air xlite"
 * mean the same thing everywhere.
 */

/** How much of what people write should be read as something else. */
export type Reading =
  /** database fields: already canonical, take them as written */
  | 'exact'
  /** search queries: abbreviations and misspellings ("HMG", "thermarest") */
  | 'query'
  /** pack-list rows: also the short names hikers use for a brand or model ("Hyperlite", "the Deuce") */
  | 'row';

/** Abbreviations and misspellings of a brand -> the brand as the database spells it (lower-cased). */
const NICKNAMES: [RegExp, string][] = [
  [/\bthermarest\b|\btherm a rest\b|\btherma rest\b/g, 'therm-a-rest'],
  [/\bz ?packs?\b|\bz-packs?\b/g, 'zpacks'],
  [/\bhmg\b/g, 'hyperlite mountain gear'],
  [/\bmld\b/g, 'mountain laurel designs'],
  [/\bsmd\b/g, 'six moon designs'],
  [/\bswd\b/g, 'superior wilderness designs'],
  [/\bs2s\b|\bsts\b|\bsea ?2 ?summit\b/g, 'sea to summit'],
  [/\btt\b|\btarp tent\b/g, 'tarptent'],
  [/\bgg\b/g, 'gossamer gear'],
  [/\bee\b/g, 'enlightened equipment'],
  [/\bwm\b/g, 'western mountaineering'],
  [/\bff\b/g, 'feathered friends'],
  [/\bbd\b/g, 'black diamond'],
  [/\bba\b/g, 'big agnes'],
  [/\bmh\b|\bmtn hardwear\b|\bmountain hardware\b/g, 'mountain hardwear'],
  [/\btnf\b/g, 'the north face'],
  [/\bmont-bell\b|\bmont bell\b|\bmontbelle?\b/g, 'montbell'],
  [/\bsnowpeak\b/g, 'snow peak'],
  [/\bpetzel\b|\bpetzyl\b/g, 'petzl'],
  [/\bkatoohla\b|\bkathoola\b|\bkatoola\b/g, 'kahtoola'],
  [/\barc teryx\b/g, 'arcteryx'],
  [/\bsmart ?water\b/g, 'smartwater'],
  [/\bbear ?vault\b/g, 'bearvault'],
  [/\bdarntough\b/g, 'darn tough'],
  [/\bex officio\b/g, 'exofficio'],
  [/\bnite ?core\b/g, 'nitecore'],
  [/\bhammockgear\b/g, 'hammock gear'],
  [/\bduece\b/g, 'deuce'],
  [/\bin[- ]reach\b/g, 'inreach'],
];
/**
 * Part of a name standing for the whole. Fine for reading a pack list, where the whole brand has to
 * be recognised; a search just matches the word, and "hennessy hyperlite" must still find the hammock.
 */
const SHORT_NAMES: [RegExp, string][] = [
  [/\bhyperlite(?! mountain)\b/g, 'hyperlite mountain gear'],
  [/\bmountain laurel(?! designs)\b/g, 'mountain laurel designs'],
  [/\bsix moons?(?! designs)\b/g, 'six moon designs'],
  [/\bgossamer(?! gear)\b/g, 'gossamer gear'],
  [/\benlightened(?! equipment)\b/g, 'enlightened equipment'],
  [/\bnorth face\b/g, 'the north face'],
  [/\bula(?! equipment)\b/g, 'ula equipment'],
  [/\bkatabatic(?! gear)\b/g, 'katabatic gear'],
  [/\byama(?! mountain)\b/g, 'yama mountain gear'],
  [/\brei(?! co-?op)\b/g, 'rei co-op'],
  [/\bgsi(?! outdoors)\b/g, 'gsi outdoors'],
  [/\bsenchi(?! designs)\b/g, 'senchi designs'],
  [/\bwarbonnet(?! outdoors)\b/g, 'warbonnet outdoors'],
  [/\bugq(?! outdoor)\b/g, 'ugq outdoor'],
  [/\bhilltop(?! packs)\b/g, 'hilltop packs'],
  [/\bdeuce(?! of spades)\b/g, 'deuce of spades'],
];
/** Two-letter brand codes that are also English words: only when written in capitals. */
const CASED_ALIASES: [RegExp, string][] = [
  [/\bOR\b/g, 'outdoor research'],
  [/\bME\b/g, 'mountain equipment'],
];

/** Spellings of the same model word. Applied to both sides, so only consistency matters. */
const WORD_FIXES: [RegExp, string][] = [
  [/light\b/g, 'lite'], // uberlight / uberlite, xlight / xlite
  [/\bultra[ -]?lite\b/g, 'ul'],
  [/\bbivvy\b/g, 'bivy'],
  [/\bti\b/g, 'titanium'],
  [/\bcannister\b/g, 'canister'],
  [/\bmittens?\b/g, 'mitt'],
  [/\bhoodie\b/g, 'hoody'],
  [/\bmens\b|\bmen\b|\bmale\b/g, 'mens'],
  [/\bwomens\b|\bwomen\b|\bfemale\b|\bladies\b/g, 'womens'],
];

const STOP = new Set(
  'the and with for a an of in on by to my new old w is it as at or from this that also not no use used using plus inc incl including'.split(
    ' ',
  ),
);

/** Lower-case, strip accents and apostrophes, unify units, and read nicknames as `reading` says. */
export function normalize(raw: string, reading: Reading = 'row'): string {
  let s = raw;
  if (reading !== 'exact') for (const [re, to] of CASED_ALIASES) s = s.replace(re, to);
  s = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/°/g, ' ').replace(/&/g, ' and ');
  if (reading !== 'exact') for (const [re, to] of NICKNAMES) s = s.replace(re, to);
  if (reading === 'row') for (const [re, to] of SHORT_NAMES) s = s.replace(re, to);
  s = s
    // prices and percentages are never part of a product name
    .replace(/\$ ?\d+(\.\d+)?|\d+(\.\d+)? ?[$%]/g, ' ')
    // nor are quantities: "(8x)", "x5", "2x stakes" (but "Fenix 6X Pro" is a model)
    .replace(/\(\d{1,2} ?x\)|^\d{1,2} ?x\s|(^|\s)x ?\d{1,2}(?=[\s),.]|$)/g, ' ')
    // one spelling for volumes: "0.6L", "600 ml", "1 litre" -> "600ml", "1000ml". Pack sizes ("40L") keep the bare number.
    .replace(/(\d+(?:\.\d+)?) ?(ml|milliliters?|millilitres?)\b/g, (_, n) => ` ${Math.round(+n)}ml `)
    .replace(/(\d+(?:\.\d+)?) ?(l|lt|liters?|litres?)\b/g, (_, n) => (+n <= 10 ? ` ${Math.round(+n * 1000)}ml ` : ` ${n} `));
  return s;
}

/**
 * Normalised word tokens. Letters and digits are split ("nu25" -> "nu", "25") and decimals kept ("3.5").
 * Single letters stay ("x", "mid"): on their own they say little, but joins() turns them back into "xmid".
 */
export function tokenize(raw: string, reading: Reading = 'row'): string[] {
  let s = normalize(raw, reading)
    .replace(/(\d)ml\b/g, '$1\u0001') // keep "600ml" whole through the letter/digit split
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\u0001/g, 'ml');
  for (const [re, to] of WORD_FIXES) s = s.replace(re, to);
  return (
    s
      .split(/[^a-z0-9.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ''))
      .filter((t) => t && !STOP.has(t))
      // plurals: "poles" / "pole", "Dirty Girls" / "Dirty Girl". Applied to both sides, so "zpack" is fine.
      .map((t) => (t.length > 3 && /[a-z]s$/.test(t) && !t.endsWith('ss') ? t.slice(0, -1) : t))
  );
}

export const isNumeric = (t: string) => /^\d+(\.\d+)?(ml)?$/.test(t);

/** Adjacent tokens glued together, so "x mid" finds "xmid" and "neo air" finds "neoair". */
export function joins(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) {
    if (!isNumeric(toks[i]) || !isNumeric(toks[i + 1])) out.push(toks[i] + toks[i + 1]);
  }
  return out;
}

/** Edit distance, capped: returns max + 1 as soon as the distance is known to exceed max. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev[j - 2] + 1); // close enough to a transposition
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * What hikers call a kind of gear -> where the database files it. Used to read the type out of
 * a list row ("Puffy | ...", "Pack | ...") and to let search understand "puffy" or "bear can".
 * `sub` narrows to subcategories when the word is that specific.
 */
export interface GearType {
  cats: string[];
  subs?: string[];
}
const T = (cats: string, subs?: string): GearType => ({ cats: cats.split(','), ...(subs ? { subs: subs.split(',') } : {}) });
const TYPE_PHRASES: [string, GearType][] = [
  ['tent', T('shelter', 'trekking-pole tent,freestanding tent,semi-freestanding tent,pyramid')],
  ['shelter', T('shelter')],
  ['tarp', T('shelter', 'tarp')],
  ['bivy', T('shelter', 'bivy')],
  ['hammock', T('shelter', 'hammock')],
  ['pack', T('backpack')],
  ['backpack', T('backpack')],
  ['rucksack', T('backpack')],
  ['daypack', T('backpack', 'daypack/fastpack')],
  ['fastpack', T('backpack', 'daypack/fastpack')],
  ['quilt', T('sleep-insulation', 'quilt,top quilt (hammock),underquilt')],
  ['underquilt', T('sleep-insulation', 'underquilt')],
  ['sleeping bag', T('sleep-insulation', 'sleeping bag,hoodless bag')],
  ['sleep bag', T('sleep-insulation', 'sleeping bag,hoodless bag')],
  ['sleeping pad', T('sleeping-pad')],
  ['sleep pad', T('sleeping-pad')],
  ['pad', T('sleeping-pad')],
  ['mat', T('sleeping-pad')],
  ['mattress', T('sleeping-pad')],
  ['ccf', T('sleeping-pad', 'closed-cell foam')],
  ['pillow', T('pillow')],
  ['stove', T('stove')],
  ['burner', T('stove')],
  ['pot', T('cookware', 'pot,pot set')],
  ['cookpot', T('cookware', 'pot,pot set')],
  ['mug', T('cookware', 'mug')],
  ['cup', T('cookware', 'mug')],
  ['kettle', T('cookware', 'kettle')],
  ['pan', T('cookware', 'pan')],
  ['spoon', T('cook-accessory', 'utensil')],
  ['spork', T('cook-accessory', 'utensil')],
  ['utensil', T('cook-accessory', 'utensil')],
  ['lighter', T('cook-accessory', 'lighter')],
  ['windscreen', T('cook-accessory', 'windscreen')],
  ['cozy', T('cook-accessory', 'cozy')],
  ['cold soak', T('cook-accessory', 'cold-soak jar')],
  ['filter', T('water-treatment')],
  ['water filter', T('water-treatment')],
  ['purifier', T('water-treatment')],
  ['water treatment', T('water-treatment')],
  ['bottle', T('water-storage', 'bottle,soft bottle')],
  ['water bottle', T('water-storage', 'bottle,soft bottle')],
  ['flask', T('water-storage', 'soft bottle')],
  ['bladder', T('water-storage', 'reservoir/bladder,dirty water bag')],
  ['reservoir', T('water-storage', 'reservoir/bladder')],
  ['rain jacket', T('rain-jacket', 'rain jacket')],
  ['rain shell', T('rain-jacket', 'rain jacket')],
  ['rain coat', T('rain-jacket', 'rain jacket')],
  ['raincoat', T('rain-jacket', 'rain jacket')],
  ['hardshell', T('rain-jacket', 'rain jacket')],
  ['shell', T('rain-jacket,wind-layer')],
  ['poncho', T('rain-jacket', 'poncho')],
  ['rain kilt', T('rain-jacket', 'rain kilt/skirt')],
  ['rain skirt', T('rain-jacket', 'rain kilt/skirt')],
  ['rain pant', T('rain-pants')],
  ['rain trousers', T('rain-pants')],
  ['wind jacket', T('wind-layer', 'wind jacket')],
  ['wind shirt', T('wind-layer', 'wind jacket')],
  ['windshirt', T('wind-layer', 'wind jacket')],
  ['windbreaker', T('wind-layer', 'wind jacket')],
  ['wind shell', T('wind-layer', 'wind jacket')],
  ['wind pant', T('wind-layer', 'wind pants')],
  ['puffy', T('insulation', 'down jacket,synthetic jacket')],
  ['puffer', T('insulation', 'down jacket,synthetic jacket')],
  ['down jacket', T('insulation', 'down jacket')],
  ['down hoody', T('insulation', 'down jacket')],
  ['insulated jacket', T('insulation', 'down jacket,synthetic jacket')],
  ['fleece', T('insulation', 'fleece,active insulation')],
  ['midlayer', T('insulation')],
  ['mid layer', T('insulation')],
  ['vest', T('insulation,wind-layer', 'vest,wind vest')],
  ['booties', T('insulation', 'booties/socks')],
  ['base layer', T('base-layer')],
  ['baselayer', T('base-layer')],
  ['sun hoody', T('base-layer', 'sun hoody')],
  ['sun shirt', T('base-layer', 'sun hoody,hiking shirt')],
  ['shirt', T('base-layer')],
  ['tshirt', T('base-layer')],
  ['short', T('base-layer', 'hiking shorts')],
  ['pant', T('base-layer,rain-pants,wind-layer')],
  ['trousers', T('base-layer', 'hiking pants')],
  ['leggings', T('base-layer', 'base bottom')],
  ['tights', T('base-layer', 'base bottom')],
  ['underwear', T('base-layer', 'underwear')],
  ['boxers', T('base-layer', 'underwear')],
  ['briefs', T('base-layer', 'underwear')],
  ['bra', T('base-layer', 'underwear')],
  ['hat', T('headwear-handwear', 'sun hat,beanie')],
  ['cap', T('headwear-handwear', 'sun hat')],
  ['beanie', T('headwear-handwear', 'beanie')],
  ['balaclava', T('headwear-handwear', 'balaclava')],
  ['buff', T('headwear-handwear', 'neck gaiter')],
  ['neck gaiter', T('headwear-handwear', 'neck gaiter')],
  ['glove', T('headwear-handwear', 'liner glove,insulated glove/mitt,rain mitt')],
  ['mitt', T('headwear-handwear', 'insulated glove/mitt,rain mitt')],
  ['shoes', T('footwear', 'trail runner,hiking shoe')],
  ['trail runners', T('footwear', 'trail runner')],
  ['runners', T('footwear', 'trail runner')],
  ['boots', T('footwear', 'hiking boot')],
  ['sandals', T('footwear', 'camp shoe/sandal')],
  ['camp shoes', T('footwear', 'camp shoe/sandal')],
  ['sock', T('footwear', 'sock')],
  ['gaiter', T('footwear', 'gaiter')],
  ['microspikes', T('footwear', 'traction')],
  ['spikes', T('footwear', 'traction')],
  ['crampons', T('footwear', 'traction')],
  ['headlamp', T('lighting', 'headlamp')],
  ['headtorch', T('lighting', 'headlamp')],
  ['head torch', T('lighting', 'headlamp')],
  ['torch', T('lighting')],
  ['flashlite', T('lighting', 'flashlight')],
  ['lantern', T('lighting', 'lantern')],
  ['power bank', T('power', 'power bank')],
  ['powerbank', T('power', 'power bank')],
  ['battery', T('power', 'power bank')],
  ['battery pack', T('power', 'power bank')],
  ['charger', T('power', 'charger/cable')],
  ['cable', T('power', 'charger/cable')],
  ['solar', T('power', 'solar panel')],
  ['plb', T('communication', 'PLB')],
  ['beacon', T('communication', 'PLB,satellite messenger')],
  ['messenger', T('communication', 'satellite messenger')],
  ['inreach', T('communication', 'satellite messenger')],
  ['gps', T('communication')],
  ['watch', T('communication', 'watch')],
  ['trekking pole', T('trekking-poles')],
  ['hiking pole', T('trekking-poles')],
  ['pole', T('trekking-poles')],
  ['bear can', T('food-storage', 'bear canister')],
  ['bear canister', T('food-storage', 'bear canister')],
  ['bear bag', T('food-storage', 'bear bag')],
  ['food bag', T('food-storage,pack-organization', 'bear bag,odor-proof bag,stuff sack')],
  ['bear spray', T('food-storage', 'bear spray')],
  ['stuff sack', T('pack-organization', 'stuff sack')],
  ['stuffsack', T('pack-organization', 'stuff sack')],
  ['dry bag', T('pack-organization', 'dry bag')],
  ['drybag', T('pack-organization', 'dry bag')],
  ['dry sack', T('pack-organization', 'dry bag')],
  ['pack liner', T('pack-organization', 'pack liner')],
  ['liner', T('pack-organization', 'pack liner')],
  ['pack cover', T('pack-organization', 'pack cover')],
  ['rain cover', T('pack-organization', 'pack cover')],
  ['fanny pack', T('pack-organization', 'pouch/fanny pack')],
  ['hip pack', T('pack-organization', 'pouch/fanny pack')],
  ['pouch', T('pack-organization', 'pouch/fanny pack,shoulder pouch')],
  ['first aid', T('first-aid-hygiene', 'first aid kit,first aid supply')],
  ['trowel', T('first-aid-hygiene', 'trowel')],
  ['toothbrush', T('first-aid-hygiene', 'toiletry')],
  ['toothpaste', T('first-aid-hygiene', 'toiletry')],
  ['soap', T('first-aid-hygiene', 'toiletry')],
  ['towel', T('first-aid-hygiene', 'toiletry')],
  ['knife', T('first-aid-hygiene', 'knife/multitool')],
  ['multitool', T('first-aid-hygiene', 'knife/multitool')],
  ['scissors', T('first-aid-hygiene', 'knife/multitool')],
  ['repair', T('first-aid-hygiene', 'repair')],
  ['sunscreen', T('first-aid-hygiene', 'sun/bug protection')],
  ['bug spray', T('first-aid-hygiene', 'sun/bug protection')],
  ['repellent', T('first-aid-hygiene', 'sun/bug protection')],
  ['umbrella', T('misc', 'umbrella')],
  ['chair', T('misc', 'chair')],
  ['sit pad', T('misc', 'sit pad')],
  ['groundsheet', T('misc', 'ground sheet')],
  ['ground sheet', T('misc', 'ground sheet')],
  ['footprint', T('misc', 'ground sheet')],
  ['ground cloth', T('misc', 'ground sheet')],
  ['stake', T('misc', 'stakes')],
  ['peg', T('misc', 'stakes')],
];

/** Lexicon keyed by its normalised token sequence ("trekking poles" -> "trekking pole"). */
const TYPES = new Map<string, GearType>();
/** Every word that appears in a type phrase: these name a kind of gear, never one product. */
export const TYPE_WORDS = new Set<string>();
let maxTypeLen = 1;
for (const [phrase, type] of TYPE_PHRASES) {
  const toks = tokenize(phrase);
  TYPES.set(toks.join(' '), type);
  toks.forEach((t) => TYPE_WORDS.add(t));
  maxTypeLen = Math.max(maxTypeLen, toks.length);
}
for (const w of tokenize('jacket hoody parka pullover top bottom bag sack kit set system gear')) TYPE_WORDS.add(w);
/** Words that say which kind ("rain" mitts, "down" jacket): part of naming the type, and never implied. */
export const MODIFIER_WORDS = new Set(
  tokenize('water rain wind sun down bear food dry trail hiking camp sleeping sleep titanium carbon fleece first cold'),
);
for (const w of MODIFIER_WORDS) TYPE_WORDS.add(w);

/**
 * Everyday words that turn up in product names. Even when only one brand in the database
 * happens to use one ("balm", "guide"), it does not identify that brand's product.
 */
export const COMMON_WORDS = new Set(
  tokenize(
    `lip balm guide book map compass whistle cloth net head mosquito bug insect trash compactor garbage ziploc zip lock jar
     peanut butter powdered powder paste tablets tabs drops cream gel lotion stick spray wipes tissue paper toilet hand sanitizer
     adapter usb micro lightning plug wall cord phone case camera tripod mount key keys wallet card cards money knife blade tool
     tape patch needle thread sewing pin pins safety cord line rope string strap straps clip carabiner buckle band elastic
     mini small medium large regular long wide short big little tiny double single solo duo pro plus max air ultra super classic
     original standard basic essential everyday travel pocket folding compact portable universal multi all
     black white red blue green orange yellow grey gray
     mesh foam fleece wool merino cotton nylon silnylon dyneema cuben poly polyester alpha grid
     summer winter season alpine mountain river lake summit peak ridge storm sky sun moon star cloud fire ice snow
     kitchen cook cooking camp camping hiker hiking trail backpacking outdoor medical emergency survival repair
     softshell hardshell glasses sunglasses headphones earbuds notebook pen pencil journal permit passport thermometer button soak soaking
     bottle cap lid cup bowl plate fork handle sleeve cover case holder pocket liner fuel gas canister tank`,
  ),
);
/** Words that qualify a product without naming a different one (sizes, fits, "UL"). */
export const FILLER_WORDS = new Set(
  tokenize('ul size small medium large regular long wide short mens womens unisex xs sm md lg xl xxl pair'),
);
/** Everyday words that do tell two models of a line apart: the Duplex is not the Duplex Pro. */
export const QUALIFIER_WORDS = new Set(
  tokenize(
    'pro plus max air ultra super lite elite solo duo mini micro nano alpine summit insulated trail lightweight midweight heavyweight',
  ),
);
/** ...and ones that only mean "the plain one". */
export const NEUTRAL_WORDS = new Set(tokenize('classic original standard'));

/** Garment words that exclude each other: a top is not a bottom, a jacket is not pants. */
const KIND_GROUPS = [
  'top crew shirt tshirt tee hoody jacket parka anorak pullover',
  'bottom pant tight legging short kilt skirt',
  'vest',
  'mitt glove',
  'sock bootie',
].map((g) => new Set(tokenize(g)));
/** Indexes of the garment groups a token list names. */
export function kindsOf(toks: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of toks) KIND_GROUPS.forEach((g, i) => g.has(t) && out.add(i));
  return out;
}

export interface TypeHit extends GearType {
  /** index of the first token and number of tokens the phrase covers */
  at: number;
  len: number;
}

/** Gear types named in a token list, longest phrase first ("rain jacket" wins over "jacket"). */
export function findTypes(toks: string[]): TypeHit[] {
  const out: TypeHit[] = [];
  for (let i = 0; i < toks.length; ) {
    let hit: TypeHit | null = null;
    for (let n = Math.min(maxTypeLen, toks.length - i); n >= 1 && !hit; n--) {
      const t = TYPES.get(toks.slice(i, i + n).join(' '));
      if (t) hit = { ...t, at: i, len: n };
    }
    if (hit) {
      out.push(hit);
      i += hit.len;
    } else i++;
  }
  return out;
}
