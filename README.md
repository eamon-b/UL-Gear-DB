# UL Gear DB

An interactive database of ultralight backpacking gear, with a comparison view and a pack-list builder that improves on LighterPack.

- **Browse and compare**: pick a category, then filter by brand, type, weight, price, confidence, and spec filters generated from the data (numeric ranges, yes/no toggles, multi-selects). Sort by any column, including **g/$** (grams saved per extra dollar versus the cheapest item in view). A weight-vs-price scatter plot highlights the **Pareto frontier** (nothing lighter for less).
- **Third dimension**: most categories have a key spec besides weight and price (pack volume, quilt temp rating, pad R-value, shelter capacity, headlamp lumens, power bank Wh, puffy down fill, pot capacity, filter flow rate, stove boil time, and so on). Pick it with **Compare on**: the frontier becomes 3D (nothing lighter, cheaper *and* better on it), the scatter colors each dot by it, and you can switch the axes to it or to ratios like g per L and $ per lumen. Compare adds the metric, both ratios, and frontier membership. The choice is remembered per category. A metric is on by default only when at least 70% of the category's items have it (see [Coverage](#coverage)); sparser ones are still in the menu, with how many items have data. Items with no value for the metric keep their ★ if they are on the plain weight/price frontier. You can compare up to 6 items side by side, with the best value in each row highlighted.
- **Global search** across every category (press `/`). It knows brand nicknames ("HMG", "thermarest", "S2S"), kinds of gear the names don't spell out ("puffy", "bear can", "headtorch"), words written split or glued ("x mid", "neo air"), text specs ("dcf tarp"), and fixes typos when nothing matches as typed. The filter box inside a category uses the same matching.
- **Pack lists**: build multiple lists stored in localStorage. Add DB items or custom items, and set qty, worn, and consumable on each, editing inline. The list shows base, worn, consumable, pack, and skin-out totals, the cost, and a category donut.
  - **Alternatives**: opens the full browse view for an item's category, scoped to the item's own type (tent vs tents, not tarps) with a one-click **All shelters** toggle, plus deltas (±g, ±$, $/oz saved), quick chips, and one-click **Swap**.
  - **Lighten my pack**: a greedy plan by $ per gram saved, within a budget you set. By default it only suggests like-for-like swaps: same type, and comparable key specs (quilt temperature rating, pad R-value, shelter capacity, pack/pot/bottle volume, power bank capacity, bear-approved storage).
  - **Share via URL**: the whole list is compressed into the link with lz-string. The link opens a read-only view with "Copy to my lists".
  - **LighterPack CSV import/export**: matches rows to DB items, with a review screen to confirm. A row is matched automatically only when it names the product ("Tent | TT Aeon Li", "Houdini"); a bare "Toothbrush", another brand's product, or another size or version of the same line stays a custom item with the closest matches offered.
- **Example lists** (`#/examples`): 45 real gear lists that hikers have published on LighterPack (PCT, AT, CDT, Colorado Trail, Wind Rivers, SUL/XUL, winter, Europe, and more), with the article or forum thread each came from. Filter by trail, sort by weight, and import any of them through the CSV review.
- Light and dark themes (follows the OS, with a toggle), g/oz/lb units, and a phone-friendly layout. The site is fully static.

## Development

```bash
npm install
npm run dev        # builds data, then starts Vite on http://localhost:5173
npm run build      # builds data, type-checks, builds to dist/
npm run preview    # serves dist/ on http://localhost:4173
npm run data       # only (re)build public/data/gear.json + data/report.json
npm run check-data # data sanity report -> data/data-issues.json (add `-- --all` to print everything)
npm run coverage   # per-category price / weight / metric coverage -> the table in this README
npm run gaps       # gear that real pack lists carry and the database lacks, most-carried first
```

Smoke test (Playwright; needs a Chromium. Set `CHROMIUM_PATH` if it is not in `/opt/pw-browsers`):

```bash
npm run build && npx vite preview --port 4173 &
node scripts/smoke-test.mjs http://localhost:4173/
```

Screenshots go to `screenshots/`.

