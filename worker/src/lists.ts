import type { ListEntry, ListsResponse, PutListResponse, ShareLinkResponse } from '../../shared/api';
import { requireSession } from './auth';
import type { AppEnv, Ctx } from './env';
import { HttpError, badRequest, json, noContent, readJson } from './http';
import { enforce } from './ratelimit';
import { insertWithSlug, shareUrl } from './shares';
import * as v from './validate';

interface Row {
  id: string;
  name: string;
  items: string;
  created: number;
  updated: number;
  deleted: number;
  share_id?: string | null;
}

function toEntry(r: Row): ListEntry {
  if (r.deleted) return { id: r.id, updated: r.updated, deleted: true };
  return {
    id: r.id,
    name: r.name,
    items: JSON.parse(r.items),
    created: r.created,
    updated: r.updated,
    ...(r.share_id ? { share_id: r.share_id } : {}),
  };
}

async function loadRow(env: AppEnv, userId: string, id: string): Promise<Row | null> {
  return env.DB.prepare(
    `SELECT l.id, l.name, l.items, l.created, l.updated, l.deleted, s.id AS share_id
     FROM lists l LEFT JOIN shares s ON s.owner_id = l.user_id AND s.list_id = l.id
     WHERE l.user_id = ?1 AND l.id = ?2`,
  )
    .bind(userId, id)
    .first<Row>();
}

const conflict = (r: Row) => new HttpError(409, 'conflict', 'The stored list is newer', { list: toEntry(r) });

export async function getLists(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.items, l.created, l.updated, l.deleted, s.id AS share_id
     FROM lists l LEFT JOIN shares s ON s.owner_id = l.user_id AND s.list_id = l.id
     WHERE l.user_id = ?1 ORDER BY l.updated DESC`,
  )
    .bind(user.id)
    .all<Row>();
  const body: ListsResponse = { lists: results.map(toEntry) };
  return json(body);
}

/**
 * Last write wins on `updated`. A stored list with a newer `updated` is a 409 and nothing
 * changes; an equal `updated` is accepted (a retried request). A tombstone is revived only by
 * a strictly newer write.
 */
export async function putList(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const id = v.listId(c.params.id);
  const b = v.body(await readJson(c.request));
  const name = v.name(b.name);
  const { json: itemsJson } = v.items(b.items);
  const summary = v.summary(b.summary);
  const created = v.time(b.created, 'created', c.now);
  const updated = v.time(b.updated, 'updated', c.now);
  await enforce(c.env, 'listWrite', user.id, c.now);

  const existing = await loadRow(c.env, user.id, id);
  if (existing && (existing.deleted ? existing.updated >= updated : existing.updated > updated)) throw conflict(existing);
  if (!existing || existing.deleted) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?1 AND deleted = 0').bind(user.id).first<number>('n');
    if ((n ?? 0) >= v.MAX_LISTS) throw new HttpError(403, 'list_limit', `You can keep at most ${v.MAX_LISTS} lists`);
  }
  // The WHERE re-checks the rule atomically in case another write landed in between.
  const r = await c.env.DB.prepare(
    `INSERT INTO lists (user_id, id, name, items, summary, created, updated, deleted)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = excluded.name, items = excluded.items, summary = excluded.summary,
       created = excluded.created, updated = excluded.updated, deleted = 0
     WHERE (lists.deleted = 0 AND lists.updated <= excluded.updated) OR (lists.deleted = 1 AND lists.updated < excluded.updated)`,
  )
    .bind(user.id, id, name, itemsJson, JSON.stringify(summary), created, updated)
    .run();
  if (!r.meta.changes) {
    const now = await loadRow(c.env, user.id, id);
    if (now) throw conflict(now);
  }
  const body: PutListResponse = { updated };
  return json(body);
}

export async function deleteList(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const id = v.listId(c.params.id);
  let raw: unknown = c.url.searchParams.get('updated');
  if (raw !== null) raw = /^\d+$/.test(raw as string) ? Number(raw) : NaN;
  else if (c.request.headers.has('Content-Type')) raw = v.body(await readJson(c.request)).updated;
  else throw badRequest('Pass the deletion time as ?updated=<ms> or {"updated": <ms>}');
  const updated = v.time(raw, 'updated', c.now);
  await enforce(c.env, 'listWrite', user.id, c.now);

  const existing = await loadRow(c.env, user.id, id);
  if (existing && existing.updated > updated) throw conflict(existing);
  // A tombstone keeps only the id and the deletion time.
  const r = await c.env.DB.prepare(
    `INSERT INTO lists (user_id, id, name, items, summary, created, updated, deleted)
     VALUES (?1, ?2, '', '[]', NULL, ?3, ?3, 1)
     ON CONFLICT(user_id, id) DO UPDATE SET name = '', items = '[]', summary = NULL, updated = excluded.updated, deleted = 1
     WHERE lists.updated <= excluded.updated`,
  )
    .bind(user.id, id, updated)
    .run();
  if (!r.meta.changes) {
    const now = await loadRow(c.env, user.id, id);
    if (now) throw conflict(now);
  }
  // The live link (if any) goes with the list.
  await c.env.DB.prepare('DELETE FROM shares WHERE owner_id = ?1 AND list_id = ?2').bind(user.id, id).run();
  return noContent();
}

export async function publishList(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const id = v.listId(c.params.id);
  const row = await loadRow(c.env, user.id, id);
  if (!row || row.deleted) throw new HttpError(404, 'not_found', 'No such list');
  if (row.share_id) return json({ id: row.share_id, url: shareUrl(c.url, row.share_id) } satisfies ShareLinkResponse);
  await enforce(c.env, 'listWrite', user.id, c.now);
  const shareId = await insertWithSlug(async (sid) => {
    // OR IGNORE: an id collision, or a concurrent publish of the same list (unique owner + list)
    const r = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO shares (id, owner_id, list_id, name, items, summary, created, updated)
       VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4, ?4)`,
    )
      .bind(sid, user.id, id, c.now)
      .run();
    if (r.meta.changes) return sid;
    return c.env.DB.prepare('SELECT id FROM shares WHERE owner_id = ?1 AND list_id = ?2').bind(user.id, id).first<string>('id');
  });
  return json({ id: shareId, url: shareUrl(c.url, shareId) } satisfies ShareLinkResponse);
}

export async function unpublishList(c: Ctx): Promise<Response> {
  const { user } = await requireSession(c);
  const id = v.listId(c.params.id);
  await c.env.DB.prepare('DELETE FROM shares WHERE owner_id = ?1 AND list_id = ?2').bind(user.id, id).run();
  return noContent();
}
