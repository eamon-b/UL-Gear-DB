import type { ApiErrorCode } from '../../shared/api';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function errorResponse(e: HttpError): Response {
  return json({ error: { code: e.code, message: e.message }, ...e.extra }, e.status);
}

export const noContent = (headers?: HeadersInit) => {
  const h = new Headers(headers);
  h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 204, headers: h });
};

export function redirect(location: string, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Location', location);
  h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers: h });
}

/** Largest body any endpoint accepts: a 200 KB list plus its name and summary. */
const MAX_BODY = 256 * 1024;

/** Reads a JSON body, refusing anything over MAX_BODY without buffering it. */
export async function readJson(request: Request): Promise<unknown> {
  const ct = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(ct)) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the body as Content-Type: application/json');
  }
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  if (!request.body) throw new HttpError(400, 'invalid_json', 'Request body is empty');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

export function parseCookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!out.has(k)) out.set(k, part.slice(i + 1).trim());
  }
  return out;
}

/** Plain http is only ever local dev (wrangler dev); production is always https. */
export const isSecure = (url: URL) => url.protocol === 'https:';

export const isLocalHost = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

export function cookieName(url: URL, base: string): string {
  return isSecure(url) ? `__Host-${base}` : base;
}

export function setCookie(url: URL, base: string, value: string, maxAgeSec: number): string {
  const attrs = [`${cookieName(url, base)}=${value}`, `Max-Age=${maxAgeSec}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (isSecure(url)) attrs.push('Secure');
  return attrs.join('; ');
}

export const clearCookie = (url: URL, base: string) => setCookie(url, base, '', 0);

/** Normalises a `return` value to a same-origin path, or '/' when it is anything else. */
export function safeReturnPath(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 2000) return '/';
  // Backslashes and control characters are treated as path separators / stripped by browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}

export const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';
