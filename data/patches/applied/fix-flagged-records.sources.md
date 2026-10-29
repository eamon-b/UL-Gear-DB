# Sources for fix-flagged-records.json

Corrections to existing records flagged during the 2026-10-29 coverage backfill (see the `## Flags`
sections of the `backfill-*.sources.md` files).

## Notes made stale by the backfill
The backfill filled `price_usd` on these, but their notes still said the price was unknown. The new
notes say where the price came from; the evidence is in the backfill-prices-*.sources.md lines.
- atom-packs-* (8) | notes | maker's USD storefront | https://atompacks.co.uk/products/the-pulse-ep40?country=US | product JSON "price": 29500 (re-checked 2026-10-29)
- northern-ultralight-sundown-48, -dreamline | notes | bases C$420 / C$636 | https://www.northernultralight.com/store/sundown | per backfill-prices-shelter-pack: C$506 / C$722 include the hipbelt-pocket bundle
- liteway-* (5) | notes, url | liteway.equipment | https://liteway.equipment/ | the brand's current store (liteway.store is gone); URLs from backfill-prices-shelter-pack
- locus-gear-* (9), nordisk-telemark-2-2-lw, euroschirm-light-trek-ultra | notes | conversion rate recorded | ECB reference rates 2026-10-28
- exped-* (10) | notes | expedusa.com | https://expedusa.com/ | Exped's US Shopify store, USD prices
- litesmith-cold-soaking-jar-medium/-x-large, patagonia-down-sweater-womens, packtowl-personal-towel-hand, montbell-wind-blast-vest-mens | notes | dropped "price not found" clause
- osprey-ultralight-raincover-medium | notes | removed the self-contradicting "weight recalled, not verified" clause (the note already said the weight was verified)

## Wrong or stale facts
- outdoor-research-transcendent-down-hoodie-mens | notes | fill_power 800 confirmed | https://www.outdoorresearch.com/products/mens-transcendent-down-hoodie-322081 | "responsibly sourced 800+ fill power down" (note said "recalled (650), not checked")
- montane-minimus-nano-pull-on-waterproof-pants | material | PETRICHOR 2.5L | https://us.montane.com/products/montane-unisex-minimus-nano-pull-over-waterproof-pants | "PETRICHOR 2.5-layer" PU laminate, tricot face, 15,000mm (was "Pertex Shield nano-weight 2.5L"; the old /en-us/ url 404s). Some retailers still list an older Aqua Pro Lite version.
- patagonia-multi-trails-shorts-8-mens | material | recycled polyester/spandex | https://www.patagonia.com.au/ (style 57602) | "2.5-oz 90% recycled polyester ... /10% spandex stretch plain weave" (was "recycled nylon")
- montbell-down-hugger-800-5 | discontinued | true | https://www.montbell.us/ | listed as Closeout; the current model is the Seamless Down Hugger 800 #5
- western-mountaineering-flash-jacket | discontinued | true | https://www.westernmountaineering.com/shop/page/4 | only "Hooded Flash Jacket $500.00" is sold; this record is the hoodless jacket
- valandre-swing-500 | discontinued | true | https://www.snowleader.ch/en/swing-co-850-VALA00070.html | current retailer listings carry the Swing CO 450 / CO 850; no current Swing 500 listing found
- the-north-face-assault-2-futurelight | url | product page | https://www.thenorthface.com/en-us/p/bags-and-gear/camp-shop-829877/assault-2-futurelight-NF0A8AV1 | was the TNF homepage
- soto-fusion-trek | url | product page | https://sotooutdoors.com/product/fusion-trek/ | "Fusion Trek Stove with advanced Micro Regulator Technology - SOTO", $99.95 (was a dealer-resources slug)
- montbell-ex-light-wind-parka-mens | url | product page | https://www.montbell.com/us/en/products/detail/1103285 | Montbell US model 1103285 "EX Light Wind Hooded Jacket" (was a review roundup)

## Checked, left unchanged
- black-diamond-access-down-1-0-hoody-mens: fill_power 700 is right. BD's US/EU pages say 700-fill duck down; the 800 FP is the standard Access Down Hoody.
- soto-tritrail: SOTO's own canonical URL for it really is /product/dealer-resources-6/.
- primus-power-gas-100/-230: standard Power Gas is only sold by the case in the US, and that case page covers both sizes.
- rei-co-op-flash-air-2: REI still sells a Flash Air 2 (a newer version), so not marked discontinued.
- valandre-mirage: a Mirage is still listed by retailers.
- UPF 40+ vs 50 on Patagonia Capilene Cool items: Australia rates UPF under its own standard; the US pages say 50+.
- patagonia-storm-racer-jacket-womens: style 24115 vs the current 24117 is a version change; re-checking its specs is a separate job.
- exped-ultra-1r/-3r/ultra-pillow: Exped USA now sells 2026 versions; re-checking their specs is a separate job.
- talenti-jar-pint | removed | duplicate of talenti-gelato-jar (cook-accessory, cold-soak jar) | aliased in data/aliases.json
