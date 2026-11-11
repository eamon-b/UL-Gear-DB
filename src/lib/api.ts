import type { ListItem, PackList } from './types';
import type { RemoteList } from './sync';
import type { MeResponse as Me, ShareInfo as ShareLink, SharedList as ApiSharedList, Summary } from '../../shared/api';

/**
 * Client for the optional backend (the Cloudflare Worker in `worker/`). The site also runs as plain
 * static files with no backend at all (GitHub Pages, `vite preview`), so every call here can fail and
 * callers fall back: share links go back to the long in-URL form, and the account UI stays hidden.
 */

export type { MeResponse as Me, Provider, ShareInfo as ShareLink, Summary, User } from '../../shared/api';
/** A shared list as fetched. `items` is unchecked: run it through `sanitizeLists` before use. */
export type SharedList = Omit<ApiSharedList, 'items'> & { items: ListItem[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

const BASE = `${import.meta.env.BASE_URL}api`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline');
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  // A static host answers /api/* with an HTML page (or 404/405): that is "no backend", not a server fault.
  const json = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json().catch(() => null) : null;
  if (json == null) throw new ApiError(res.status, 'no_backend', 'This site is running without a server');
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, json);
  }
  return json as T;
}

export const api = {
  /** Resolves to null when there is no backend, so callers can hide everything that needs one. Rejects when offline. */
  me: (): Promise<Me | null> =>
    call<Me>('GET', '/me').catch((e) => {
      if (e instanceof ApiError && e.status === 0) throw e;
      return null;
    }),
  logout: () => call<void>('POST', '/auth/logout', {}),
  deleteAccount: () => call<void>('DELETE', '/me'),
  emailStart: (email: string, ret: string) => call<void>('POST', '/auth/email/start', { email, return: ret }),
  devLogin: (email: string) => call<void>('POST', '/auth/dev', { email }),
  googleUrl: (ret: string) => `${BASE}/auth/google/start?return=${encodeURIComponent(ret)}`,

  share: (name: string, items: ListItem[], summary: Summary) =>
    call<{ id: string; url: string }>('POST', '/share', { name, items, summary }),
  shared: (id: string) => call<SharedList>('GET', `/share/${encodeURIComponent(id)}`),
  shares: () => call<{ shares: ShareLink[] }>('GET', '/shares').then((r) => r.shares),
  deleteShare: (id: string) => call<void>('DELETE', `/share/${encodeURIComponent(id)}`),

  lists: () => call<{ lists: RemoteList[] }>('GET', '/lists').then((r) => r.lists),
  putList: (l: PackList, summary: Summary) =>
    call<{ updated: number }>('PUT', `/lists/${l.id}`, { name: l.name, items: l.items, created: l.created, updated: l.updated, summary }),
  deleteList: (id: string, updated: number) => call<void>('DELETE', `/lists/${id}?updated=${updated}`),
  publish: (id: string) => call<{ id: string; url: string }>('PUT', `/lists/${id}/publish`, {}),
  unpublish: (id: string) => call<void>('DELETE', `/lists/${id}/publish`),
};
