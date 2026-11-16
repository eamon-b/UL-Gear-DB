/**
 * Page titles, descriptions, canonical URLs and structured data. Pure functions shared by the
 * build-time prerender (scripts/prerender.mjs, which writes them into each page's <head>) and
 * the client (which updates the head on every navigation).
 */
import type { DB, Item } from './types';
import type { Route } from './router';
import { G_PER_OZ } from './units';
import { defaultMetric, fmtMetric, type Metric } from './metric';
import { fmtPrice, humanizeKey, safeUrl } from './util';

export const SITE_NAME = 'UL Gear DB';

export interface PageMeta {
  title: string;
  description: string;
  /** canonical app path (no base), URL-encoded: `/item/zpacks-duplex` */
  path: string;
  noindex: boolean;
  /** schema.org object for a <script type="application/ld+json"> */
  jsonLd?: Record<string, unknown> | null;
}

export const itemPath = (id: string) => `/item/${encodeURIComponent(id)}`;
export const catPath = (id: string) => `/c/${encodeURIComponent(id)}`;

const oz = (g: number) => {
  const v = g / G_PER_OZ;
  return v.toFixed(v < 10 ? 2 : 1);
};
export const fmtGOz = (g: number) => `${g.toLocaleString('en-US')} g (${oz(g)} oz)`;

const metricCache = new WeakMap<Item[], Metric | null>();
/** The category's default third-dimension metric (not the user's choice), so pages read the same for everyone. */
function keyMetric(it: Item, db: DB): Metric | null {
  const pool = db.byCategory.get(it.category) ?? [];
  if (!metricCache.has(pool)) metricCache.set(pool, defaultMetric(it.category, pool));
  return metricCache.get(pool) ?? null;
}

/** "Capacity: 2 person", or null when the item has no value for its category's key spec. */
export function keySpec(it: Item, db: DB): string | null {
  const m = keyMetric(it, db);
  const v = m?.get(it);
  return m && v != null ? `${m.label}: ${fmtMetric(v, m)}` : null;
}

export function itemDescription(it: Item, db: DB): string {
  const cat = db.catById.get(it.category)?.name ?? it.category;
  const parts = [`${it.name}, ${it.subcategory} (${cat}): ${fmtGOz(it.weight_g)}`];
  if (it.price_usd != null) parts[0] += `, ${fmtPrice(it.price_usd)}`;
  const ks = keySpec(it, db);
  if (ks) parts.push(ks);
  parts.push('Specs, what the weight includes, and similar gear by weight');
  return parts.join('. ') + '.';
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export function productJsonLd(it: Item, db: DB, url: string | null): Record<string, unknown> {
  const cat = db.catById.get(it.category)?.name ?? it.category;
  const src = safeUrl(it.url);
  const o: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: it.name,
    brand: { '@type': 'Brand', name: it.brand },
    model: [it.model, it.variant].filter(Boolean).join(' '),
    category: `${cat} > ${it.subcategory}`,
    description: itemDescription(it, db),
    weight: { '@type': 'QuantitativeValue', value: it.weight_g, unitCode: 'GRM', unitText: 'g' },
  };
  if (url) o.url = url;
  const props = Object.entries(it.specs).map(([k, v]) => ({ '@type': 'PropertyValue', name: humanizeKey(k), value: v }));
  if (props.length) o.additionalProperty = props;
  // Price only when known. No availability: we don't know what is in stock.
  if (it.price_usd != null) {
    o.offers = { '@type': 'Offer', price: it.price_usd.toFixed(2), priceCurrency: 'USD', ...(src ? { url: src } : {}) };
  }
  return o;
}

const t = (s: string) => `${s} | ${SITE_NAME}`;

/** Title, description and canonical path for a route. `siteUrl` only feeds the JSON-LD `url`. */
export function routeMeta(route: Pick<Route, 'path' | 'query'>, db: DB, siteUrl = ''): PageMeta {
  const [head, a] = route.path;
  const nItems = db.items.length.toLocaleString('en-US');
  const home: PageMeta = {
    title: `${SITE_NAME}: ultralight backpacking gear database`,
    description: `Compare ${nItems} pieces of ultralight backpacking gear by weight, price and specs, find the Pareto frontier in every category, and build pack lists that suggest lighter swaps.`,
    path: '/',
    noindex: false,
  };
  const client = (title: string, path: string, description = home.description): PageMeta => ({
    title: t(title),
    description,
    path,
    noindex: true,
  });
  switch (head) {
    case undefined:
      return home;
    case 'c': {
      const cat = a ? db.catById.get(a) : undefined;
      if (!cat) return { ...home, noindex: true };
      const items = db.byCategory.get(cat.id) ?? [];
      const lightest = items.reduce<Item | null>((x, y) => (!x || y.weight_g < x.weight_g ? y : x), null);
      return {
        title: t(`Ultralight ${cat.name}: compare ${items.length} by weight and price`),
        description: clip(
          `Compare ${items.length} ultralight ${cat.name.toLowerCase()} (${cat.subcategories.join(', ')}) by weight, price and specs, with a weight vs price plot and the Pareto frontier.` +
            (lightest ? ` Lightest: ${lightest.name}, ${fmtGOz(lightest.weight_g)}.` : ''),
          300,
        ),
        path: catPath(cat.id),
        noindex: false,
      };
    }
    case 'item': {
      const it = a ? db.byId.get(a) : undefined;
      if (!it) return client('Item not found', a ? itemPath(a) : '/item');
      const path = itemPath(it.id); // an old id (alias) points at the current one
      return {
        title: t(`${it.name}: ${fmtGOz(it.weight_g)}`),
        description: itemDescription(it, db),
        path,
        noindex: false,
        jsonLd: productJsonLd(it, db, siteUrl ? siteUrl.replace(/\/+$/, '') + path : null),
      };
    }
    case 'about':
      return {
        title: t('About'),
        description: `Where the data comes from, how confident it is, and how to contribute. ${nItems} items from ${new Set(db.items.map((i) => i.brand)).size} brands.`,
        path: '/about',
        noindex: false,
      };
    case 'examples':
      return {
        title: t('Example pack lists'),
        description:
          'Real ultralight gear lists that hikers have published on LighterPack (PCT, AT, CDT, Colorado Trail and more), with base and total weights. Import any of them to start your own list.',
        path: '/examples',
        noindex: false,
      };
    case 'search': {
      const q = route.query.get('q')?.trim();
      return client(q ? `Search: ${q}` : 'Search', '/search');
    }
    case 'compare':
      return client('Compare', '/compare');
    case 'lists':
      return client('My lists', '/lists');
    case 'share':
      return client('Shared list', '/share');
    case 'l':
      return client('Shared list', `/l/${encodeURIComponent(route.path[1] ?? '')}`);
    default:
      return { ...home, noindex: true };
  }
}

