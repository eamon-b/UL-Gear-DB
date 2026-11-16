import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hydrate } from '../src/lib/data';
import { parsePath } from '../src/lib/router';
import {
  canonicalUrl,
  escapeHtml,
  headTags,
  jsonForScript,
  outputFile,
  prerenderPaths,
  productJsonLd,
  routeMeta,
  sitemapXml,
} from '../src/lib/seo';
import { similarItems } from '../src/components/ItemPage';
import type { Item } from '../src/lib/types';
import { loadTestDB, ROOT } from './helpers';

const db = loadTestDB();
const SITE = 'https://example.com/UL-Gear-DB';
const meta = (p: string, site = '') => routeMeta(parsePath(p), db, site);

/** A tiny DB with hostile text in it: item data is scraped and only semi-trusted. */
const evil = hydrate({
  generated_at: '2026-01-02T03:04:05Z',
  categories: [{ id: 'shelter', name: 'Shelters', group: 'Big 3', subcategories: ['tarp'], count: 2 }],
  items: [
    {
      id: 'evil-tarp',
      category: 'shelter',
      subcategory: 'tarp',
      brand: 'Acme "Best" <b>',
      model: '</script><script>alert(1)</script>',
      variant: "O'Neil & $& $1",
      weight_g: 250,
      price_usd: 199,
      url: 'javascript:alert(1)',
      specs: { capacity: 1, material: 'DCF <0.5 oz>' },
    },
    { id: 'plain-tarp', category: 'shelter', subcategory: 'tarp', brand: 'Plain', model: 'Tarp', weight_g: 300, price_usd: null },
  ],
  aliases: { 'old-tarp': 'plain-tarp' },
});

describe('routeMeta', () => {
  it('gives every item a unique title and its canonical path', () => {
    const titles = new Set(db.items.map((it) => meta(`/item/${it.id}`).title));
    expect(titles.size).toBe(db.items.length);
    const it = db.items[0];
    const m = meta(`/item/${it.id}`);
    expect(m.path).toBe(`/item/${it.id}`);
    expect(m.noindex).toBe(false);
    expect(m.title).toContain(it.name);
    expect(m.description).toMatch(/\d g \([\d.]+ oz\)/);
  });

  it('points an alias at the current id', () => {
    const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8')) as Record<string, string>;
    const [from, to] = Object.entries(aliases).find(([, to]) => db.items.some((i) => i.id === to))!;
    const m = meta(`/item/${from}`, SITE);
    expect(m.path).toBe(`/item/${to}`);
    expect(m.jsonLd?.url).toBe(`${SITE}/item/${to}`);
  });

  it('marks client-only and unknown routes noindex', () => {
    for (const p of ['/lists', '/lists/abc', '/search?q=tent', '/compare?ids=a', '/share', '/item/nope', '/c/nope', '/what'])
      expect(meta(p).noindex, p).toBe(true);
    for (const p of ['/', '/about', '/examples', '/c/shelter']) expect(meta(p).noindex, p).toBe(false);
    expect(meta('/search?q=dcf tarp').title).toContain('dcf tarp');
  });

  it('describes a category with its lightest item', () => {
    const m = meta('/c/shelter');
    expect(m.path).toBe('/c/shelter');
    expect(m.title).toMatch(/Shelters.*compare \d+/);
    expect(m.description).toMatch(/Lightest: .+ \d+ g/);
  });
});

describe('productJsonLd', () => {
  it('describes the product with weight, and a USD offer only when priced', () => {
    const priced = db.items.find((i) => i.price_usd != null)!;
    const ld = productJsonLd(priced, db, `${SITE}/item/${priced.id}`);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: priced.name,
      brand: { '@type': 'Brand', name: priced.brand },
      weight: { '@type': 'QuantitativeValue', value: priced.weight_g, unitCode: 'GRM' },
      offers: { '@type': 'Offer', price: priced.price_usd!.toFixed(2), priceCurrency: 'USD' },
      url: `${SITE}/item/${priced.id}`,
    });
    expect(JSON.stringify(ld)).not.toMatch(/availability|InStock/);
    const unpriced = db.items.find((i) => i.price_usd == null)!;
    expect(productJsonLd(unpriced, db, null).offers).toBeUndefined();
    expect(productJsonLd(unpriced, db, null).url).toBeUndefined();
  });

  it('drops unsafe source links', () => {
    const ld = productJsonLd(evil.byId.get('evil-tarp')!, evil, null);
    expect(JSON.stringify(ld)).not.toContain('javascript:');
  });
});

