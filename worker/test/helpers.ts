import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Summary } from '../../shared/api';
import { sha256Hex, randomToken } from '../src/crypto';
import type { AppEnv } from '../src/env';
import worker from '../src/index';
import { SESSION_TTL } from '../src/auth';

export const ORIGIN = 'https://gear.example';

export const SHELL =
  '<!doctype html><html><head><meta charset="utf-8"><title>UL Gear DB</title>' +
  '<meta name="description" content="An ultralight gear database">' +
  '<meta property="og:title" content="UL Gear DB"></head><body><div id="root"></div></body></html>';

/** Stand-in for the static-assets binding: '/' is the SPA shell, `files` adds other HTML paths. */
export function fakeAssets(shell = SHELL, files: Record<string, string> = {}): Fetcher {
  const pages: Record<string, string> = { '/': shell, ...files };
  const assets = {
    async fetch(input: RequestInfo | URL) {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const html = pages[url.pathname];
      if (html !== undefined) return new Response(html, { headers: { 'Content-Type': 'text/html', ETag: '"page"' } });
      return new Response(`asset ${url.pathname}`, { status: 200 });
    },
  };
  return assets as unknown as Fetcher;
}

export function makeEnv(over: Partial<AppEnv> = {}, shell?: string, files?: Record<string, string>): AppEnv {
  return { DB: env.DB, ASSETS: fakeAssets(shell, files), EMAIL_FROM: '', ...over };
}

let ipCounter = 0;
export const freshIp = () => `203.0.113.${++ipCounter % 250}:${Date.now()}:${Math.random()}`;
let emailCounter = 0;
export const freshEmail = (tag = 'u') => `${tag}${++emailCounter}.${Date.now()}@example.com`;

export interface Req {
  method?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** null: send no Origin header */
  origin?: string | null;
}

/** A browser stand-in: keeps cookies, sends Origin on non-GET requests like browsers do. */
export class Client {
  cookies = new Map<string, string>();
  setCookies: string[] = [];
  constructor(
    public env: AppEnv = makeEnv(),
    public origin = ORIGIN,
    public ip = freshIp(),
  ) {}

  async fetch(path: string, r: Req = {}): Promise<Response> {
    const method = r.method ?? 'GET';
    const headers = new Headers(r.headers);
    headers.set('CF-Connecting-IP', this.ip);
    if (this.cookies.size && !headers.has('Cookie')) {
      headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const origin = r.origin === undefined ? this.origin : r.origin;
    if (method !== 'GET' && method !== 'HEAD' && origin !== null && !headers.has('Origin')) headers.set('Origin', origin);
    let body: string | undefined = r.rawBody;
    if (r.body !== undefined) {
      body = JSON.stringify(r.body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const req = new Request(new URL(path, this.origin), { method, headers, body, redirect: 'manual' });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req as Parameters<typeof worker.fetch>[0], this.env, ctx);
    await waitOnExecutionContext(ctx);
    this.setCookies = res.headers.getSetCookie();
    for (const sc of this.setCookies) {
      const [kv, ...attrs] = sc.split(';').map((s) => s.trim());
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (!v || attrs.some((a) => /^max-age=0$/i.test(a))) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return res;
  }

  async json<T = any>(path: string, r: Req = {}): Promise<{ status: number; body: T; res: Response }> {
    const res = await this.fetch(path, r);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, res };
  }
}

/** Creates a user and a session directly in D1 and gives the client its cookie. */
export async function signIn(client: Client, email = freshEmail()): Promise<{ userId: string; token: string }> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO users (id, email, name, created) VALUES (?1, ?2, NULL, ?3)
     ON CONFLICT(email) DO UPDATE SET email = excluded.email RETURNING id`,
  )
    .bind(crypto.randomUUID(), email, now)
    .first<{ id: string }>();
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires, created) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), row!.id, now + SESSION_TTL, now)
    .run();
  const name = new URL(client.origin).protocol === 'https:' ? '__Host-session' : 'session';
  client.cookies.set(name, token);
  return { userId: row!.id, token };
}

export const summary = (over: Partial<Summary> = {}): Summary => ({ base_g: 4210, total_g: 6000, count: 37, cost: 2340, ...over });

export const item = (n = 0) => ({ uid: `u${n}`, dbId: `item-${n}`, qty: 1, worn: false, consumable: false });

export const listBody = (over: Record<string, unknown> = {}) => ({
  name: 'PCT 2026',
  items: [item(1), item(2)],
  created: 1_700_000_000_000,
  updated: 1_700_000_000_000,
  summary: summary(),
  ...over,
});
