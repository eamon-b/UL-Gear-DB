import { useEffect, useState } from 'react';
import { loadDB } from './lib/data';
import { StoreProvider } from './lib/store';
import { useRoute } from './lib/router';
import type { DB } from './lib/types';
import { Header } from './components/Header';
import { BrowsePage } from './components/BrowsePage';
import { SearchPage } from './components/SearchPage';
import { CompareTray, CompareView } from './components/CompareView';
import { ListsPage } from './components/ListsPage';
import { SharedView } from './components/SharedView';
import { AboutPage } from './components/AboutPage';
import { ExamplesPage } from './components/ExamplesPage';
import { ItemDrawer } from './components/ItemDrawer';

export default function App() {
  const [db, setDb] = useState<DB | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadDB().then(setDb, (e) => setErr(String(e)));
  }, []);
  if (err) return <div className="page"><h1>Could not load data</h1><p className="warn">{err}</p><p>Run <code>npm run data</code> to generate <code>public/data/gear.json</code>.</p></div>;
  if (!db) return <div className="loading">Loading gear database…</div>;
  return (
    <StoreProvider db={db}>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [head, a] = route.path;
  useEffect(() => { window.scrollTo(0, 0); }, [head, a]);
  let section = 'browse';
  let page: JSX.Element;
  switch (head) {
    case 'c': page = <BrowsePage catId={a} />; break;
    case 'search': page = <SearchPage q={route.query.get('q') ?? ''} />; break;
    case 'compare': section = 'compare'; page = <CompareView idsParam={route.query.get('ids')} />; break;
    case 'lists': section = 'lists'; page = <ListsPage listId={a} />; break;
    case 'examples': section = 'examples'; page = <ExamplesPage />; break;
    case 'share': section = 'lists'; page = <SharedView data={route.path.slice(1).join('/')} />; break;
    case 'about': section = 'about'; page = <AboutPage />; break;
    default: page = <BrowsePage />;
  }
  return (
    <>
      <Header section={section} />
      <main>{page}</main>
      <ItemDrawer />
      {section !== 'compare' && <CompareTray />}
    </>
  );
}
