import type { PackList } from './types';

/** A list as the server returns it. A tombstone has only its id and the time of deletion. */
export type RemoteList = (PackList & { deleted?: undefined; share_id?: string }) | { id: string; updated: number; deleted: true };

/**
 * What this browser remembers about the account it last synced with.
 * `synced[id]` is the `updated` stamp at which the local and server copies of a list last agreed,
 * so a list whose `updated` differs has unsent edits. `tombstones[id]` is when a synced list was
 * deleted here, kept until the server has the deletion too.
 */
export interface SyncState {
  userId: string | null;
  synced: Record<string, number>;
  tombstones: Record<string, number>;
  /** list id -> live share link id */
  shares: Record<string, string>;
}

export const emptySyncState = (userId: string | null = null): SyncState => ({ userId, synced: {}, tombstones: {}, shares: {} });

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
  };
}

export interface SyncPlan {
  /** local lists after taking the server's newer copies, new lists and deletions */
  lists: PackList[];
  /** local lists the server lacks or has an older copy of */
  push: PackList[];
  /** deletions made here that the server has not seen */
  pushDeletes: { id: string; updated: number }[];
  /** state to keep once every push has succeeded (pushes are assumed to succeed; see `afterPush`) */
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
  const state = emptySyncState(prev.userId);
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
        state.synced[l.id] = l.updated;
      } else if (l) pulled++;
      continue;
    }
    if (r.share_id) state.shares[r.id] = r.share_id;
    if (l) {
      if (l.updated > r.updated) push.push(l);
      else if (l.updated < r.updated) pulled++;
      const keep = l.updated >= r.updated ? l : strip(r);
      out.set(keep.id, keep);
      state.synced[keep.id] = keep.updated;
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
    push.push(l);
    state.synced[l.id] = l.updated;
  }
  // Keep the order the user sees: existing lists stay put, lists from other devices go last.
  const lists = [...local.filter((l) => out.has(l.id)).map((l) => out.get(l.id)!), ...[...out.values()].filter((l) => !byId.has(l.id))];
  return { lists, push, pushDeletes, state, pulled };
}

const strip = (r: PackList): PackList => ({ id: r.id, name: r.name, items: r.items, created: r.created, updated: r.updated });

/** Does this browser hold anything the server has not been sent? */
export function hasUnsynced(local: PackList[], s: SyncState): boolean {
  return local.some((l) => s.synced[l.id] !== l.updated) || Object.keys(s.tombstones).length > 0;
}

/** Record a deletion made here. Lists that never reached the server need no tombstone. */
export function noteDeleted(s: SyncState, id: string, at = Date.now()): SyncState {
  if (!(id in s.synced)) return s;
  const { [id]: _a, ...synced } = s.synced;
  const { [id]: _b, ...shares } = s.shares;
  return { ...s, synced, shares, tombstones: { ...s.tombstones, [id]: at } };
}
