import type { AuthErrorCode, MeResponse, Provider, User } from '../../shared/api';
import { base64url, base64urlDecode, newId, randomToken, sha256, sha256Hex } from './crypto';
import type { AppEnv, Ctx } from './env';
import {
  HttpError,
  clearCookie,
  clientIp,
  isLocalHost,
  json,
  noContent,
  parseCookies,
  cookieName,
  readJson,
  redirect,
  safeReturnPath,
  setCookie,
} from './http';
import { mailEnabled, sendMail } from './mail';
import { hit, enforce } from './ratelimit';
import * as v from './validate';

const SESSION = 'session';
const OAUTH = 'oauth';
const DAY = 24 * 3600 * 1000;
export const SESSION_TTL = 90 * DAY;
/** Sliding expiry: refresh at most once a day so most requests don't write. */
const SESSION_REFRESH_AFTER = DAY;
const EMAIL_TOKEN_TTL = 15 * 60 * 1000;
const OAUTH_TTL = 10 * 60 * 1000;

// ---------------- providers ----------------

export const googleEnabled = (env: AppEnv) => !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;

/** Dev login needs DEV_AUTH=1 *and* a request to localhost, so a stray var in production does nothing. */
export const devEnabled = (env: AppEnv, url: URL) => env.DEV_AUTH === '1' && isLocalHost(url);

export function providers(env: AppEnv): Provider[] {
  const p: Provider[] = [];
  if (googleEnabled(env)) p.push('google');
  if (mailEnabled(env)) p.push('email');
  return p;
}

// ---------------- sessions ----------------

export interface Session {
  user: User;
  tokenHash: string;
  /** Set-Cookie to send back when the expiry slid forward */
  refreshCookie?: string;
}

export async function getSession(c: Ctx): Promise<Session | null> {
  const token = parseCookies(c.request).get(cookieName(c.url, SESSION));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.expires, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`,
  )
    .bind(tokenHash)
    .first<{ expires: number; id: string; email: string; name: string | null }>();
  if (!row) return null;
  if (row.expires <= c.now) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
    return null;
  }
  const s: Session = { user: { id: row.id, email: row.email, name: row.name }, tokenHash };
  if (row.expires - c.now < SESSION_TTL - SESSION_REFRESH_AFTER) {
    await c.env.DB.prepare('UPDATE sessions SET expires = ?2 WHERE token_hash = ?1')
      .bind(tokenHash, c.now + SESSION_TTL)
      .run();
    s.refreshCookie = setCookie(c.url, SESSION, token, SESSION_TTL / 1000);
  }
  return s;
}

export async function requireSession(c: Ctx): Promise<Session> {
  const s = await getSession(c);
  if (!s) throw new HttpError(401, 'unauthorized', 'Sign in first');
  return s;
}

/** Creates a session and returns its Set-Cookie header value. */
async function createSession(c: Ctx, userId: string): Promise<string> {
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires, created) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), userId, c.now + SESSION_TTL, c.now)
    .run();
  c.exec.waitUntil(cleanup(c.env, c.now));
  return setCookie(c.url, SESSION, token, SESSION_TTL / 1000);
}

/** Opportunistic cleanup of expired rows, run after each sign-in. */
export async function cleanup(env: AppEnv, now: number): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires <= ?1').bind(now),
      env.DB.prepare('DELETE FROM email_tokens WHERE expires <= ?1').bind(now),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires <= ?1').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires <= ?1').bind(now),
    ]);
  } catch (e) {
    console.error(JSON.stringify({ message: 'cleanup failed', error: e instanceof Error ? e.message : String(e) }));
  }
}

async function upsertUser(env: AppEnv, email: string, name: string | null, now: number): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO users (id, email, name, created) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET name = COALESCE(users.name, excluded.name)
     RETURNING id`,
  )
    .bind(newId(), email.toLowerCase(), name, now)
    .first<{ id: string }>();
  if (!row) throw new Error('user upsert returned nothing');
  return row.id;
}

// ---------------- /api/me, logout, delete account ----------------

export async function me(c: Ctx): Promise<Response> {
  const s = await getSession(c);
  const body: MeResponse = { user: s?.user ?? null, providers: providers(c.env) };
  if (devEnabled(c.env, c.url)) body.dev = true;
  return json(body, 200, s?.refreshCookie ? { 'Set-Cookie': s.refreshCookie } : undefined);
}

export async function logout(c: Ctx): Promise<Response> {
  const s = await getSession(c);
  if (s) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(s.tokenHash).run();
  return noContent({ 'Set-Cookie': clearCookie(c.url, SESSION) });
}

export async function deleteAccount(c: Ctx): Promise<Response> {
  const s = await requireSession(c);
  const id = s.user.id;
  // Explicit deletes (not just ON DELETE CASCADE) so nothing depends on foreign-key enforcement.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM shares WHERE owner_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM lists WHERE user_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id),
  ]);
  return noContent({ 'Set-Cookie': clearCookie(c.url, SESSION) });
}

// ---------------- dev login ----------------

export async function devLogin(c: Ctx): Promise<Response> {
  if (!devEnabled(c.env, c.url)) throw new HttpError(404, 'provider_disabled', 'Dev login is not enabled');
  const b = v.body(await readJson(c.request));
  const email = v.email(b.email);
  const userId = await upsertUser(c.env, email, null, c.now);
  const cookie = await createSession(c, userId);
  const user = await c.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(userId).first<User>();
  const body: MeResponse = { user, providers: providers(c.env), dev: true };
  return json(body, 200, { 'Set-Cookie': cookie });
}

// ---------------- magic link ----------------

