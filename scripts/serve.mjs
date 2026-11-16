#!/usr/bin/env node
/**
 * serve.mjs: serves dist/ the way GitHub Pages does, to test a build without deploying it.
 *   node scripts/serve.mjs [--port 4174] [--base /UL-Gear-DB/]
 * `/foo` serves foo.html, `/dir/` serves dir/index.html, and anything else gets 404.html with a 404
 * status (the SPA fallback). Build with the same VITE_BASE as --base.
 * (`vite preview` serves clean URLs too, but falls back to index.html with a 200, like Cloudflare's SPA mode.)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = Number(arg('--port', 4174));
const BASE = '/' + arg('--base', '/').replace(/^\/+|\/+$/g, '');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const isFile = (f) => f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile();

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    const b = BASE === '/' ? '' : BASE;
    if (b && p === b) return res.writeHead(301, { location: b + '/' + url.search }).end();
    if (b && !p.startsWith(b + '/')) return res.writeHead(404).end('not found');
    p = p.slice(b.length);
    const f = path.join(ROOT, p);
    const file = [p.endsWith('/') ? path.join(f, 'index.html') : f, f + '.html'].find(isFile);
    const send = (status, fp) => {
      res.writeHead(status, { 'content-type': TYPES[path.extname(fp)] ?? 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    };
    if (file) return send(200, file);
    if (!p.endsWith('/') && isFile(path.join(f, 'index.html'))) return res.writeHead(301, { location: b + p + '/' }).end();
    send(404, path.join(ROOT, '404.html'));
  })
  .listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}${BASE === '/' ? '/' : BASE + '/'}`));
