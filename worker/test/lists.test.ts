import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MAX_LISTS } from '../src/validate';
import { Client, item, listBody, signIn } from './helpers';

const T = 1_700_000_000_000;

async function user() {
  const c = new Client();
  const s = await signIn(c);
  return Object.assign(c, s);
}

describe('auth', () => {
  it.each([
    ['GET', '/api/lists'],
    ['PUT', '/api/lists/abc123'],
    ['DELETE', '/api/lists/abc123?updated=1'],
    ['PUT', '/api/lists/abc123/publish'],
    ['DELETE', '/api/lists/abc123/publish'],
  ])('%s %s needs a session', async (method, path) => {
    const r = await new Client().json(path, { method, body: method === 'PUT' && !path.endsWith('publish') ? listBody() : undefined });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthorized');
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('a forged or unknown session cookie is not a session', async () => {
    const c = new Client();
    c.cookies.set('__Host-session', 'A'.repeat(43));
    expect((await c.json('/api/lists')).status).toBe(401);
    c.cookies.set('__Host-session', '<script>');
    expect((await c.json('/api/lists')).status).toBe(401);
  });
});

describe('PUT /api/lists/:id', () => {
  it('stores and returns a list', async () => {
    const c = await user();
    const put = await c.json('/api/lists/abc123', { method: 'PUT', body: listBody() });
    expect(put).toMatchObject({ status: 200, body: { updated: T } });
    const { body } = await c.json('/api/lists');
    expect(body.lists).toEqual([{ id: 'abc123', name: 'PCT 2026', items: [item(1), item(2)], created: T, updated: T }]);
  });

  it('last write wins on updated: newer and equal accepted, older is a 409 that changes nothing', async () => {
    const c = await user();
    await c.fetch('/api/lists/lww001', { method: 'PUT', body: listBody({ updated: T + 10 }) });
    expect((await c.json('/api/lists/lww001', { method: 'PUT', body: listBody({ name: 'newer', updated: T + 20 }) })).status).toBe(200);
    expect((await c.json('/api/lists/lww001', { method: 'PUT', body: listBody({ name: 'same time', updated: T + 20 }) })).status).toBe(200);
    const stale = await c.json('/api/lists/lww001', { method: 'PUT', body: listBody({ name: 'stale', updated: T + 5 }) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.list).toMatchObject({ id: 'lww001', name: 'same time', updated: T + 20 });
    expect((await c.json('/api/lists')).body.lists[0].name).toBe('same time');
  });

  it.each([
    ['bad id (uppercase)', '/api/lists/ABC123', {}],
    ['bad id (too short)', '/api/lists/abc', {}],
    ['bad id (too long)', `/api/lists/${'a'.repeat(33)}`, {}],
    ['updated not a number', '/api/lists/abc123', { updated: 'now' }],
    ['updated far in the future', '/api/lists/abc123', { updated: Date.now() + 3 * 24 * 3600 * 1000 }],
    ['negative created', '/api/lists/abc123', { created: -1 }],
    ['items with a non-object', '/api/lists/abc123', { items: [item(1), 3] }],
    ['summary with Infinity-ish string', '/api/lists/abc123', { summary: { base_g: 1, total_g: 1, count: 1, cost: 'free' } }],
  ])('400 for %s', async (_l, path, over) => {
    const c = await user();
    const r = await c.json(path, { method: 'PUT', body: listBody(over) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('bad_request');
  });

  it(`caps a user at ${MAX_LISTS} lists`, async () => {
    const c = await user();
    const stmt = env.DB.prepare(
      `INSERT INTO lists (user_id, id, name, items, summary, created, updated) VALUES (?1, ?2, 'x', '[]', NULL, 1, 1)`,
    );
    await env.DB.batch(Array.from({ length: MAX_LISTS }, (_, i) => stmt.bind(c.userId, `cap${String(i).padStart(4, '0')}`)));
    const r = await c.json('/api/lists/onemore', { method: 'PUT', body: listBody() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('list_limit');
    // updating an existing one is still fine
    expect((await c.json('/api/lists/cap0000', { method: 'PUT', body: listBody() })).status).toBe(200);
  });
});

describe('DELETE /api/lists/:id (tombstones)', () => {
  it('leaves a tombstone with no content that other devices see', async () => {
    const c = await user();
    await c.fetch('/api/lists/del001', { method: 'PUT', body: listBody({ updated: T }) });
    expect((await c.fetch(`/api/lists/del001?updated=${T + 1}`, { method: 'DELETE' })).status).toBe(204);
    expect((await c.json('/api/lists')).body.lists).toEqual([{ id: 'del001', updated: T + 1, deleted: true }]);
    const row = await env.DB.prepare('SELECT name, items, summary FROM lists WHERE id = ?1').bind('del001').first();
    expect(row).toEqual({ name: '', items: '[]', summary: null });
  });

  it('takes the time from a JSON body as well', async () => {
    const c = await user();
    await c.fetch('/api/lists/del002', { method: 'PUT', body: listBody() });
    expect((await c.fetch('/api/lists/del002', { method: 'DELETE', body: { updated: T + 1 } })).status).toBe(204);
    expect((await c.json('/api/lists/del002', { method: 'DELETE' })).status).toBe(400);
  });

  it('refuses a delete older than the stored edit (409)', async () => {
    const c = await user();
    await c.fetch('/api/lists/del003', { method: 'PUT', body: listBody({ updated: T + 50 }) });
    const r = await c.json(`/api/lists/del003?updated=${T + 10}`, { method: 'DELETE' });
    expect(r.status).toBe(409);
    expect(r.body.list).toMatchObject({ id: 'del003', updated: T + 50, name: 'PCT 2026' });
  });

  it('revives a tombstone only with a strictly newer write', async () => {
    const c = await user();
    await c.fetch('/api/lists/rev001', { method: 'PUT', body: listBody({ updated: T }) });
    await c.fetch(`/api/lists/rev001?updated=${T + 100}`, { method: 'DELETE' });
    const older = await c.json('/api/lists/rev001', { method: 'PUT', body: listBody({ updated: T + 50 }) });
    expect(older.status).toBe(409);
    expect(older.body.list).toEqual({ id: 'rev001', updated: T + 100, deleted: true });
    expect((await c.json('/api/lists/rev001', { method: 'PUT', body: listBody({ updated: T + 100 }) })).status).toBe(409);
    expect((await c.json('/api/lists/rev001', { method: 'PUT', body: listBody({ name: 'back', updated: T + 101 }) })).status).toBe(200);
    expect((await c.json('/api/lists')).body.lists).toEqual([expect.objectContaining({ id: 'rev001', name: 'back', updated: T + 101 })]);
  });

  it('records a tombstone for a list the server never saw', async () => {
    const c = await user();
    expect((await c.fetch(`/api/lists/never1?updated=${T}`, { method: 'DELETE' })).status).toBe(204);
    expect((await c.json('/api/lists')).body.lists).toEqual([{ id: 'never1', updated: T, deleted: true }]);
  });
});

describe('publish', () => {
  it('creates one live link per list, which follows the list', async () => {
    const c = await user();
    expect((await c.json('/api/lists/pub001/publish', { method: 'PUT' })).status).toBe(404);
    await c.fetch('/api/lists/pub001', { method: 'PUT', body: listBody({ name: 'v1' }) });
    const p1 = await c.json('/api/lists/pub001/publish', { method: 'PUT' });
    expect(p1.status).toBe(200);
    expect(p1.body.url).toBe(`https://gear.example/l/${p1.body.id}`);
    const p2 = await c.json('/api/lists/pub001/publish', { method: 'PUT' });
    expect(p2.body.id).toBe(p1.body.id);

    const anon = new Client();
    let got = await anon.json(`/api/share/${p1.body.id}`);
    expect(got.body).toMatchObject({ id: p1.body.id, name: 'v1', live: true, updated: T });
    expect(got.res.headers.get('Cache-Control')).toBe('no-store');

    await c.fetch('/api/lists/pub001', { method: 'PUT', body: listBody({ name: 'v2', items: [item(9)], updated: T + 1 }) });
    got = await anon.json(`/api/share/${p1.body.id}`);
    expect(got.body).toMatchObject({ name: 'v2', items: [item(9)], live: true, updated: T + 1 });

    const lists = (await c.json('/api/lists')).body.lists;
    expect(lists[0].share_id).toBe(p1.body.id);
    expect((await c.json('/api/shares')).body.shares).toEqual([
      { id: p1.body.id, name: 'v2', live: true, list_id: 'pub001', created: expect.any(Number), updated: T + 1 },
    ]);

    expect((await c.fetch('/api/lists/pub001/publish', { method: 'DELETE' })).status).toBe(204);
    expect((await anon.json(`/api/share/${p1.body.id}`)).status).toBe(404);
    expect((await c.json('/api/lists')).body.lists[0].share_id).toBeUndefined();
  });

  it('deleting the list kills its live link', async () => {
    const c = await user();
    await c.fetch('/api/lists/pub002', { method: 'PUT', body: listBody() });
    const { body } = await c.json('/api/lists/pub002/publish', { method: 'PUT' });
    await c.fetch(`/api/lists/pub002?updated=${T + 1}`, { method: 'DELETE' });
    expect((await new Client().json(`/api/share/${body.id}`)).status).toBe(404);
  });
});

describe('isolation', () => {
  it("users never see or change each other's lists", async () => {
    const a = await user();
    const b = await user();
    await a.fetch('/api/lists/same01', { method: 'PUT', body: listBody({ name: 'A list' }) });
    expect((await b.json('/api/lists')).body.lists).toEqual([]);
    // same id, other user: an independent list, not a conflict
    expect((await b.json('/api/lists/same01', { method: 'PUT', body: listBody({ name: 'B list', updated: T - 1 }) })).status).toBe(200);
    await b.fetch(`/api/lists/same01?updated=${T + 5}`, { method: 'DELETE' });
    expect((await a.json('/api/lists')).body.lists).toEqual([expect.objectContaining({ id: 'same01', name: 'A list' })]);
    // b cannot publish or unpublish a's list
    expect((await b.json('/api/lists/same01/publish', { method: 'PUT' })).status).toBe(404);
    const { body: pub } = await a.json('/api/lists/same01/publish', { method: 'PUT' });
    await b.fetch('/api/lists/same01/publish', { method: 'DELETE' });
    expect((await b.json(`/api/share/${pub.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await new Client().json(`/api/share/${pub.id}`)).body.name).toBe('A list');
  });
});