describe('headTags', () => {
  it('writes title, description, canonical, Open Graph and JSON-LD', () => {
    const it = db.items[0];
    const h = headTags(meta(`/item/${it.id}`, SITE), { siteUrl: SITE, base: '/UL-Gear-DB/' });
    expect(h).toContain(`<link rel="canonical" href="${SITE}/item/${it.id}" />`);
    expect(h).toContain(`<meta property="og:url" content="${SITE}/item/${it.id}" />`);
    expect(h).toContain('<meta name="twitter:card" content="summary" />');
    expect(h).toMatch(/<meta property="og:title" content="[^"]+" \/>/);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/.exec(h)![1]);
    expect(ld.name).toBe(it.name);
    expect(h).not.toContain('noindex');
  });

  it('uses a base-relative canonical and no og:url without a site URL', () => {
    const h = headTags(meta('/c/shelter'), { siteUrl: '', base: '/UL-Gear-DB/' });
    expect(h).toContain('<link rel="canonical" href="/UL-Gear-DB/c/shelter" />');
    expect(h).not.toContain('og:url');
    expect(headTags(meta('/'), { siteUrl: '', base: '/' })).toContain('<link rel="canonical" href="/" />');
  });

  it('escapes hostile item text everywhere', () => {
    const m = routeMeta(parsePath('/item/evil-tarp'), evil, SITE);
    const h = headTags(m, { siteUrl: SITE, base: '/' });
    // nothing can close the JSON-LD script or open a tag
    expect(h.match(/<\/script>/g)).toHaveLength(1);
    expect(h).not.toMatch(/<script>alert|<b>/);
    expect(h).toContain('Acme &quot;Best&quot; &lt;b&gt;');
    expect(h).toContain('O&#39;Neil &amp; $&amp; $1');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*)<\/script>/s.exec(h)![1]);
    expect(ld.name).toBe(`Acme "Best" <b> </script><script>alert(1)</script> O'Neil & $& $1`);
    expect(ld.additionalProperty).toContainEqual({ '@type': 'PropertyValue', name: 'Material', value: 'DCF <0.5 oz>' });
  });

  it('marks noindex pages', () => {
    expect(headTags(meta('/lists'), { siteUrl: '', base: '/' })).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('escaping helpers', () => {
  it('escapeHtml covers attribute and text contexts', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('jsonForScript stays valid JSON with no markup characters', () => {
    const v = { s: '</script><!-- & \u2028 \u2029' };
    const out = jsonForScript(v);
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual(v);
  });
});

describe('prerender paths and files', () => {
  it('lists the indexable pages, canonical ids only', () => {
    const paths = prerenderPaths(db);
    expect(paths.slice(0, 3)).toEqual(['/', '/about', '/examples']);
    expect(paths).toContain('/c/shelter');
    expect(paths.filter((p) => p.startsWith('/item/'))).toHaveLength(db.items.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(prerenderPaths(evil)).not.toContain('/item/old-tarp');
    for (const p of paths) expect(meta(p).path).toBe(p);
  });

  it('writes flat .html files', () => {
    expect(outputFile('/')).toBe('index.html');
    expect(outputFile('/about')).toBe('about.html');
    expect(outputFile('/c/shelter')).toBe('c/shelter.html');
    expect(outputFile('/item/zpacks-duplex')).toBe('item/zpacks-duplex.html');
  });

  it('canonicalUrl joins the site URL or the base', () => {
    expect(canonicalUrl('/', SITE, '/x/')).toBe(`${SITE}/`);
    expect(canonicalUrl('/about', SITE + '/', '/x/')).toBe(`${SITE}/about`);
    expect(canonicalUrl('/about', '', '/UL-Gear-DB/')).toBe('/UL-Gear-DB/about');
  });

  it('builds a sitemap with absolute URLs and the data date', () => {
    const xml = sitemapXml(['/', '/c/shelter'], SITE, evil.generated_at);
    expect(xml).toContain(`<url><loc>${SITE}/</loc><lastmod>2026-01-02</lastmod></url>`);
    expect(xml).toContain(`<loc>${SITE}/c/shelter</loc>`);
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});

describe('similarItems', () => {
  it('picks up to 8 of the same type, nearest in weight, never the item itself', () => {
    const it = db.byCategory.get('shelter')!.find((i) => i.subcategory === 'tarp')!;
    const sim = similarItems(it, db);
    expect(sim).toHaveLength(8);
    expect(sim.every((x: Item) => x.subcategory === 'tarp' && x.id !== it.id)).toBe(true);
    const far = Math.max(...sim.map((x) => Math.abs(x.weight_g - it.weight_g)));
    const others = db.byCategory.get('shelter')!.filter((x) => x.subcategory === 'tarp' && x.id !== it.id && !sim.includes(x));
    expect(others.every((x) => Math.abs(x.weight_g - it.weight_g) >= far)).toBe(true);
  });
});
