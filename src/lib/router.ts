import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
  /** the fragment without `#`: only `/share#<data>` uses it */
  hash: string;
  /** app path without the base, e.g. `/c/shelter` */
  pathname: string;
}

/** `/` locally and on Cloudflare, `/UL-Gear-DB/` on GitHub Pages. Always ends with `/`. */
export const BASE: string = import.meta.env.BASE_URL || '/';

// A malformed escape (e.g. a share link cut off mid-`%2F`) must not throw and blank the app.
export const decodeSeg = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** `/UL-Gear-DB/c/shelter/` -> `/c/shelter`. Also accepts `/about.html` and `/index.html`, as static hosts serve them too. */
export function stripBase(pathname: string, base = BASE): string {
  const b = base.replace(/\/+$/, '');
  let p = pathname;
  if (b && (p === b || p.startsWith(b + '/'))) p = p.slice(b.length);
  p = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  p = '/' + p.split('/').filter(Boolean).join('/');
  return p;
}

export function parseLocation(loc: { pathname: string; search: string; hash: string }, base = BASE): Route {
  const pathname = stripBase(loc.pathname, base);
  return {
    path: pathname.split('/').filter(Boolean).map(decodeSeg),
    query: new URLSearchParams(loc.search),
    hash: loc.hash.replace(/^#/, ''),
    pathname,
  };
}

/** Parse an app path like `/search?q=x` or `/share#data` (used by the prerender and tests). */
export function parsePath(to: string): Route {
  const u = new URL(to, 'http://x');
  return parseLocation(u, '/');
}

/**
 * Old hash URLs (`#/c/shelter`, `#/compare?ids=…`, `#/share/<data>`) -> the app path that replaces them,
 * or null when the fragment is not a legacy route. The share payload moves to the fragment as is.
 */
export function legacyHashTarget(hash: string): string | null {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('/')) return null;
  const share = /^\/share\/(.*)$/.exec(h);
  if (share) return `/share#${share[1]}`;
  return h;
}

/** Full URL path (with base) for an app path: `href('/c/shelter')` -> `/UL-Gear-DB/c/shelter`. */
export const href = (to: string, base = BASE) => base.replace(/\/+$/, '') + (to.startsWith('/') ? to : '/' + to);
export const itemHref = (id: string) => href(`/item/${encodeURIComponent(id)}`);
/** Absolute URL for copying (share and compare links). */
export const absUrl = (to: string) => window.location.origin + href(to);

export const currentRoute = () => parseLocation(window.location);

const EVT = 'ulgdb:navigate';

export function useRoute(): Route {
  const [r, setR] = useState(currentRoute);
  useEffect(() => {
    const on = () => setR(currentRoute());
    // hashchange: a `/share#<data>` link followed from another share page only changes the fragment
    const evts = ['popstate', 'hashchange', EVT];
    for (const t of evts) window.addEventListener(t, on);
    return () => {
      for (const t of evts) window.removeEventListener(t, on);
    };
  }, []);
  return r;
}

export function navigate(to: string, replace = false) {
  const url = href(to);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVT));
}

/** Rewrite a legacy `#/…` URL in place (startup). Returns true when it did. */
export function migrateLegacyHash(): boolean {
  const to = legacyHashTarget(window.location.hash);
  if (to == null) return false;
  history.replaceState(null, '', href(to));
  return true;
}

/** A plain left click that the browser would turn into a same-tab navigation. */
export const isPlainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * One delegated listener turns clicks on internal `<a href>` links into client-side navigation.
 * It goes on React's root container, after React's own listener: a handler that calls preventDefault
 * (ItemLink opening the drawer) is respected, and one that stops propagation (the drawer) can't hide the click.
 */
export function interceptLinks(el: HTMLElement | Document = document): () => void {
  const on = (e: MouseEvent) => {
    if (e.defaultPrevented || !isPlainClick(e)) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const b = BASE.replace(/\/+$/, '');
    if (b && url.pathname !== b && !url.pathname.startsWith(b + '/')) return;
    // files (data/gear.json) and in-page anchors are left to the browser
    if (/\.\w+$/.test(url.pathname)) return;
    if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
    e.preventDefault();
    navigate(stripBase(url.pathname) + url.search + url.hash);
  };
  el.addEventListener('click', on as EventListener);
  return () => el.removeEventListener('click', on as EventListener);
}