export async function emailStart(c: Ctx): Promise<Response> {
  if (!mailEnabled(c.env)) throw new HttpError(404, 'provider_disabled', 'Email sign-in is not enabled');
  const b = v.body(await readJson(c.request));
  const email = v.email(b.email);
  const returnTo = safeReturnPath(b.return, c.url.origin);
  await enforce(c.env, 'emailIp', clientIp(c.request), c.now);
  // Over the per-address limit: answer exactly as if a link had been sent.
  if (await hit(c.env, 'emailAddress', email, c.now)) {
    const token = randomToken();
    await c.env.DB.prepare('INSERT INTO email_tokens (token_hash, email, return_to, expires) VALUES (?1, ?2, ?3, ?4)')
      .bind(await sha256Hex(token), email, returnTo, c.now + EMAIL_TOKEN_TTL)
      .run();
    const link = `${c.url.origin}/api/auth/email/verify?token=${token}`;
    const host = c.url.host;
    try {
      await sendMail(
        c.env,
        email,
        `Sign in to ${host}`,
        `Open this link to sign in to ${host}:\n\n${link}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
        `<p>Open this link to sign in to ${escapeHtml(host)}:</p><p><a href="${escapeHtml(link)}">Sign in</a></p>` +
          `<p>It works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`,
      );
    } catch (e) {
      // never log the address or the link
      const code = (e as { code?: unknown })?.code;
      console.error(JSON.stringify({ message: 'magic link send failed', code: typeof code === 'string' ? code : 'unknown' }));
    }
  }
  return json({}, 202);
}

export async function emailVerify(c: Ctx): Promise<Response> {
  const token = c.url.searchParams.get('token') ?? '';
  const fail = () => redirect(authErrorUrl('link_invalid'));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return fail();
  // DELETE ... RETURNING makes the token single-use even under concurrent clicks.
  const row = await c.env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ?1 RETURNING email, return_to, expires')
    .bind(await sha256Hex(token))
    .first<{ email: string; return_to: string; expires: number }>();
  if (!row || row.expires <= c.now) return fail();
  const userId = await upsertUser(c.env, row.email, null, c.now);
  const cookie = await createSession(c, userId);
  return redirect(safeReturnPath(row.return_to, c.url.origin), { 'Set-Cookie': cookie });
}

// ---------------- Google ----------------

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const authErrorUrl = (code: AuthErrorCode) => `/?auth_error=${code}`;
const callbackUrl = (url: URL) => `${url.origin}/api/auth/google/callback`;

export async function googleStart(c: Ctx): Promise<Response> {
  if (!googleEnabled(c.env)) throw new HttpError(404, 'provider_disabled', 'Google sign-in is not enabled');
  const returnTo = safeReturnPath(c.url.searchParams.get('return'), c.url.origin);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = base64url(await sha256(verifier));
  await c.env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, return_to, expires) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(state), verifier, returnTo, c.now + OAUTH_TTL)
    .run();
  const u = new URL(GOOGLE_AUTH);
  u.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(c.url),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  // The state is bound to this browser: the callback must present the same value in the cookie.
  return redirect(u.toString(), { 'Set-Cookie': setCookie(c.url, OAUTH, state, OAUTH_TTL / 1000) });
}

export async function googleCallback(c: Ctx): Promise<Response> {
  if (!googleEnabled(c.env)) throw new HttpError(404, 'provider_disabled', 'Google sign-in is not enabled');
  const clear = { 'Set-Cookie': clearCookie(c.url, OAUTH) };
  const fail = (code: AuthErrorCode) => redirect(authErrorUrl(code), clear);
  const q = c.url.searchParams;
  const state = q.get('state') ?? '';
  const cookieState = parseCookies(c.request).get(cookieName(c.url, OAUTH)) ?? '';
  if (!state || !timingSafeEqual(state, cookieState)) return fail('google_state');
  const row = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ?1 RETURNING verifier, return_to, expires')
    .bind(await sha256Hex(state))
    .first<{ verifier: string; return_to: string; expires: number }>();
  if (!row || row.expires <= c.now) return fail('google_state');
  if (q.get('error')) return fail('google_denied');
  const code = q.get('code');
  if (!code) return fail('google_failed');

  let claims: Record<string, unknown>;
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID!,
        client_secret: c.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: callbackUrl(c.url),
        grant_type: 'authorization_code',
        code_verifier: row.verifier,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    const tok = (await res.json()) as { id_token?: unknown };
    if (typeof tok.id_token !== 'string') throw new Error('no id_token');
    // The ID token came straight from Google's token endpoint over TLS, so per OpenID Connect
    // Core 3.1.3.7 the TLS connection authenticates it in place of a signature check. Still
    // check issuer, audience and expiry.
    claims = decodeJwtPayload(tok.id_token);
  } catch (e) {
    console.error(JSON.stringify({ message: 'google token exchange failed', error: e instanceof Error ? e.message : String(e) }));
    return fail('google_failed');
  }
  const iss = claims.iss;
  const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (
    (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') ||
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    exp <= c.now ||
    claims.email_verified !== true ||
    !email
  ) {
    return fail('google_failed');
  }
  const name = typeof claims.name === 'string' ? claims.name.slice(0, 200) : null;
  const userId = await upsertUser(c.env, email, name, c.now);
  const cookie = await createSession(c, userId);
  const h = new Headers();
  h.append('Set-Cookie', cookie);
  h.append('Set-Cookie', clear['Set-Cookie']);
  return redirect(safeReturnPath(row.return_to, c.url.origin), h);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const payload: unknown = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
  if (!payload || typeof payload !== 'object') throw new Error('malformed id_token');
  return payload as Record<string, unknown>;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
