/**
 * JSON contract between the site and the Worker API (worker/). Types only: no runtime
 * code and no imports, so both src/ and worker/ can import this file.
 *
 * All times are ms since the epoch. Every error response has the body `ApiError`.
 */

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export type ApiErrorCode =
  | 'bad_request' // 400: body or parameters failed validation
  | 'invalid_json' // 400: body is not JSON
  | 'unauthorized' // 401: sign-in required
  | 'forbidden' // 403: CSRF check failed (Origin missing or not this host)
  | 'list_limit' // 403: user already has the maximum number of lists
  | 'not_found' // 404: unknown route or resource
  | 'provider_disabled' // 404: that sign-in method is not configured here
  | 'method_not_allowed' // 405
  | 'conflict' // 409: stored list is newer (see ListConflict)
  | 'payload_too_large' // 413
  | 'unsupported_media_type' // 415: body without Content-Type: application/json
  | 'rate_limited' // 429
  | 'internal'; // 500

/** One row of a pack list. Opaque to the server: mirrors `ListItem` in src/lib/types.ts. */
export type ApiListItem = Record<string, unknown>;

/** Computed by the client (the server has no gear weights); used only for link-preview text. */
export interface Summary {
  base_g: number;
  total_g: number;
  count: number;
  cost: number | null;
}

export type Provider = 'google' | 'email';

export interface User {
  id: string;
  email: string;
  name: string | null;
}

// ---------- GET /api/me ----------
export interface MeResponse {
  user: User | null;
  /** sign-in methods configured in this environment */
  providers: Provider[];
  /** present only when the local dev login (POST /api/auth/dev) is available */
  dev?: true;
}

// ---------- Share links ----------
/** POST /api/share */
export interface CreateShareRequest {
  name: string;
  items: ApiListItem[];
  summary: Summary;
}
/** 201 from POST /api/share, 200 from PUT /api/lists/:id/publish */
export interface ShareLinkResponse {
  id: string;
  /** absolute URL of the share page, `${origin}/l/${id}` */
  url: string;
}
/** GET /api/share/:id */
export interface SharedList {
  id: string;
  name: string;
  items: ApiListItem[];
  summary: Summary;
  /** true: a published list that always shows its current content; false: a snapshot */
  live: boolean;
  updated: number;
}
/** GET /api/shares */
export interface ShareInfo {
  id: string;
  name: string;
  live: boolean;
  list_id: string | null;
  created: number;
  updated: number;
}
export interface SharesResponse {
  shares: ShareInfo[];
}

// ---------- List sync ----------
/** `id` matches /^[a-z0-9]{6,32}$/ */
export interface SyncedList {
  id: string;
  name: string;
  items: ApiListItem[];
  created: number;
  updated: number;
  /** id of the list's live share link, when published */
  share_id?: string;
}
/** A deleted list. `updated` is the deletion time. Name and items are not kept. */
export interface ListTombstone {
  id: string;
  updated: number;
  deleted: true;
}
export type ListEntry = SyncedList | ListTombstone;

/** GET /api/lists */
export interface ListsResponse {
  lists: ListEntry[];
}
/** PUT /api/lists/:id */
export interface PutListRequest {
  name: string;
  items: ApiListItem[];
  created: number;
  updated: number;
  summary: Summary;
}
/** 200 from PUT /api/lists/:id */
export interface PutListResponse {
  updated: number;
}
/** 409 from PUT or DELETE /api/lists/:id: the stored list is newer; nothing was changed */
export interface ListConflict extends ApiError {
  list: ListEntry;
}

// ---------- Auth ----------
/** POST /api/auth/email/start -> always 202 {} */
export interface EmailStartRequest {
  email: string;
  /** same-origin path to land on after sign-in, e.g. "/lists" */
  return?: string;
}
/** POST /api/auth/dev (local dev only) -> 200 MeResponse */
export interface DevLoginRequest {
  email: string;
}

/**
 * After a Google or magic-link sign-in fails, the browser is redirected to
 * `/?auth_error=<AuthErrorCode>`.
 */
export type AuthErrorCode = 'google_denied' | 'google_state' | 'google_failed' | 'link_invalid';

/*
 * Limits enforced by the server (400 bad_request / 413 payload_too_large / 403 list_limit):
 * - items: an array of plain objects, at most 500 per list
 * - JSON.stringify(items) at most 200 KB (204,800 bytes of UTF-8)
 * - name: at most 200 characters
 * - at most 200 lists per user (tombstones not counted)
 * - list ids: /^[a-z0-9]{6,32}$/
 * - created / updated: integers >= 0, `updated` at most 24 h in the future
 * - summary numbers: finite and >= 0 (cost may be null)
 */
