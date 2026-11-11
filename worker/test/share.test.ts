import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/ratelimit';
import { Client, item, signIn, summary } from './helpers';

const share = (over: Record<string, unknown> = {}) => ({ name: 'Sierra loop', items: [item(1), item(2)], summary: summary(), ...over });

describe('POST /api/share', () => {
  it('creates an immutable snapshot readable by anyone', async () => {
    const a = new Client();
    const { status, body, res } = await a.json('/api/share', { method: 'POST', body: share() });
    expect(status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body.id).toMatch(/^[23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    expect(body.url).toBe(`https://gear.example/l/${body.id}`);

    const got = await new Client().json(`/api/share/${body.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      id: body.id,
      name: 'Sierra loop',
      items: [item(1), item(2)],
      summary: summary(),
      live: false,
      updated: expect.any(Number),
    });
    expect(got.res.headers.get('Cache-Control')).toBe('public, max-age=60');

    const row = await env.DB.prepare('SELECT owner_id FROM shares WHERE id = ?1').bind(body.id).first();
    expect(row).toEqual({ owner_id: null });
  });

  it('records the owner when signed in', async () => {
    const a = new Client();
    const { userId } = await signIn(a);
    const { body } = await a.json('/api/share', { method: 'POST', body: share() });
    const row = await env.DB.prepare('SELECT owner_id FROM shares WHERE id = ?1').bind(body.id).first();
    expect(row).toEqual({ owner_id: userId });
  });

  it('404s for unknown and malformed ids, with a JSON error', async () => {
    const c = new Client();
    for (const id of ['zzzzzzzz', 'short', 'has space1', '../../etc']) {
      const r = await c.json(`/api/share/${encodeURIComponent(id)}`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
  });

  it.each([
    ['items not an array', { items: {} }, 400],
    ['an item that is not an object', { items: [item(1), 'x'] }, 400],
    ['an item that is an array', { items: [[1, 2]] }, 400],
    ['null item', { items: [null] }, 400],
    ['too many items', { items: Array.from({ length: 501 }, (_, i) => item(i)) }, 400],
    ['name too long', { name: 'x'.repeat(201) }, 400],
    ['name not a string', { name: 5 }, 400],
    ['negative weight', { summary: summary({ base_g: -1 }) }, 400],
    ['non-numeric count', { summary: { ...summary(), count: '3' } }, 400],
    ['missing summary', { summary: undefined }, 400],
    ['list over 200 KB', { items: Array.from({ length: 300 }, (_, i) => ({ ...item(i), note: 'x'.repeat(700) })) }, 413],
  ])('rejects %s', async (_label, over, status) => {
    const r = await new Client().json('/api/share', { method: 'POST', body: share(over) });
    expect(r.status).toBe(status);
    expect(r.body.error.code).toMatch(/bad_request|payload_too_large/);
  });

  it('accepts the limits exactly: 500 items, 200-character name, null cost', async () => {
    const r = await new Client().json('/api/share', {
      method: 'POST',
      body: share({ name: 'é'.repeat(200), items: Array.from({ length: 500 }, (_, i) => item(i)), summary: summary({ cost: null }) }),
    });
    expect(r.status).toBe(201);
  });

  it('rejects bodies that are not JSON', async () => {
    const c = new Client();
    expect((await c.json('/api/share', { method: 'POST', rawBody: '{nope', headers: { 'Content-Type': 'application/json' } })).status).toBe(
      400,
    );
    expect((await c.json('/api/share', { method: 'POST', rawBody: '[]', headers: { 'Content-Type': 'application/json' } })).status).toBe(
      400,
    );
  });

  it('rate-limits per IP', async () => {
    const c = new Client();
    const { limit } = LIMITS.share;
    for (let i = 0; i < limit; i++) expect((await c.fetch('/api/share', { method: 'POST', body: share() })).status).toBe(201);
    const r = await c.json('/api/share', { method: 'POST', body: share() });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('rate_limited');
    // another IP is unaffected
    expect((await new Client().fetch('/api/share', { method: 'POST', body: share() })).status).toBe(201);
  });
});

describe('GET /api/shares and DELETE /api/share/:id', () => {
  it('lists my links and lets only the owner delete them', async () => {
    const a = new Client();
    const b = new Client();
    await signIn(a);
    await signIn(b);
    const { body: s1 } = await a.json('/api/share', { method: 'POST', body: share({ name: 'one' }) });
    await new Client().json('/api/share', { method: 'POST', body: share({ name: 'anon' }) });

    const mine = await a.json('/api/shares');
    expect(mine.body.shares).toEqual([
      { id: s1.id, name: 'one', live: false, list_id: null, created: expect.any(Number), updated: expect.any(Number) },
    ]);
    expect((await b.json('/api/shares')).body.shares).toEqual([]);

    expect((await b.json(`/api/share/${s1.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await new Client().json(`/api/share/${s1.id}`, { method: 'DELETE' })).status).toBe(401);
    expect((await a.fetch(`/api/share/${s1.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await a.json(`/api/share/${s1.id}`)).status).toBe(404);
  });

  it('requires sign-in to list links', async () => {
    const r = await new Client().json('/api/shares');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthorized');
  });
});
