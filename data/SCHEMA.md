# Gear item schema

Each file in `data/raw/<category-id>.json` is a JSON array of items:

```json
{
  "id": "zpacks-duplex",              // kebab-case, unique: brand-model[-variant]
  "category": "shelter",              // id from data/categories.json
  "subcategory": "trekking-pole tent",// one of that category's subcategories
  "brand": "Zpacks",
  "model": "Duplex",
  "variant": null,                    // e.g. "Regular", "20°F", "Men's", "40L" — null if none
  "weight_g": 539,                    // manufacturer-listed weight in grams (integer). Required.
  "weight_basis": "manufacturer",     // "manufacturer" | "measured" | "estimate"
  "weight_note": "body + guylines, no stakes", // what the weight includes, if known
  "price_usd": 699,                   // current list price / MSRP in USD (number). null if unknown.
  "specs": { "capacity": 2, "doors": 2, "material": "DCF" }, // category-specific, see below
  "url": "https://zpacks.com/products/duplex-tent", // manufacturer product page when possible
  "discontinued": false,
  "confidence": "high",               // "high" = checked against a source this session; "medium" = recalled, believed current; "low" = uncertain
  "notes": null
}
```

Weight conversions: 1 oz = 28.3495 g. Round to integer grams.
One entry per meaningfully different variant (e.g. quilt temperature ratings, pad sizes when weight differs a lot); don't explode every color.

## Recommended spec keys per category (use what applies; numbers as numbers)
- shelter: capacity (people), doors, walls ("single"|"double"), material, freestanding (bool), poles ("trekking"|"dedicated"|"none"), packed_size
- backpack: volume_l, frame ("frameless"|"framesheet"|"internal"), max_load_lb, material, hipbelt (bool), torso_sizes
- sleep-insulation: temp_rating_f, fill ("down"|"synthetic"), fill_power, fill_weight_g, style
- sleeping-pad: r_value, length_in, width_in, thickness_in, shape
- pillow: inflated_size
- stove: fuel, output_btu, boil_time_min, piezo (bool)
- cookware: capacity_ml, material
- water-treatment: flow_rate_lpm, pore_size_micron, removes_viruses (bool), lifespan_l
- water-storage: capacity_l, collapsible (bool)
- rain-jacket / rain-pants / wind-layer: material, waterproof_rating_mm, breathability, pit_zips (bool), hood (bool)
- insulation: fill ("down"|"synthetic"|"fleece"), fill_power, fill_weight_g, hood (bool)
- base-layer: material, gsm, gender
- footwear: drop_mm, stack_mm, waterproof (bool), gender (weight per pair for shoes, per pair for socks)
- lighting: lumens, battery, runtime_hr, rechargeable (bool)
- power: capacity_mah, capacity_wh (when the maker states it; otherwise the app derives Wh from mAh at 3.7 V), output_w, ports
- communication: network, two_way (bool), subscription (bool), battery_life
- trekking-poles: material, adjustable (bool), collapsed_length_in, locking (weight is per PAIR)
- food-storage: volume_l, approved (e.g. "IGBC", "SIBBG")
- pack-organization: volume_l, material, waterproof (bool)

The app's "third dimension" per category (`src/lib/metric.ts`) reads these keys, so fill them where you can: backpack volume_l, sleep-insulation temp_rating_f, sleeping-pad r_value, shelter capacity, lighting lumens, power capacity_wh/capacity_mah, insulation fill_weight_g (down), cookware capacity_ml, water-storage capacity_l, water-treatment flow_rate_lpm, stove boil_time_min.