Unit tests (Vitest) cover the LighterPack CSV import pipeline (parsing, review, list items, totals, export round trips), search, and the row matcher. `tests/match.test.ts` holds rows as hikers really write them: ones that must match a given item and ones that must be left alone. They also run every example list through the import and check the result against the registry:

```bash
npm test           # builds data, then runs vitest
```

## Data

```
data/categories.json        categories, groups, and allowed subcategories (the contract)
data/SCHEMA.md              item schema and recommended spec keys per category
data/raw/<category>.json    one JSON array of items per category
data/raw/_sample.json       dev fixture: used only when no other raw file has valid items
data/aliases.json           old id -> current id, so saved/shared lists survive merged duplicates
data/report.json            validation report from the last data build
data/data-issues.json       likely-bad records from `npm run check-data` (outliers, dupes, shipping weights, …)
public/data/gear.json       compact bundle the app loads (generated, git-ignored)
data/examples/sources.json  published LighterPack lists: id, author, trail, year, season, source page
data/examples/csv/<id>.csv  snapshot of each list (LighterPack's own CSV export)
data/examples/registry.json sources + list title and computed weights (generated by fetch-examples)
public/data/examples.json   example lists bundle the app loads (generated, git-ignored)
```

### Coverage

How many items in each category have a price, a weight, and a value for the category's third-dimension metric (defined in `src/lib/metric.ts`). **Bold** cells are under 70%, the bar a metric has to clear to be on by default. Filling these gaps is the most useful data contribution.

<!-- coverage:start -->
| Category | Items | Price | Weight | 3rd metric | With metric | Default |
|---|--:|--:|--:|---|--:|---|
| Shelters | 386 | 353 (91%) | 386 (100%) | Capacity (person) | 386 (100%) | on |
| Backpacks | 258 | 256 (99%) | 258 (100%) | Volume (L) | 258 (100%) | on |
| Quilts & Sleeping Bags | 238 | 211 (88%) | 238 (100%) | Temp rating (°F) | 237 (99%) | on |
| Sleeping Pads | 136 | 121 (88%) | 136 (100%) | R-value | 135 (99%) | on |
| Pillows | 36 | 34 (94%) | 36 (100%) | – | – | – |
| Stoves | 103 | 97 (94%) | 103 (100%) | Boil time (min/L) | **52 (50%)** | off |
| Cookware | 105 | 96 (91%) | 105 (100%) | Capacity (ml) | 101 (96%) | on |
| Cook Accessories | 93 | 85 (91%) | 93 (100%) | – | – | – |
| Water Treatment | 62 | 58 (93%) | 62 (100%) | Flow rate (L/min) | **38 (61%)** | off |
| Water Storage | 63 | 55 (87%) | 63 (100%) | Capacity (L) | 63 (100%) | on |
| Rain Jackets | 102 | 99 (97%) | 102 (100%) | Waterproofing (mm) | **44 (43%)** | off |
| Rain Pants | 67 | 64 (95%) | 67 (100%) | Waterproofing (mm) | **35 (52%)** | off |
| Wind Layers | 59 | 56 (94%) | 59 (100%) | – | – | – |
| Insulated Layers | 209 | 204 (97%) | 209 (100%) | Down fill (g) | **45 (21%)** | off |
| Base Layers & Hiking Clothing | 205 | 203 (99%) | 205 (100%) | Fabric weight (gsm) | **124 (60%)** | off |
| Hats & Gloves | 140 | 140 (100%) | 140 (100%) | – | – | – |
| Footwear | 285 | 284 (99%) | 285 (100%) | – | – | – |
| Headlamps & Lights | 83 | 79 (95%) | 83 (100%) | Brightness (lm) | 83 (100%) | on |
| Power Banks & Charging | 55 | 55 (100%) | 55 (100%) | Energy (Wh) | **34 (61%)** | off |
| Satellite & Navigation | 41 | 38 (92%) | 41 (100%) | – | – | – |
| Trekking Poles | 86 | 85 (98%) | 86 (100%) | Collapsed (in) | 85 (98%) | on |
| Food Storage & Bear Protection | 53 | 53 (100%) | 53 (100%) | Volume (L) | 38 (71%) | on |
| Stuff Sacks & Pack Liners | 166 | 163 (98%) | 166 (100%) | Volume (L) | **114 (68%)** | off |
| First Aid, Hygiene & Tools | 88 | 86 (97%) | 88 (100%) | – | – | – |
| Camp Comfort & Misc | 89 | 84 (94%) | 89 (100%) | – | – | – |
| **All** | **3208** | **3059 (95%)** | **3208 (100%)** | | **1872 (78%)** | |
<!-- coverage:end -->