/** Every page the build writes as static HTML. Canonical ids only: aliases fall back to the app. */
export function prerenderPaths(db: DB): string[] {
  return [
    '/',
    '/about',
    '/examples',
    ...db.categories.filter((c) => (db.byCategory.get(c.id) ?? []).length).map((c) => catPath(c.id)),
    ...db.items.map((it) => itemPath(it.id)),
  ];
}

/** `/` -> `index.html`, `/c/shelter` -> `c/shelter.html` (served at the clean URL by Pages and Cloudflare). */
export function outputFile(path: string): string {
  if (path === '/') return 'index.html';
  return decodeURIComponent(path.replace(/^\//, '')) + '.html';
}

/** Absolute when the site URL is known, else the path with the base (a relative canonical is legal). */
export function canonicalUrl(path: string, siteUrl: string, base: string): string {
  return siteUrl ? siteUrl.replace(/\/+$/, '') + path : base.replace(/\/+$/, '') + path;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** JSON for inside <script>: nothing in item text can close the tag or start a comment. */
export const jsonForScript = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));

/** The <head> tags for a page, replacing the shell's <title>. */
export function headTags(meta: PageMeta, opts: { siteUrl: string; base: string }): string {
  const e = escapeHtml;
  const canonical = canonicalUrl(meta.path, opts.siteUrl, opts.base);
  const out = [
    `<title>${e(meta.title)}</title>`,
    `<meta name="description" content="${e(meta.description)}" />`,
    `<link rel="canonical" href="${e(canonical)}" />`,
  ];
  if (meta.noindex) out.push(`<meta name="robots" content="noindex" />`);
  out.push(
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${e(meta.title)}" />`,
    `<meta property="og:description" content="${e(meta.description)}" />`,
  );
  // og:url must be absolute
  if (opts.siteUrl) out.push(`<meta property="og:url" content="${e(canonical)}" />`);
  out.push(
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${e(meta.title)}" />`,
    `<meta name="twitter:description" content="${e(meta.description)}" />`,
  );
  if (meta.jsonLd) out.push(`<script type="application/ld+json">${jsonForScript(meta.jsonLd)}</script>`);
  return out.join('\n    ');
}

export function sitemapXml(paths: string[], siteUrl: string, lastmod: string): string {
  const day = lastmod.slice(0, 10);
  const urls = paths.map((p) => `  <url><loc>${escapeHtml(canonicalUrl(p, siteUrl, '/'))}</loc><lastmod>${day}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Client side: bring the live <head> in line with the route (title, description, canonical, robots). */
export function applyHead(meta: PageMeta, opts: { siteUrl: string; base: string }) {
  document.title = meta.title;
  const tag = (sel: string, make: () => HTMLElement) => {
    let el = document.head.querySelector<HTMLElement>(sel);
    if (!el) document.head.appendChild((el = make()));
    return el;
  };
  const meta_ = (attr: 'name' | 'property', key: string) =>
    tag(`meta[${attr}="${key}"]`, () => {
      const m = document.createElement('meta');
      m.setAttribute(attr, key);
      return m;
    });
  meta_('name', 'description').setAttribute('content', meta.description);
  for (const [attr, key] of [
    ['property', 'og:title'],
    ['name', 'twitter:title'],
  ] as const)
    meta_(attr, key).setAttribute('content', meta.title);
  for (const [attr, key] of [
    ['property', 'og:description'],
    ['name', 'twitter:description'],
  ] as const)
    meta_(attr, key).setAttribute('content', meta.description);
  const canonical = canonicalUrl(meta.path, opts.siteUrl, opts.base);
  tag('link[rel="canonical"]', () => {
    const l = document.createElement('link');
    l.rel = 'canonical';
    return l;
  }).setAttribute('href', canonical);
  if (opts.siteUrl) meta_('property', 'og:url').setAttribute('content', canonical);
  const robots = document.head.querySelector('meta[name="robots"]');
  if (meta.noindex) meta_('name', 'robots').setAttribute('content', 'noindex');
  else robots?.remove();
  // structured data belongs to the prerendered page it came with
  const ld = document.head.querySelector('script[type="application/ld+json"]');
  if (meta.jsonLd) {
    const s = (ld as HTMLScriptElement | null) ?? document.head.appendChild(document.createElement('script'));
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(meta.jsonLd);
  } else ld?.remove();
}
