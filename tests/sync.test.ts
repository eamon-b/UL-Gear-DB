import { describe, expect, it } from 'vitest';
import {
  adopt,
  emptySyncState,
  hasUnsynced,
  noteDeleted,
  notePushed,
  planSync,
  sanitizeSyncState,
  signedOutState,
  stateFor,
  type RemoteList,
} from '../src/lib/sync';
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
    expect(p.pulled).toBe(0);
  });

  it('counts a list as synced only once the server has it', () => {
    // b is newer here, c is new here, d was deleted elsewhere and edited here since
    const local = [list('a', 10), list('b', 30), list('c', 5), list('d', 60)];
    const p = planSync(local, [remote('a', 10), remote('b', 20), dead('d', 50)], state());
    expect(p.push.map((l) => l.id)).toEqual(['b', 'd', 'c']);
    // before the pushes: b at the server's stamp, c and d not on the server at all
    expect(p.state.synced).toEqual({ a: 10, b: 20 });
    expect(hasUnsynced(local, p.state)).toBe(true);
    let s = p.state;
    for (const l of p.push) s = notePushed(s, l.id, l.updated, true);
    expect(s.synced).toEqual({ a: 10, b: 30, c: 5, d: 60 });
    expect(hasUnsynced(local, s)).toBe(false);
  });

  it('a list deleted while its push was in flight is deleted on the server next', () => {
    const p = planSync([list('a', 30), list('new', 5)], [remote('a', 20)], state());
    // "a" was known to the server: deleting it mid-push leaves a tombstone, which the push must not undo
    let s = noteDeleted(p.state, 'a', 99);
    s = notePushed(s, 'a', 30, false, 120);
    expect(s.synced).toEqual({});
    expect(s.tombstones).toEqual({ a: 99 });
    // "new" was not: its deletion left nothing, but the push has put it on the server
    s = notePushed(noteDeleted(s, 'new', 100), 'new', 5, false, 120);
    expect(s.tombstones).toEqual({ a: 99, new: 120 });
    const next = planSync([], [remote('a', 30), remote('new', 5)], s);
    expect(next.lists).toEqual([]);
    expect(next.pushDeletes).toEqual([
      { id: 'a', updated: 99 },
      { id: 'new', updated: 120 },
    ]);
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
    expect(p.state.synced).toEqual({ a: 20, b: 20 });
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

describe('lists from another account', () => {
  const mine = [list('a', 10), list('b', 20), list('fresh', 5)];
  // A synced a and b, then signed out and left them in the browser
  const left = signedOutState(state({ synced: { a: 10, b: 20 }, shares: { a: 'x' }, tombstones: { z: 1 } }));

  it('signing out keeps who the lists belong to and nothing else', () => {
    expect(left).toEqual(emptySyncState(null, { a: 'u1', b: 'u1' }));
  });

  it('are not uploaded when someone else signs in', () => {
    const s = stateFor(left, 'u2');
    expect(s).toEqual(emptySyncState('u2', { a: 'u1', b: 'u1' }));
    const p = planSync(mine, [], s);
    expect(p.lists).toEqual(mine);
    expect(p.push.map((l) => l.id)).toEqual(['fresh']);
    expect(p.state.others).toEqual({ a: 'u1', b: 'u1' });
    expect(hasUnsynced(mine, notePushed(p.state, 'fresh', 5, true))).toBe(false);
  });

  it('also when the first account was never signed out (its session ran out)', () => {
    const s = stateFor(state({ synced: { a: 10 } }), 'u2');
    expect(s.others).toEqual({ a: 'u1' });
    expect(planSync(mine, [], s).push.map((l) => l.id)).toEqual(['b', 'fresh']);
  });

  it('go back to syncing when their own account returns', () => {
    const back = stateFor(stateFor(left, 'u2'), 'u1');
    expect(back).toEqual(emptySyncState('u1'));
    expect(stateFor(left, 'u1')).toEqual(emptySyncState('u1'));
  });

  it('can be added to the new account on request, and are forgotten once gone', () => {
    const s = adopt(stateFor(left, 'u2'), 'a');
    expect(s.others).toEqual({ b: 'u1' });
    expect(planSync(mine, [], s).push.map((l) => l.id)).toEqual(['a', 'fresh']);
    expect(planSync([list('a', 10)], [], s).state.others).toEqual({});
  });

  it('a list deleted while signed out is deleted from its account when that account is back', () => {
    const now = 1_000_000;
    // signed out with a deletion still unsent (z), then b deleted too
    const out = noteDeleted(signedOutState(state({ synced: { a: 10, b: 20 }, tombstones: { z: now - 5 } }), undefined, now), 'b', now);
    expect(out.others).toEqual({ a: 'u1' });
    expect(out.gone).toEqual({ z: { owner: 'u1', at: now - 5 }, b: { owner: 'u1', at: now } });
    // someone else in between changes nothing about them
    const other = stateFor(out, 'u2', now);
    expect(other.tombstones).toEqual({});
    expect(planSync([list('a', 10)], [], other).state.gone).toEqual(out.gone);
    const back = stateFor(other, 'u1', now);
    expect(back.gone).toEqual({});
    const p = planSync([list('a', 10)], [remote('a', 10), remote('b', 20), remote('z', 3)], back);
    expect(p.lists.map((l) => l.id)).toEqual(['a']);
    expect(p.pushDeletes.map((d) => d.id).sort()).toEqual(['b', 'z']);
    // ...unless it waited longer than the server would remember a deletion
    expect(stateFor(out, 'u1', now + 181 * 24 * 3600 * 1000).tombstones).toEqual({});
  });

  it('a list deleted after the session ran out is a tombstone like any other', () => {
    expect(noteDeleted(state({ synced: { a: 10 } }), 'a', 99).tombstones).toEqual({ a: 99 });
  });

  it('removing the synced lists on sign-out, or a held list as someone else, deletes nothing from an account', () => {
    const out = signedOutState(state({ synced: { a: 10, b: 20 } }), new Set(['fresh']));
    expect(out.others).toEqual({});
    expect(noteDeleted(noteDeleted(out, 'a'), 'b')).toBe(out);
    const s = noteDeleted(stateFor(left, 'u2'), 'a', 50);
    expect(s.others).toEqual({ b: 'u1' });
    expect(s.gone).toEqual({});
    expect(s.tombstones).toEqual({});
  });

  it('the same account keeps its state', () => {
    const s = state({ synced: { a: 10 } });
    expect(stateFor(s, 'u1')).toBe(s);
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
      others: {},
      gone: {},
    });
  });
});
