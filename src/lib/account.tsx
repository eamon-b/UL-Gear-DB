import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Me, type Summary, type User } from './api';
import { resolve, totals } from './lists';
import { sanitizeLists, useStore } from './store';
import {
  adopt as adoptList,
  emptySyncState,
  hasUnsynced,
  noteDeleted,
  notePushed,
  planSync,
  sanitizeSyncState,
  signedOutState,
  stateFor,
  type RemoteList,
  type SyncState,
} from './sync';
import type { DB, PackList } from './types';
import { loadLS, saveLS } from './util';

/**
 * Optional accounts. Without a backend (a static host) or without signing in, nothing here does
 * anything and lists live in localStorage as they always have. Signed in, the same localStorage
 * lists are also kept in step with the account, so they follow the user to other devices.
 */

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface Account {
  /** null until the first answer from /api/me; false on a static host */
  backend: boolean | null;
  me: Me | null;
  user: User | null;
  /** can anyone sign in here? (a backend with at least one sign-in method) */
  canSignIn: boolean;
  status: SyncStatus;
  /** why the last sync failed, in words for the user */
  problem: string | null;
  lastSync: number | null;
  /** list id -> id of its live share link */
  shares: Record<string, string>;
  signInOpen: boolean;
  setSignInOpen: (open: boolean) => void;
  /** re-read who is signed in (after the dev login, which does not reload the page) */
  refresh: () => Promise<void>;
  syncNow: () => void;
  signOut: (removeLists: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Make a list's live link (uploads the list first if needed). Resolves to the link. */
  publish: (listId: string) => Promise<string>;
  unpublish: (listId: string) => Promise<void>;
  /** list id -> the other account it was synced with: kept in this browser, not uploaded to this account */
  held: Record<string, string>;
  /** add a held list to the account signed in */
  adopt: (listId: string) => void;
}

const inert: Account = {
  backend: false,
  me: null,
  user: null,
  canSignIn: false,
  status: 'off',
  problem: null,
  lastSync: null,
  shares: {},
  signInOpen: false,
  setSignInOpen: () => {},
  refresh: async () => {},
  syncNow: () => {},
  signOut: async () => {},
  deleteAccount: async () => {},
  publish: async () => {
    throw new Error('no account');
  },
  unpublish: async () => {},
  held: {},
  adopt: () => {},
};

// The default value is what the build-time prerender gets: no provider, no account.
const Ctx = createContext<Account>(inert);
export const useAccount = () => useContext(Ctx);

const SYNC_KEY = 'ulgdb.sync';
const ME_KEY = 'ulgdb.me';
function sanitizeMe(v: unknown): Me | null {
  const o = v && typeof v === 'object' ? (v as Partial<Me>) : null;
  if (!o || !Array.isArray(o.providers)) return null;
  const u = o.user;
  const user =
    u && typeof u.id === 'string' && typeof u.email === 'string'
      ? { id: u.id, email: u.email, name: typeof u.name === 'string' ? u.name : null }
      : null;
  return { user, providers: o.providers.filter((p) => p === 'google' || p === 'email'), ...(o.dev ? { dev: true as const } : {}) };
}
const loadState = () => sanitizeSyncState(loadLS<unknown>(SYNC_KEY, null));
const RETRY_MS = 60_000;

/**
 * Did the server answer "no" to this one request, as opposed to the sync as a whole being unable
 * to go on? Offline, a server fault, a rate limit (429) and a lost session (401) are the latter:
 * they are thrown on, and the list stays unsynced for the next attempt.
 */
const isRefusal = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;

/** How many of these lists signing in would upload (the rest are held for another account). */
export function countUploadable(lists: PackList[]): number {
  const { others } = loadState();
  return lists.filter((l) => !(l.id in others)).length;
}

export function summarize(l: PackList, db: DB): Summary {
  const t = totals(l.items.map((li) => resolve(li, db)));
  const r = (n: number) => Math.max(0, Math.round(n));
  return { base_g: r(t.base), total_g: r(t.total), count: r(t.count), cost: t.cost > 0 ? r(t.cost) : null };
}

export const shareLinkUrl = (id: string) => `${window.location.origin}${import.meta.env.BASE_URL}l/${id}`;

export function AccountProvider({ children }: { children: ReactNode }) {
  const { db, lists, replaceLists, toast } = useStore();
  // Remembered from the last visit so the header does not change shape once /api/me answers.
  // Only a hint for what to draw: the server decides on every request who is signed in.
  const [me, setMeState] = useState<Me | null>(() => sanitizeMe(loadLS<unknown>(ME_KEY, null)));
  const setMe = useCallback((next: Me | null | ((m: Me | null) => Me | null)) => {
    setMeState((m) => {
      const v = typeof next === 'function' ? next(m) : next;
      saveLS(ME_KEY, v);
      return v;
    });
  }, []);
  const [backend, setBackend] = useState<boolean | null>(null);
  const [status, setStatus] = useState<SyncStatus>('off');
  const [problem, setProblem] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<Record<string, string>>({});
  const [signInOpen, setSignInOpen] = useState(false);
  const user = me?.user ?? null;

  const listsRef = useRef(lists);
  listsRef.current = lists;
  const userRef = useRef(user);
  userRef.current = user;
  /** lists the server refused (too large, …), by the `updated` stamp refused: not retried until edited */
  const refused = useRef(new Map<string, number>());
  const running = useRef(false);
  const again = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>();
  /** counts share links made or stopped here, so a sync can tell that its copy of the server's is older */
  const linkChanges = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setBackend(m != null);
      setMe(m);
    } catch {
      // Offline, or the server is failing: go by what the last visit knew, so a signed-in user is
      // not shown as signed out. (Who is signed in is still the server's call on every request.)
      setBackend(sanitizeMe(loadLS<unknown>(ME_KEY, null)) != null);
    }
  }, [setMe]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = (s: SyncState) => {
    saveLS(SYNC_KEY, s);
    setShares(s.shares);
    setHeld(s.others);
  };
  /** Change the stored state in one synchronous step, and only while it is still this user's. */
  const patch = (userId: string, fn: (s: SyncState) => SyncState) => {
    const s = loadState();
    if (s.userId === userId) save(fn(s));
  };

  const sync = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    clearTimeout(retry.current);
    setStatus('syncing');
    try {
      const linksBefore = linkChanges.current;
      // Another device may run another version of the app: clean what it wrote like anything from storage.
      const remote = (await api.lists(u.id)).flatMap((r): RemoteList[] => {
        if (r.deleted) return [r];
        const [l] = sanitizeLists({ lists: [r] }).lists;
        return l ? [{ ...l, share_id: r.share_id }] : [];
      });
      // Read after the await, with nothing async before the write below, so an edit made while
      // the request was in flight is part of the merge instead of being overwritten by it.
      const prev = loadState();
      const state0 = stateFor(prev, u.id);
      const plan = planSync(listsRef.current, remote, state0);
      const state = plan.state;
      // A link made or stopped while the request was in flight is not in `remote`: keep what
      // was stored for it, and let the sync that follows read the server again.
      if (linksBefore !== linkChanges.current && state0 === prev) {
        state.shares = prev.shares;
        again.current = true;
      }
      // State first: the effect that turns disappearing lists into tombstones reads it.
      save(state);
      if (plan.pulled) replaceLists(plan.lists);
      const held = Object.keys(state.others).length;
      if (state0 !== prev && held) {
        toast(
          `${held === 1 ? 'A list' : `${held} lists`} from another account ${held === 1 ? 'stays' : 'stay'} in this browser and ${held === 1 ? 'was' : 'were'} not added to this account.`,
        );
      }

      // From here on the stored state only changes through `patch`, one finished request at a time:
      // a list counts as synced once the server has it, and whatever else was stored meanwhile
      // (a deletion, a share link) is kept.
      let failed: string | null = null;
      for (const l of plan.push) {
        if (refused.current.get(l.id) === l.updated) {
          failed = 'A list could not be saved to your account';
          continue;
        }
        // deleted since the plan was made: nothing to send (its tombstone, if the server knew it, is stored)
        if (!listsRef.current.some((x) => x.id === l.id)) continue;
        try {
          await api.putList(u.id, l, summarize(l, db));
        } catch (e) {
          if (!isRefusal(e)) throw e;
          // 409: the server has a newer copy; the sync that follows takes it
          if (e.status === 409) again.current = true;
          else {
            refused.current.set(l.id, l.updated);
            failed = `"${l.name}" could not be saved to your account: ${e.message}`;
          }
          continue;
        }
        patch(u.id, (s) =>
          notePushed(
            s,
            l.id,
            l.updated,
            listsRef.current.some((x) => x.id === l.id),
          ),
        );
      }
      for (const d of plan.pushDeletes) {
        try {
          await api.deleteList(u.id, d.id, d.updated);
        } catch (e) {
          if (!isRefusal(e)) throw e;
          if (e.status === 409) again.current = true;
        }
        patch(u.id, (s) => {
          const { [d.id]: _sent, ...tombstones } = s.tombstones;
          return { ...s, tombstones };
        });
      }
      setLastSync(Date.now());
      setProblem(failed);
      setStatus(failed ? 'error' : 'idle');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Signed out elsewhere, or the session ran out: back to browser-only, lists untouched.
        // Or another tab signed in as someone else: asking again finds out, and syncs as them.
        again.current = false;
        setMe((m) => (m ? { ...m, user: null } : m));
        void refresh();
        return;
      }
      const offline = e instanceof ApiError && e.status === 0;
      setProblem(offline ? 'Offline: changes are saved in this browser and sync when you reconnect' : 'Sync failed. It will retry.');
      setStatus(offline ? 'offline' : 'error');
      // Coming back online has its own trigger below; anything else (a server fault, a rate limit) is tried again.
      if (!offline) retry.current = setTimeout(() => void sync(), RETRY_MS);
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void sync();
      }
    }
  }, [db, replaceLists, setMe, toast, refresh]);

  // Signing in (or loading the page signed in) syncs straight away.
  useEffect(() => {
    if (user) void sync();
    else {
      clearTimeout(retry.current);
      setStatus('off');
      setProblem(null);
      setShares({});
      setHeld({});
    }
  }, [user?.id, sync]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(retry.current), []);

  // A synced list that disappears from this browser was deleted here: remember to tell the server.
  const prevIds = useRef<string[]>(lists.map((l) => l.id));
  useEffect(() => {
    const ids = new Set(lists.map((l) => l.id));
    const gone = prevIds.current.filter((id) => !ids.has(id));
    prevIds.current = [...ids];
    if (!gone.length) return;
    // Signed in or not: a list deleted while signed out is still deleted when its account is back.
    const s = loadState();
    let next = s;
    for (const id of gone) next = noteDeleted(next, id);
    if (next !== s) save(next);
  }, [lists]);

  // Edits go up a moment after the last one.
  useEffect(() => {
    if (!user) return;
    const s = loadState();
    if (s.userId !== user.id || !hasUnsynced(lists, s)) return;
    const t = setTimeout(() => void sync(), 1500);
    return () => clearTimeout(t);
  }, [lists, user, sync]);

  // Coming back to the tab, or back online, picks up what other devices changed.
  useEffect(() => {
    if (!user) return;
    let last = Date.now();
    const on = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 15_000) return;
      last = Date.now();
      void sync();
    };
    const online = () => void sync();
    const timer = setInterval(on, 120_000);
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
      window.removeEventListener('online', online);
    };
  }, [user, sync]);

  const signOut = useCallback(
    async (removeLists: boolean) => {
      try {
        await api.logout();
      } catch {
        toast('Could not reach the server to sign out');
        return;
      }
      const s = loadState();
      const keep = removeLists ? listsRef.current.filter((l) => !(l.id in s.synced)) : listsRef.current;
      // The lists that stay remember their account, so the next person to sign in here does not get
      // them. Saved before the lists change: the ones removed from this browser only are no longer
      // in the state by then, so their going is not taken for a deletion.
      save(signedOutState(s, new Set(keep.map((l) => l.id))));
      if (removeLists) replaceLists(keep);
      setMe((m) => (m ? { ...m, user: null } : m));
      toast(removeLists ? 'Signed out. Synced lists were removed from this browser.' : 'Signed out. Your lists are still in this browser.');
    },
    [replaceLists, toast],
  );

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount();
    // the account's own lists now belong to nobody; ones held for another account stay held
    const s = loadState();
    save(emptySyncState(null, s.others, s.gone));
    setMe((m) => (m ? { ...m, user: null } : m));
    toast('Account deleted. Your lists are still in this browser.');
  }, [toast]);

  const publish = useCallback(
    async (listId: string) => {
      const l = listsRef.current.find((x) => x.id === listId);
      const u = userRef.current;
      if (!l || !u) throw new Error('No such list');
      // The server can only publish what it has, and at its latest.
      if (loadState().synced[listId] !== l.updated || running.current) await api.putList(u.id, l, summarize(l, db));
      const { id } = await api.publish(u.id, listId);
      linkChanges.current++;
      // sharing a held list uploaded it: it is this account's now
      const s = adoptList(loadState(), listId);
      save({ ...s, synced: { ...s.synced, [listId]: l.updated }, shares: { ...s.shares, [listId]: id } });
      return shareLinkUrl(id);
    },
    [db],
  );

  const unpublish = useCallback(async (listId: string) => {
    const u = userRef.current;
    if (!u) return;
    await api.unpublish(u.id, listId);
    linkChanges.current++;
    const s = loadState();
    const { [listId]: _gone, ...rest } = s.shares;
    save({ ...s, shares: rest });
  }, []);

  const adopt = useCallback(
    (listId: string) => {
      save(adoptList(loadState(), listId));
      void sync();
    },
    [sync],
  );

  const value = useMemo<Account>(
    () => ({
      backend,
      me,
      user,
      canSignIn: !!me && (me.providers.length > 0 || !!me.dev),
      status,
      problem,
      lastSync,
      shares,
      held,
      signInOpen,
      setSignInOpen,
      refresh,
      syncNow: () => void sync(),
      signOut,
      deleteAccount,
      publish,
      unpublish,
      adopt,
    }),
    [
      backend,
      me,
      user,
      status,
      problem,
      lastSync,
      shares,
      held,
      signInOpen,
      refresh,
      sync,
      signOut,
      deleteAccount,
      publish,
      unpublish,
      adopt,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
