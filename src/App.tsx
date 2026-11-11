import { useEffect } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { AccountProvider } from './lib/account';
import { BASE, decodeSeg, interceptLinks, navigate, useRoute, type Route } from './lib/router';
import { applyHead, routeMeta } from './lib/seo';
import type { DB } from './lib/types';
import { Header } from './components/Header';
import { BrowsePage } from './components/BrowsePage';
import { SearchPage } from './components/SearchPage';
import { CompareTray, CompareView } from './components/CompareView';
import { ListsPage } from './components/ListsPage';
import { SharedLinkView, SharedView } from './components/SharedView';
import { AboutPage } from './components/AboutPage';
import { ExamplesPage } from './components/ExamplesPage';
import { ItemPage } from './components/ItemPage';
import { ItemDrawer } from './components/ItemDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App({ db }: { db: DB }) {
  return (
    <StoreProvider db={db}>
      <AccountProvider>
        <ClientShell />
      </AccountProvider>
    </StoreProvider>
  );
}

const AUTH_ERRORS: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  google_state: 'Google sign-in expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  link_invalid: 'That sign-in link has expired or was already used. Ask for a new one.',
};

/** The browser side of the shell: follows the URL, handles link clicks, keeps the <head> current. */
function ClientShell() {
  const route = useRoute();
  const { db, openItem, toast } = useStore();
  // A sign-in that failed on the server comes back as /?auth_error=<code>.
  useEffect(() => {
    const code = route.query.get('auth_error');
    if (!code) return;
    toast(AUTH_ERRORS[code] ?? 'Sign-in failed. Please try again.');
    navigate(route.pathname, true);
  }, [route, toast]);
  useEffect(() => interceptLinks(document.getElementById('root') ?? document), []);
  // the prerendered markup (if any) is gone now: #root belongs to the app
  useEffect(() => document.getElementById('root')?.removeAttribute('data-route'), []);
  const q = route.query.toString();
  useEffect(() => {
    applyHead(routeMeta(route, db, __SITE_URL__), { siteUrl: __SITE_URL__, base: BASE });
  }, [route.pathname, q, db]); // eslint-disable-line react-hooks/exhaustive-deps
  // the drawer belongs to the page it was opened on (and "Open page" goes to the same item)
  useEffect(() => openItem(null), [route.pathname, openItem]);
  return <Shell route={route} />;
}

/** Renders a route. Also used by the build-time prerender (src/ssr.tsx), where effects never run. */
export function Shell({ route }: { route: Route }) {
  const [head, a] = route.path;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [head, a]);
  let section = 'browse';
  let page: JSX.Element;
  switch (head) {
    case 'c':
      page = <BrowsePage catId={a} />;
      break;
    case 'item':
      page = <ItemPage id={a} />;
      break;
    case 'search':
      page = <SearchPage q={route.query.get('q') ?? ''} />;
      break;
    case 'compare':
      section = 'compare';
      page = <CompareView idsParam={route.query.get('ids')} />;
      break;
    case 'lists':
      section = 'lists';
      page = <ListsPage listId={a} />;
      break;
    case 'examples':
      section = 'examples';
      page = <ExamplesPage />;
      break;
    case 'share':
      section = 'lists';
      // `/share#<data>`; `/share/<data>` is accepted too
      page = <SharedView data={decodeSeg(route.hash) || route.path.slice(1).join('/')} />;
      break;
    case 'l':
      section = 'lists';
      page = <SharedLinkView id={a ?? ''} />;
      break;
    case 'about':
      section = 'about';
      page = <AboutPage />;
      break;
    default:
      page = <BrowsePage />;
  }
  return (
    <>
      <Header section={section} />
      {/* keyed on the path (not the query, which search rewrites per keystroke) so navigating away recovers from a page that threw */}
      <main>
        <ErrorBoundary key={route.path.join('/')}>{page}</ErrorBoundary>
      </main>
      <ItemDrawer />
      {section !== 'compare' && <CompareTray />}
    </>
  );
}
