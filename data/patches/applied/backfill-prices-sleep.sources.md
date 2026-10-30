# Sources for backfill-prices-sleep.json

- enlightened-equipment-convert-40f-850fp | price_usd | 405 | https://enlightenedequipment.com/convert-sleeping-quilt/ | "$405.00" (BigCommerce configurator price for 850FP / 40°F (5°C) / Regular / Regular / stock fabric "Navy 10D / Charcoal 10D", SKU CVT85040NCRR, out of stock; the other stock colour "Red 10D / Charcoal 10D" returns $415.00 but has no SKU for 40°F, so treated as non-existent combo. Page range "$360.00 - $795.00")
- exped-ultra-1r-m | price_usd | 139.95 | https://www.expedusa.com/products/ultra-1r-2026 | "M - $139.95"
- exped-ultra-1r-lw | price_usd | 139.95 | https://www.expedusa.com/products/ultra-1r-2026 | "LW - $139.95"
- exped-ultra-3r-lw | price_usd | 169.95 | https://www.expedusa.com/products/ultra-3r-2026 | "LW - $169.95" (2026 version on Exped USA)
- exped-ultra-6-5r-lw | price_usd | 199.95 | https://www.expedusa.com/products/ultra-6-5r | "LW - $199.95 - OUT OF STOCK" (list price shown though out of stock)
- exped-ultra-6-5r-mummy-lw | price_usd | 199.95 | https://www.expedusa.com/products/ultra-6-5r-mummy | "LW - $199.95"
- exped-ultra-8r-m | price_usd | 229.95 | https://www.expedusa.com/products/ultra-8r | "M - $229.95"
- exped-ultra-8r-mummy-m | price_usd | 229.95 | https://www.expedusa.com/products/ultra-8r-mummy | "M - $229.95"
- exped-ultra-10r-m | price_usd | 269.95 | https://www.expedusa.com/products/ultra-10r | "M - $269.95"
- exped-dura-6-5r-m | price_usd | 199.95 | https://www.expedusa.com/products/dura-6-5r | "M - $199.95"
- exped-flex-3r-m | price_usd | 59.95 | https://www.expedusa.com/products/flex-3r | "M - $59.95"
- exped-ultra-pillow-m | price_usd | 44.95 | https://www.expedusa.com/products/ultra-pillow-2026 | "M / Meadow - $44.95" (2026 version; same price both colours)
- exped-versaluxe-pillow | price_usd | 49.95 | https://www.expedusa.com/products/versaluxe-pillow | "Sunburst - $49.95 Ocean - $49.95 Greygoose - $49.95"

Exped note: exped.com (EU site) shows only CHF/EUR; Exped's US store is expedusa.com (Shopify, USD). No compare-at/strike-through prices on any of the variants above ("Regular price ... Sale price" identical).

## Not found
- nunatak-arc-ul-40f: custom quilt, nunatakusa.com returned 503; no current MSRP seen
- nunatak-arc-ul-30f: custom quilt, nunatakusa.com returned 503; no current MSRP seen
- nunatak-arc-ul-20f: custom quilt, nunatakusa.com returned 503; only an old review figure ($425, SectionHiker) found
- loco-libre-down-quilt-20f: composite custom product (from $380); per-configuration price not determinable from page
- rei-co-op-magma-trail-quilt-30: rei.com returns 403 to automated fetches; search snippet suggests $329.00 and BackpackingLight review says 2024 MSRP "$330", not verified on REI
- marmot-helium-15f: Regular size list price not on marmot.com (only Long $539); retailers disagree ($478.95 to $538.95)
- mountain-hardwear-phantom-30f: mountainhardwear.com 403; current version/colour ambiguous (retailers show $440 to $510 across sizes/generations)
- valandre-mirage: valandre.com now lists only "Mirage 3/4" rated -5°C/23°F ($460.00), not the 32°F Mirage in the DB; variant mismatch
- valandre-swing-500: not listed on valandre.com (range is now Swing CO 450/650/850); likely discontinued
- montbell-down-hugger-800-5: montbell.us lists "Down Hugger 800 #5 (Closeout)" (search snippet $229.00 list), page now 404 and model superseded by Seamless Down Hugger 800 #5; not verified
- naturehike-snowbird: several fill-weight versions, variant null; can't match one price
- aegismax-lightest-ultralight-down-sleeping-bag-48f: no official/maker listing for a 48°F "Lightest" bag found (Amazon/eBay only)
- exped-ultra-3r-s: Exped USA sells Ultra 3R in M/MW/LW only; S has no USD price (EU €190.00)
- exped-ultra-3r-mummy-lw: not listed on expedusa.com; no USD price found
- exped-dura-3r-m: not listed on expedusa.com; no USD price found
- exped-flex-1-5r-xs: expedusa.com sells Flex 1.5R in M and LW only ($44.95); XS not offered in USD
- exped-versa-1r-m: not listed on expedusa.com; no USD price found
- exped-versa-4-5r-m: only a used unit on expedusa.com ($49.97); new USD price not found (EU retailers only)
- rei-co-op-helix-insulated-air-regular: rei.com returns 403 to automated fetches; no other source
- exped-ultra-pillow-l: expedusa.com lists Ultra Pillow in M only
- exped-down-pillow-m: expedusa.com lists Down Pillow in L only ($79.95)

## Flags
- montbell-down-hugger-800-5: marked discontinued=false, but montbell.us lists it as Closeout and the current line is the Seamless Down Hugger 800 #5.
- valandre-mirage / valandre-swing-500: neither appears in Valandre's current range under that name (Mirage 3/4 at 23°F; Swing CO series); may be discontinued.
- exped-ultra-1r-*/ultra-3r-*/ultra-pillow-m: Exped USA lists these as 2026 versions (handles ultra-1r-2026, ultra-3r-2026, ultra-pillow-2026); specs in DB may be for the earlier version.
