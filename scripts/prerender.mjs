#!/usr/bin/env node
/**
 * prerender.mjs: static HTML for every indexable page, after `vite build`.
 *
 * Bundles src/ssr.tsx with Vite's SSR build, then renders `/`, `/about`, `/examples`, every
 * `/c/<category>` and every `/item/<id>` (canonical ids, not aliases) with the app's own components,
 * at default preferences. Each page is dist/index.html with its own <head> (title, description,
 * canonical, Open Graph, JSON-LD for items) and the rendered markup inside #root. The client mounts
 * over it with createRoot once gear.json has loaded (src/main.tsx).
 *
 * Files are flat (`dist/item/<id>.html`, `dist/c/<cat>.html`, `dist/about.html`): GitHub Pages and
 * Cloudflare (html_handling auto-trailing-slash) both serve them at the clean URL with no redirect.
 * Routes that only exist in the browser (/lists, /search, /compare, /share) load the app shell:
 * dist/404.html for GitHub Pages; Cloudflare uses its SPA fallback.
 *
 * Environment:
 *   VITE_BASE  the base the client was built with ('/' by default, '/<repo>/' on GitHub Pages)
 *   SITE_URL   absolute site URL (https://example.com, https://<user>.github.io/<repo>). Makes canonicals
 *              absolute and writes sitemap.xml; without it canonicals are root-relative and there is no sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

process.env.NODE_ENV = 'production';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SSR_OUT = path.join(ROOT, 'dist-ssr');
const BASE = process.env.VITE_BASE || '/';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');

const t0 = performance.now();
const shellFile = path.join(DIST, 'index.html');
if (!fs.existsSync(shellFile)) {
  console.error('dist/index.html is missing: run `vite build` first.');
  process.exit(1);
}
const TITLE = /<title>[^<]*<\/title>/;
const ROOT_DIV = '<div id="root"></div>';
const NOINDEX = '\n    <meta name="robots" content="noindex" />';
let shell = fs.readFileSync(shellFile, 'utf8');
// Run again on a prerendered dist/: index.html is the home page by now, but 404.html is the shell.
if (shell.includes('<div id="root" data-route=') && fs.existsSync(path.join(DIST, '404.html')))
  shell = fs.readFileSync(path.join(DIST, '404.html'), 'utf8').replace(NOINDEX, '');
if (!TITLE.test(shell) || !shell.includes(ROOT_DIV)) {
  console.error('dist/index.html has no <title> or empty <div id="root"></div> to fill.');
  process.exit(1);
}

await build({
  root: ROOT,
  logLevel: 'warn',
  build: { ssr: 'src/ssr.tsx', outDir: SSR_OUT, emptyOutDir: true, minify: false },
});
const ssr = await import(pathToFileURL(path.join(SSR_OUT, 'ssr.js')).href);
const tBuild = performance.now();

const db = ssr.hydrate(JSON.parse(fs.readFileSync(path.join(DIST, 'data/gear.json'), 'utf8')));
const examplesFile = path.join(DIST, 'data/examples.json');
if (fs.existsSync(examplesFile)) ssr.setPrerenderExamples(JSON.parse(fs.readFileSync(examplesFile, 'utf8')).lists);

// The SPA fallback is the empty shell (it shows "Loading…" until the app has the route), never indexed.
fs.writeFileSync(
  path.join(DIST, '404.html'),
  shell.replace(TITLE, (m) => m + NOINDEX),
);

const paths = ssr.prerenderPaths(db);
const indexable = [];
let bytes = 0;
for (const p of paths) {
  const meta = ssr.routeMeta(ssr.parsePath(p), db, SITE_URL);
  if (meta.path !== p) throw new Error(`prerender path ${p} is not canonical (${meta.path})`);
  if (!meta.noindex) indexable.push(p);
  const body = ssr.renderRoute(db, p);
  // replacer functions: item text may contain `$&` and friends
  const html = shell
    .replace(TITLE, () => ssr.headTags(meta, { siteUrl: SITE_URL, base: BASE }))
    .replace(ROOT_DIV, () => `<div id="root" data-route="${p}">${body}</div>`);
  const file = path.join(DIST, ssr.outputFile(p));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  bytes += Buffer.byteLength(html);
}

// robots.txt is only read at a domain root; on a project Pages site submit the sitemap in Search Console.
if (SITE_URL) {
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), ssr.sitemapXml(indexable, SITE_URL, db.generated_at));
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
} else {
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  console.log('prerender: SITE_URL is not set, so canonical links are root-relative and there is no sitemap.xml.');
}
fs.rmSync(SSR_OUT, { recursive: true, force: true });

const s = (ms) => (ms / 1000).toFixed(1) + 's';
console.log(
  `prerender: ${paths.length} pages (${(bytes / 1048576).toFixed(1)} MB) + 404.html in ${s(performance.now() - t0)} ` +
    `(server bundle ${s(tBuild - t0)}, render ${s(performance.now() - tBuild)}); base ${BASE}, site ${SITE_URL || '(none)'}`,
);
