import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

// A malformed escape (e.g. a share link cut off mid-`%2F`) must not throw and blank the app.
const decodeSeg = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseHash(h = window.location.hash): Route {
  const raw = h.replace(/^#/, '');
  const [p, q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeSeg), query: new URLSearchParams(q), raw };
}

export function useRoute(): Route {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(to: string, replace = false) {
  const h = to.startsWith('#') ? to : '#' + to;
  if (replace) (history.replaceState(null, '', h), window.dispatchEvent(new HashChangeEvent('hashchange')));
  else window.location.hash = h;
}

export const href = (to: string) => '#' + to;
