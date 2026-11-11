import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadDB } from './lib/data';
import { currentRoute, migrateLegacyHash } from './lib/router';
import './styles.css';

// Old links (#/c/shelter, #/share/<data>) become path URLs before anything reads the location.
const migrated = migrateLegacyHash();

const el = document.getElementById('root')!;
// A prerendered page shows its content until the data has loaded. It only fits the URL it was made
// for: a legacy link or an SPA fallback (another route served index.html) gets the loading text.
// React replaces it on its first commit (createRoot, not hydrateRoot: saved preferences would not
// match), and the app drops `data-route` once it has.
const pre = el.dataset.route;
if (pre != null && (migrated || pre !== currentRoute().pathname)) el.textContent = '';
if (!el.firstElementChild) el.innerHTML = '<div class="loading">Loading gear database…</div>';

const root = createRoot(el);
loadDB().then(
  (db) =>
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App db={db} />
        </ErrorBoundary>
      </StrictMode>,
    ),
  (e) =>
    root.render(
      <div className="page">
        <h1>Could not load data</h1>
        <p className="warn">{String(e)}</p>
        <p>
          Run <code>npm run data</code> to generate <code>public/data/gear.json</code>.
        </p>
      </div>,
    ),
);
