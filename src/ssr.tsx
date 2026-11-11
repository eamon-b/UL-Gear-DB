/**
 * Server entry for the build-time prerender (scripts/prerender.mjs bundles it with Vite's SSR build).
 * Renders the same components the app shows, at default preferences (grams, auto theme, no lists).
 */
import { renderToString } from 'react-dom/server';
import { StoreProvider } from './lib/store';
import { Shell } from './App';
import { parsePath } from './lib/router';
import type { DB } from './lib/types';

export { parsePath };
export { hydrate } from './lib/data';
export { setPrerenderExamples } from './components/ExamplesPage';
export { headTags, outputFile, prerenderPaths, routeMeta, sitemapXml } from './lib/seo';

export function renderRoute(db: DB, path: string): string {
  return renderToString(
    <StoreProvider db={db}>
      <Shell route={parsePath(path)} />
    </StoreProvider>,
  );
}
