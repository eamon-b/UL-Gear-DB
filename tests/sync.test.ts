import { describe, expect, it } from 'vitest';
import { emptySyncState, hasUnsynced, noteDeleted, planSync, sanitizeSyncState, type RemoteList } from '../src/lib/sync';
import type { PackList } from '../src/lib/types';

const list = (id: string, updated: number, name = id): PackList => ({ id, name, items: [], created: 1, updated });
const remote = (id: string, updated: number, extra: { name?: string; share_id?: string } = {}): RemoteList => ({
  ...list(id, updated),
  ...extra,
});
const dead = (id: string, updated: number): RemoteList => ({ id, updated, deleted: true });
const state = (over: Partial<ReturnType<typeof emptySyncState>> = {}) => ({ ...emptySyncState('u1'), ...over });

describe('planSync', () => {
  it('uploads everything on first sign-in and keeps it locally', () => {
    const local = [list('a', 10), list('b', 20)];
    const p = planSync(local, [], emptySyncState('u1'));
    expect(p.lists).toEqual(local);
    expect(p.push.map((l) => l.id)).toEqual(['a', 'b']);
    expect(p.state.synced).toEqual({ a: 10, b: 20 });
    expect(p.pulled).toBe(0);
  });

  it('adds lists from another device after the local ones', () => {
    const p = planSync([list('a', 10)], [remote('z', 5), remote('a', 10)], state({ synced: { a: 10 } }));
    expect(p.lists.map((l) => l.id)).toEqual(['a', 'z']);
    expect(p.push).toEqual([]);
    expect(p.pulled).toBe(1);
  });

  it('takes the newer copy in either direction', () => {
    const p = planSync([list('a', 10, 'old'), list('b', 30, 'mine')], [remote('a', 20, { name: 'theirs' }), remote('b', 20)], state());
    expect(p.lists.map((l) => l.name)).toEqual(['theirs', 'mine']);
    expect(p.push.map((l) => l.id)).toEqual(['b']);
    expect(p.state.synced).toEqual({ a: 20, b: 30 });
  });

  it('removes a list deleted elsewhere, unless it was edited here afterwards', () => {
    const gone = dead('a', 50);
    expect(planSync([list('a', 40)], [gone], state({ synced: { a: 40 } })).lists).toEqual([]);
    const p = planSync([list('a', 60)], [gone], state({ synced: { a: 40 } }));
    expect(p.lists.map((l) => l.id)).toEqual(['a']);
    expect(p.push.map((l) => l.id)).toEqual(['a']);
  });

  it('sends a local deletion, unless the server copy was edited afterwards', () => {
    const p = planSync([], [remote('a', 40)], state({ tombstones: { a: 50 } }));
    expect(p.lists).toEqual([]);
    expect(p.pushDeletes).toEqual([{ id: 'a', updated: 50 }]);
    const q = planSync([], [remote('a', 60)], state({ tombstones: { a: 50 } }));
    expect(q.lists.map((l) => l.id)).toEqual(['a']);
    expect(q.pushDeletes).toEqual([]);
    expect(q.state.tombstones).toEqual({});
  });

  it('drops tombstones the server already has or never knew', () => {
    const p = planSync([], [dead('a', 50)], state({ tombstones: { a: 50, never: 9 } }));
    expect(p.state.tombstones).toEqual({});
    expect(p.pushDeletes).toEqual([]);
  });

  it('tracks live share links and strips server-only fields from lists', () => {
    const p = planSync([], [remote('a', 5, { share_id: 'Ab3dEf9h' })], state());
    expect(p.state.shares).toEqual({ a: 'Ab3dEf9h' });
    expect(p.lists[0]).toEqual(list('a', 5));
  });
});

describe('sync state', () => {
  it('knows when there is something to send', () => {
    const s = state({ synced: { a: 10 } });
    expect(hasUnsynced([list('a', 10)], s)).toBe(false);
    expect(hasUnsynced([list('a', 11)], s)).toBe(true);
    expect(hasUnsynced([list('a', 10), list('new', 1)], s)).toBe(true);
    expect(hasUnsynced([], noteDeleted(s, 'a', 99))).toBe(true);
  });

  it('only tombstones lists the server has seen', () => {
    const s = state({ synced: { a: 10 }, shares: { a: 'x' } });
    expect(noteDeleted(s, 'local-only', 5)).toBe(s);
    expect(noteDeleted(s, 'a', 99)).toEqual(state({ tombstones: { a: 99 } }));
  });

  it('survives corrupt storage', () => {
    expect(sanitizeSyncState('nope')).toEqual(emptySyncState());
    expect(sanitizeSyncState({ userId: 3, synced: { a: 'x', b: 2 }, tombstones: null, shares: { a: 1, b: 'id' } })).toEqual({
      userId: null,
      synced: { b: 2 },
      tombstones: {},
      shares: { b: 'id' },
    });
  });
});
