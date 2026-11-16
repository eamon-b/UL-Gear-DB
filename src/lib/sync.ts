import type { PackList } from './types';

/** A list as the server returns it. A tombstone has only its id and the time of deletion. */
export type RemoteList = (PackList & { deleted?: undefined; share_id?: string }) | { id: string; updated: number; deleted: true };

/**
 * What this browser remembers about the account it last synced with.
 * `synced[id]` is the `updated` stamp at which the local and server copies of a list last agreed,
 * so a list whose `updated` differs has unsent edits. `tombstones[id]` is when a synced list was
 * deleted here, kept until the server has the deletion too. `others[id]` is the other account a
 * list in this browser was synced with: such a list stays here and is never uploaded to the
 * account now signed in, unless the user asks for that (`adopt`).
 */
export interface SyncState {
  userId: string | null;
  synced: Record<string, number>;
  tombstones: Record<string, number>;
  /** list id -> live share link id */
  shares: Record<string, string>;
  /** list id -> id of the other account the list belongs to */
  others: Record<string, string>;
}

export const emptySyncState = (userId: string | null = null, others: Record<string, string> = {}): SyncState => ({
  userId,
  synced: {},
  tombstones: {},
  shares: {},
  others,
});

export function sanitizeSyncState(v: unknown): SyncState {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const nums = (m: unknown) =>
    Object.fromEntries(
      Object.entries(m && typeof m === 'object' ? (m as Record<string, unknown>) : {}).filter(
        (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
      ),
    );
  const strs = (m: unknown) =>
    Object.fromEntries(
      Object.entries(m && typeof m === 'object' ? (m as Record<string, unknown>) : {}).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    );
  return {
    userId: typeof o.userId === 'string' ? o.userId : null,
    synced: nums(o.synced),
    tombstones: nums(o.tombstones),
    shares: strs(o.shares),
    others: strs(o.others),
  };
}

export interface SyncPlan {
  /** local lists after taking the server's newer copies, new lists and deletions */
  lists: PackList[];
  /** local lists the server lacks or has an older copy of */
  push: PackList[];
  /** deletions made here that the server has not seen */
  pushDeletes: { id: string; updated: number }[];
  /**
   * What is true before anything is pushed: a list in `push` is recorded at the stamp the server
   * holds (or not at all when the server has no copy), so it reads as unsynced until `notePushed`.
   */
  state: SyncState;
  /** how many local lists were replaced, added or removed, for the status line */
  pulled: number;
}

/**
 * Merge this browser's lists with the account's. Each list is one unit and the copy with the later
 * `updated` wins: lists are small and edited by one person, so per-list last-write-wins loses nothing
 * that a finer merge would keep in practice, and it cannot produce a half-merged list.
 *
 * Lists that exist only here are uploaded. That is what makes signing in for the first time keep
 * everything already built without an account.
 */
export function planSync(local: PackList[], remote: RemoteList[], prev: SyncState): SyncPlan {
  const byId = new Map(local.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out = new Map<string, PackList>();
  const push: PackList[] = [];
  const pushDeletes: SyncPlan['pushDeletes'] = [];
  const state = emptySyncState(prev.userId, Object.fromEntries(Object.entries(prev.others).filter(([id]) => byId.has(id))));
  let pulled = 0;

  for (const r of remote) {
    seen.add(r.id);
    const l = byId.get(r.id);
    const gone = prev.tombstones[r.id];
    if (r.deleted) {
      // Deleted on another device. An edit made here after that deletion brings the list back.
      if (l && l.updated > r.updated) {
        out.set(l.id, l);
        push.push(l);
      } else if (l) pulled++;
      continue;
    }
    if (r.share_id) state.shares[r.id] = r.share_id;
    if (l) {
      if (l.updated > r.updated) push.push(l);
      else if (l.updated < r.updated) pulled++;
      out.set(l.id, l.updated >= r.updated ? l : strip(r));
      // the server's stamp: a local copy that is newer stays unsynced until its push succeeds
      state.synced[l.id] = r.updated;
    } else if (gone != null && gone >= r.updated) {
      // Deleted here after the server's last edit: the deletion stands.
      pushDeletes.push({ id: r.id, updated: gone });
      state.tombstones[r.id] = gone;
      delete state.shares[r.id];
    } else {
      // New from another device, or edited there after being deleted here.
      out.set(r.id, strip(r));
      state.synced[r.id] = r.updated;
      pulled++;
    }
  }
  for (const l of local) {
    if (seen.has(l.id)) continue;
    out.set(l.id, l);
    // Another account's list (left here by "Sign out") is kept but not uploaded to this one.
    if (!(l.id in state.others)) push.push(l);
  }
  // Keep the order the user sees: existing lists stay put, lists from other devices go last.
  const lists = [...local.filter((l) => out.has(l.id)).map((l) => out.get(l.id)!), ...[...out.values()].filter((l) => !byId.has(l.id))];
  return { lists, push, pushDeletes, state, pulled };
}

const strip = (r: PackList): PackList => ({ id: r.id, name: r.name, items: r.items, created: r.created, updated: r.updated });

/** Does this browser hold anything the server has not been sent? */
export function hasUnsynced(local: PackList[], s: SyncState): boolean {
  return local.some((l) => !(l.id in s.others) && s.synced[l.id] !== l.updated) || Object.keys(s.tombstones).length > 0;
}

/**
 * A push reached the server. `still` says whether the list is still in this browser: one deleted
 * while the request was in flight is now on the server, which has to hear about the deletion next.
 */
export function notePushed(s: SyncState, id: string, updated: number, still: boolean, at = Date.now()): SyncState {
  if (still) return { ...s, synced: { ...s.synced, [id]: updated } };
  const { [id]: _a, ...synced } = s.synced;
  return { ...s, synced, tombstones: { ...s.tombstones, [id]: s.tombstones[id] ?? at } };
}

/** Every list `s` ties to an account, by that account: those held already plus what `s.userId` synced. */
function owners(s: SyncState): Record<string, string> {
  const others = { ...s.others };
  if (s.userId) for (const id of Object.keys(s.synced)) others[id] = s.userId;
  return others;
}

/**
 * The state to start from when `userId` is signed in. Unchanged for the account already synced with.
 * For a different one, the lists the previous account synced are held back (see `SyncState.others`),
 * so signing in on a shared computer does not copy someone else's lists into this account. Lists
 * that belong to `userId` from an earlier visit are released again.
 */
export function stateFor(prev: SyncState, userId: string): SyncState {
  if (prev.userId === userId) return prev;
  return emptySyncState(userId, Object.fromEntries(Object.entries(owners(prev)).filter(([, owner]) => owner !== userId)));
}

/** The state after signing out with the lists kept: nothing is synced, and each list keeps its owner. */
export const signedOutState = (prev: SyncState): SyncState => emptySyncState(null, owners(prev));

/** The user chose to add another account's list to the one signed in. */
export function adopt(s: SyncState, id: string): SyncState {
  const { [id]: _a, ...others } = s.others;
  return { ...s, others };
}

/** Record a deletion made here. Lists that never reached the server need no tombstone. */
export function noteDeleted(s: SyncState, id: string, at = Date.now()): SyncState {
  if (!(id in s.synced)) return s;
  const { [id]: _a, ...synced } = s.synced;
  const { [id]: _b, ...shares } = s.shares;
  return { ...s, synced, shares, tombstones: { ...s.tombstones, [id]: at } };
}
