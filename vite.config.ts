import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Path routing (/c/shelter, /item/<id>) and prerendered pages nested in folders need an absolute base.
// Default '/' (local dev, Cloudflare at a domain root). GitHub Pages serves a project site under
// /<repo>/, so the Pages workflow builds with VITE_BASE=/<repo>/.
// SITE_URL (e.g. https://example.com or https://<user>.github.io/<repo>) makes canonical links absolute
// and enables sitemap.xml; see scripts/prerender.mjs.
const WORKER = 'http://localhost:8787';

export default defineConfig(({ isSsrBuild }) => ({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  define: {
    __SITE_URL__: JSON.stringify((process.env.SITE_URL || '').replace(/\/+$/, '')),
  },
  // Local dev against the backend: run `npm run dev` in worker/ (port 8787) next to `npm run dev` here.
  // Without it these requests fail and the app behaves as it does on a static host. The Worker only
  // accepts writes from its own origin, so the proxy presents requests as made to and from it.
  server: { proxy: { '/api': { target: WORKER, changeOrigin: true, headers: { origin: WORKER } }, '/l/': WORKER } },
  // `vite preview` stands in for a static host: no backend
  preview: { proxy: {} },
  // worker/ has its own Vitest setup (it runs inside the Workers runtime)
  test: { include: ['tests/**/*.test.ts'] },
  // the prerender's server bundle doesn't need a copy of public/
  build: isSsrBuild ? { copyPublicDir: false } : {},
}));