`npm run coverage` regenerates the table. CI fails if it is out of date, so a PR that changes the data shows its effect on coverage in the README diff, and the table is also in each CI run's summary.

### Example lists

To add a published list, append an entry to `data/examples/sources.json` with its LighterPack id (the part after `lighterpack.com/r/`) and the page where it was published. Then run `npm run fetch-examples`, which needs network access. It downloads lists that have no snapshot yet; `-- --all` refreshes every snapshot, and `-- --offline` only recomputes `registry.json`. Run `npm test` afterwards. Lists belong to their authors: credit them, and only add lists that were shared publicly.

`scripts/build-data.mjs` validates every raw file:

- ids must be unique across all files. Duplicates get a `-2`, `-3` suffix and a warning, and identical brand+model+variant entries are flagged.
- The category must be valid (it is inferred from the file name if missing or invalid). The subcategory must belong to that category: case slips and near misses are mapped to the closest match, and anything else goes to `other`, or to the closest match when the category has no `other`.
- `brand` and `model` are required. `weight_g` must be a positive number: strings are coerced and values are rounded to integers. `price_usd` must be a number or `null`, and strings like `"$199"` are parsed.
- Strings are trimmed, numeric or boolean strings in `specs` are converted, and enums get defaults.
- Items that can't be fixed are dropped and listed in the report.

### Finding what is missing

`npm run gaps` runs every row of every example list through the import matcher and groups the ones it cannot match, ranked by how many different lists carry them. The first table is products from brands the database already has (the best candidates to add), with the closest existing item when there is one, which often means an older version or a nickname the matcher should learn. The second is everything else that turns up in two or more lists. Pass your own LighterPack exports as extra arguments, `--all` for every group, or `--json` for scripting.

This is the quickest way to find gear worth adding: it starts from what people carry, not from what a brand's catalogue lists.

### Contributing data

1. Edit or add items in `data/raw/<category>.json`, following `data/SCHEMA.md`. Each item needs a source `url` and an honest `confidence` (`high` means checked against a source).
2. Run `npm run data` and read the console report and `data/report.json`. There should be no dropped items or duplicate ids. Then run `npm run check-data` and look at anything it flags for your records.
   When you remove a duplicate or rename an id, add `"old-id": "new-id"` to `data/aliases.json`.
   Then run `npm run coverage` to update the [coverage table](#coverage) (CI checks it is current).
   Put what distinguishes one size or build from another in `variant`, not `model` (`"model": "LT5", "variant": "Three Piece Carbon"`): search and the CSV import weigh the model words most.
3. Open a PR and link your sources. Measured weights are welcome: use `"weight_basis": "measured"` and describe what was weighed in `weight_note`.

Weights are manufacturer claims unless marked otherwise. Prices are USD list prices and go stale.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. In the repo settings, go to **Pages** and set **Source** to **GitHub Actions**.

The app uses `base: './'` and hash routing (`#/c/shelter`, `#/lists`, `#/share/…`), so it works under any subpath such as `https://<user>.github.io/<repo>/` with no configuration. To use absolute asset URLs instead, build with `VITE_BASE=/<repo>/ npm run build`.

## Tech

Vite, React 18, and TypeScript, with plain CSS (theme tokens on `:root`). The scatter plot and donut are hand-written SVG. Dependencies: `lz-string` (share links) and `papaparse` (CSV). There is no router library: a 40-line hash router lives in `src/lib/router.ts`. Search and the CSV import matcher share one text layer (`src/lib/text.ts`: normalisation, brand nicknames, the kinds-of-gear lexicon) and one index (`src/lib/gearIndex.ts`), with no search library.
