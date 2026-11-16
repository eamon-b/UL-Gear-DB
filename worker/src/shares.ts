import type { ShareInfo, ShareLinkResponse, SharedList, SharesResponse, Summary } from '../../shared/api';
import { ANON_SHARE_TTL, getSession, requireSession } from './auth';
import { randomSlug } from './crypto';
import type { AppEnv, Ctx } from './env';
import { HttpError, clientIp, json, noContent, readJson } from './http';
import { enforce } from './ratelimit';
import * as v from './validate';

/** Shape of share ids we hand out; anything else is a 404 without touching D1. */
export const SHARE_ID = /^[A-Za-z0-9]{8}$/;

export const shareUrl = (url: URL, id: string) => `${url.origin}/l/${id}`;

const EMPTY_SUMMARY: Summary = { base_g: 0, total_g: 0, count: 0, cost: null };

const parseSummary = (s: string | null): Summary => (s ? (JSON.parse(s) as Summary) : EMPTY_SUMMARY);

const DAY = 24 * 3600 * 1000;

/**
 * Resolves a share id to its content: the snapshot, or the live list's current state.
 * Opening an ownerless snapshot is noted (at most once a day), which is what keeps it from expiring.
 */
export async function loadShare(env: AppEnv, id: string, now: number): Promise<SharedList | null> {
  if (!SHARE_ID.test(id)) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.owner_id, s.list_id, s.name, s.items, s.summary, s.created, s.updated, s.seen,
            l.name AS l_name, l.items AS l_items, l.summary AS l_summary, l.updated AS l_updated, l.deleted AS l_deleted
     FROM shares s LEFT JOIN lists l ON s.list_id IS NOT NULL AND l.user_id = s.owner_id AND l.id = s.list_id
     WHERE s.id = ?1`,
  )
    .bind(id)
    .first<{
      id: string;
      owner_id: string | null;
      list_id: string | null;
      name: string | null;
      items: string | null;
      summary: string | null;
      created: number;
      updated: number;
      seen: number | null;
      l_name: string | null;
      l_items: string | null;
      l_summary: string | null;
      l_updated: number | null;
      l_deleted: number | null;
    }>();
  if (!row) return null;
  if (row.list_id === null) {
    if (row.owner_id === null) {
      const last = row.seen ?? row.created;
      // past its time but not yet cleaned up: gone all the same
      if (last <= now - ANON_SHARE_TTL) return null;
      if (last <= now - DAY) await env.DB.prepare('UPDATE shares SET seen = ?2 WHERE id = ?1').bind(id, now).run();
    }
    return {
      id: row.id,
      name: row.name ?? '',
      items: JSON.parse(row.items ?? '[]'),
      summary: parseSummary(row.summary),
      live: false,
      updated: row.updated,
    };
  }
  if (row.l_items === null || row.l_deleted) return null;
  return {
    id: row.id,
    name: row.l_name ?? '',
    items: JSON.parse(row.l_items),
    summary: parseSummary(row.l_summary),
    live: true,
    updated: row.l_updated ?? row.updated,
  };
}

/**
 * Inserts a row under a fresh random id, retrying on the (unlikely) id collision. `run`
 * returns the id that ended up stored, or null to retry with another one.
 */
export async function insertWithSlug(run: (id: string) => Promise<string | null>): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = await run(randomSlug());
    if (id) return id;
  }
  throw new Error('could not allocate a share id');
}

const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

export async function createShare(c: Ctx): Promise<Response> {
  await enforce(c.env, 'share', clientIp(c.request), c.now);
  const b = v.body(await readJson(c.request));
  const name = v.name(b.name);
  const { json: itemsJson } = v.items(b.items);
  const summary = v.summary(b.summary);
  const session = await getSession(c);
  // Ownerless snapshots are the one thing here anyone can add to without limit of their own, so
  // together they get a daily budget by size: with ANON_SHARE_TTL that bounds what they can ever
  // take up in the database. Past it the site falls back to links that carry the list in the URL.
  if (!session) {
    const kb = Math.max(1, Math.ceil(new TextEncoder().encode(itemsJson).byteLength / 1024));
    await enforce(c.env, 'shareAnonKb', 'all', c.now, kb);
  }
  const id = await insertWithSlug(async (id) => {
    try {
      await c.env.DB.prepare(
        `INSERT INTO shares (id, owner_id, list_id, name, items, summary, created, updated)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?6)`,
      )
        .bind(id, session?.user.id ?? null, name, itemsJson, JSON.stringify(summary), c.now)
        .run();
      return id;
    } catch (e) {
      if (isUniqueViolation(e)) return null;
      throw e;
    }
  });
  const body: ShareLinkResponse = { id, url: shareUrl(c.url, id) };
  return json(body, 201);
}

export async function getShare(c: Ctx): Promise<Response> {
  const s = await loadShare(c.env, c.params.id, c.now);
  if (!s) throw new HttpError(404, 'not_found', 'No such share link');
  // Snapshots never change (only get deleted), so a short public cache is safe.
  return json(s, 200, { 'Cache-Control': s.live ? 'no-store' : 'public, max-age=60' });
}

export async function listShares(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.list_id, s.name, s.created, s.updated, l.name AS l_name, l.updated AS l_updated
     FROM shares s LEFT JOIN lists l ON s.list_id IS NOT NULL AND l.user_id = s.owner_id AND l.id = s.list_id
     WHERE s.owner_id = ?1 ORDER BY s.created DESC`,
  )
    .bind(user.id)
    .all<{
      id: string;
      list_id: string | null;
      name: string | null;
      created: number;
      updated: number;
      l_name: string | null;
      l_updated: number | null;
    }>();
  const shares: ShareInfo[] = results.map((r) => ({
    id: r.id,
    name: (r.list_id ? r.l_name : r.name) ?? '',
    live: r.list_id !== null,
    list_id: r.list_id,
    created: r.created,
    updated: (r.list_id ? r.l_updated : r.updated) ?? r.updated,
  }));
  const body: SharesResponse = { shares };
  return json(body);
}

export async function deleteShare(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  // Not yours and not found look the same.
  const r = await c.env.DB.prepare('DELETE FROM shares WHERE id = ?1 AND owner_id = ?2').bind(c.params.id, user.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', 'No such share link');
  return noContent();
}
