import * as auth from './auth';
import type { AppEnv, Ctx } from './env';
import { HttpError, errorResponse, json } from './http';
import * as lists from './lists';
import { fetchShell, sharePage } from './preview';
import * as shares from './shares';

type Handler = (c: Ctx) => Promise<Response>;
type Route = [method: string, pattern: RegExp, handler: Handler];

const ID = '([^/]+)';
const routes: Route[] = [
  ['GET', /^\/api\/me$/, auth.me],
  ['DELETE', /^\/api\/me$/, auth.deleteAccount],
  ['POST', /^\/api\/auth\/logout$/, auth.logout],
  ['POST', /^\/api\/auth\/dev$/, auth.devLogin],
  ['POST', /^\/api\/auth\/email\/start$/, auth.emailStart],
  ['GET', /^\/api\/auth\/email\/verify$/, auth.emailVerify],
  ['GET', /^\/api\/auth\/google\/start$/, auth.googleStart],
  ['GET', /^\/api\/auth\/google\/callback$/, auth.googleCallback],
  ['POST', /^\/api\/share$/, shares.createShare],
  ['GET', new RegExp(`^/api/share/${ID}$`), shares.getShare],
  ['DELETE', new RegExp(`^/api/share/${ID}$`), shares.deleteShare],
  ['GET', /^\/api\/shares$/, shares.listShares],
  ['GET', /^\/api\/lists$/, lists.getLists],
  ['PUT', new RegExp(`^/api/lists/${ID}$`), lists.putList],
  ['DELETE', new RegExp(`^/api/lists/${ID}$`), lists.deleteList],
  ['PUT', new RegExp(`^/api/lists/${ID}/publish$`), lists.publishList],
  ['DELETE', new RegExp(`^/api/lists/${ID}/publish$`), lists.unpublishList],
];

const APP_ROUTE = /^\/(lists(\/[^/]*)?|search|compare|share)\/?$/;

/**
 * CSRF: every state-changing API request must come from a page on this host (Origin header),
 * and a body must be JSON (which a cross-site form cannot send without a CORS preflight).
 */
function checkCsrf(request: Request, url: URL): void {
  const origin = request.headers.get('Origin');
  let host: string | null = null;
  try {
    host = origin ? new URL(origin).host : null;
  } catch {
    host = null;
  }
  if (host !== url.host) throw new HttpError(403, 'forbidden', 'Cross-origin request refused');
  const hasBody = request.headers.has('Transfer-Encoding') || Number(request.headers.get('Content-Length') ?? 0) > 0;
  if (hasBody && !/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the body as Content-Type: application/json');
  }
}

async function api(c: Ctx): Promise<Response> {
  const method = c.request.method === 'HEAD' ? 'GET' : c.request.method;
  if (method !== 'GET') checkCsrf(c.request, c.url);
  let pathMatched = false;
  for (const [m, re, handler] of routes) {
    const match = re.exec(c.url.pathname);
    if (!match) continue;
    pathMatched = true;
    if (m !== method) continue;
    if (match[1] !== undefined) {
      try {
        c.params.id = decodeURIComponent(match[1]);
      } catch {
        throw new HttpError(404, 'not_found', 'No such resource');
      }
    }
    return handler(c);
  }
  if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  throw new HttpError(404, 'not_found', 'No such API endpoint');
}

export default {
  async fetch(request, env, exec): Promise<Response> {
    const url = new URL(request.url);
    const c: Ctx = { request, url, env, exec, params: {}, now: Date.now() };
    const path = url.pathname;
    if (path === '/api' || path.startsWith('/api/')) {
      try {
        return await api(c);
      } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        console.error(JSON.stringify({ message: 'unhandled error', path, error: e instanceof Error ? (e.stack ?? e.message) : String(e) }));
        return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
      }
    }
    const m = /^\/l\/([^/]*)\/?$/.exec(path);
    if (path.startsWith('/l/') && (request.method === 'GET' || request.method === 'HEAD')) {
      c.params.id = m ? m[1] : '';
      try {
        return await sharePage(c);
      } catch (e) {
        console.error(JSON.stringify({ message: 'share page failed', error: e instanceof Error ? e.message : String(e) }));
        return (await fetchShell(env, url)) ?? new Response('Site shell not found', { status: 500 });
      }
    }
    // Pages that only exist in the browser (see run_worker_first in wrangler.jsonc).
    if (APP_ROUTE.test(path) && (request.method === 'GET' || request.method === 'HEAD')) {
      const shell = await fetchShell(env, url);
      if (shell) return new Response(request.method === 'HEAD' ? null : shell.body, { status: 200, headers: shell.headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<AppEnv>;
