import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64url, sha256, sha256Hex } from '../src/crypto';
import type { AppEnv } from '../src/env';
import { LIMITS } from '../src/ratelimit';
import { Client, freshEmail, listBody, makeEnv, signIn, item, summary } from './helpers';

const DAY = 24 * 3600 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

function cookieAttrs(setCookie: string) {
  const [kv, ...rest] = setCookie.split(';').map((s) => s.trim());
  return { name: kv.slice(0, kv.indexOf('=')), value: kv.slice(kv.indexOf('=') + 1), attrs: rest.map((a) => a.toLowerCase()) };
}

// ---------------------------------------------------------------------------------------

describe('GET /api/me', () => {
  it('always answers 200 JSON, listing only configured providers', async () => {
    let r = await new Client().json('/api/me');
    expect(r).toMatchObject({ status: 200, body: { user: null, providers: [] } });
    expect(r.body.dev).toBeUndefined();
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');

    r = await new Client(makeEnv({ GOOGLE_CLIENT_ID: 'id' })).json('/api/me');
    expect(r.body.providers).toEqual([]); // secret missing: not configured
    r = await new Client(makeEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).json('/api/me');
    expect(r.body.providers).toEqual(['google']);
    r = await new Client(makeEnv({ EMAIL: { send: vi.fn() } as unknown as SendEmail })).json('/api/me');
    expect(r.body.providers).toEqual([]); // no EMAIL_FROM
    r = await new Client(mailEnv().env).json('/api/me');
    expect(r.body.providers).toEqual(['email']);
  });

  it('returns the signed-in user', async () => {
    const c = new Client();
    const email = freshEmail();
    const { userId } = await signIn(c, email);
    expect((await c.json('/api/me')).body.user).toEqual({ id: userId, email, name: null });
  });
});

describe('unknown API routes', () => {
  it('are JSON 404s, never the SPA shell', async () => {
    for (const path of ['/api/nope', '/api', '/api/lists/abc123/extra']) {
      const r = await new Client().json(path);
      expect(r.status).toBe(404);
      expect(r.res.headers.get('Content-Type')).toMatch(/application\/json/);
      expect(r.body.error.code).toBe('not_found');
    }
    const r = await new Client().json('/api/me', { method: 'PATCH', body: {} });
    expect(r.status).toBe(405);
  });

  it('non-API paths go to the assets binding', async () => {
    const res = await new Client().fetch('/item/foo');
    expect(await res.text()).toBe('asset /item/foo');
  });
});

// ---------------------------------------------------------------------------------------

describe('sessions', () => {
  it('logout deletes the session and clears the cookie', async () => {
    const c = new Client();
    const { token } = await signIn(c);
    const res = await c.fetch('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(204);
    const sc = cookieAttrs(res.headers.get('Set-Cookie')!);
    expect(sc).toMatchObject({ name: '__Host-session', value: '' });
    expect(sc.attrs).toContain('max-age=0');
    expect(
      await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ?1')
        .bind(await sha256Hex(token))
        .first(),
    ).toBeNull();
    // the old token no longer works even if replayed
    const replay = new Client();
    replay.cookies.set('__Host-session', token);
    expect((await replay.json('/api/me')).body.user).toBeNull();
  });

  it('expired sessions are refused and removed', async () => {
    const c = new Client();
    const { token } = await signIn(c);
    const hash = await sha256Hex(token);
    await env.DB.prepare('UPDATE sessions SET expires = ?2 WHERE token_hash = ?1')
      .bind(hash, Date.now() - 1000)
      .run();
    expect((await c.json('/api/lists')).status).toBe(401);
    expect(await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ?1').bind(hash).first()).toBeNull();
  });

  it('slides the 90-day expiry forward, at most once a day', async () => {
    const c = new Client();
    const { token } = await signIn(c);
    const hash = await sha256Hex(token);
    let res = await c.fetch('/api/me');
    expect(res.headers.get('Set-Cookie')).toBeNull(); // fresh: no write

    await env.DB.prepare('UPDATE sessions SET expires = ?2 WHERE token_hash = ?1')
      .bind(hash, Date.now() + 10 * DAY)
      .run();
    res = await c.fetch('/api/me');
    const sc = cookieAttrs(res.headers.get('Set-Cookie')!);
    expect(sc).toMatchObject({ name: '__Host-session', value: token });
    expect(sc.attrs).toContain('max-age=7776000');
    const { expires } = (await env.DB.prepare('SELECT expires FROM sessions WHERE token_hash = ?1')
      .bind(hash)
      .first<{ expires: number }>())!;
    expect(expires).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it('opportunistically cleans expired rows on sign-in', async () => {
    const { env: e } = mailEnv();
    const old = await signIn(new Client(e));
    await env.DB.prepare('UPDATE sessions SET expires = 1 WHERE token_hash = ?1')
      .bind(await sha256Hex(old.token))
      .run();
    const dev = new Client(makeEnv({ DEV_AUTH: '1' }), 'http://localhost:8787');
    await dev.fetch('/api/auth/dev', { method: 'POST', body: { email: freshEmail() } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires <= ?1').bind(Date.now()).first('n')).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------

describe('CSRF', () => {
  const share = { name: 'x', items: [item(1)], summary: summary() };

  it('refuses state-changing requests without a same-host Origin', async () => {
    const c = new Client();
    await signIn(c);
    for (const origin of [null, 'https://evil.example', 'https://gear.example.evil.com', 'null']) {
      const r = await c.json('/api/share', { method: 'POST', body: share, origin });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
    }
    expect((await c.json('/api/lists/abc123', { method: 'PUT', body: listBody(), origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.json('/api/me', { method: 'DELETE', origin: null })).status).toBe(403);
    expect((await c.json('/api/auth/logout', { method: 'POST', origin: 'https://evil.example' })).status).toBe(403);
    // still signed in
    expect((await c.json('/api/me')).body.user).not.toBeNull();
  });

  it('refuses bodies that are not application/json (what a cross-site form can send)', async () => {
    const c = new Client();
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await c.json('/api/share', { method: 'POST', rawBody: JSON.stringify(share), headers: { 'Content-Type': ct } });
      expect(r.status).toBe(415);
      expect(r.body.error.code).toBe('unsupported_media_type');
    }
    expect((await c.json('/api/share', { method: 'POST', rawBody: JSON.stringify(share) })).status).toBe(415);
  });
});

// ---------------------------------------------------------------------------------------

function mailEnv(over: Partial<AppEnv> = {}) {
  const send = vi.fn(async (_msg: unknown) => ({ messageId: 'm1' }));
  const e = makeEnv({ EMAIL: { send } as unknown as SendEmail, EMAIL_FROM: 'UL Gear DB <signin@gear.example>', ...over });
  return { env: e, send };
}

const linkFrom = (send: ReturnType<typeof mailEnv>['send'], call = 0) => {
  const msg = send.mock.calls[call][0] as { text: string };
  return new URL(/https?:\/\/\S+/.exec(msg.text)![0]);
};

describe('magic link', () => {
  it('emails a single-use link that signs in and redirects to the return path', async () => {
    const { env: e, send } = mailEnv();
    const c = new Client(e);
    const email = freshEmail('Mixed.Case');
    const r = await c.json('/api/auth/email/start', {
      method: 'POST',
      body: { email: `  ${email.toUpperCase()} `, return: '/lists?x=1#top' },
    });
    expect(r).toMatchObject({ status: 202, body: {} });
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as Record<string, unknown>;
    expect(msg.to).toBe(email.toLowerCase());
    expect(msg.from).toEqual({ email: 'signin@gear.example', name: 'UL Gear DB' });
    expect(msg.html).toContain('href="https://gear.example/api/auth/email/verify?token=');
    const link = linkFrom(send);
    expect(link.pathname).toBe('/api/auth/email/verify');

    // only the hash is stored
    const token = link.searchParams.get('token')!;
    expect(await env.DB.prepare('SELECT 1 FROM email_tokens WHERE token_hash = ?1').bind(token).first()).toBeNull();
    expect(
      await env.DB.prepare('SELECT 1 FROM email_tokens WHERE token_hash = ?1')
        .bind(await sha256Hex(token))
        .first(),
    ).not.toBeNull();

    const browser = new Client(e);
    const res = await browser.fetch(link.pathname + link.search);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/lists?x=1#top');
    const sc = cookieAttrs(res.headers.get('Set-Cookie')!);
    expect(sc.name).toBe('__Host-session');
    expect(sc.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sc.attrs).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'path=/', 'max-age=7776000']));
    expect(sc.attrs.some((a) => a.startsWith('domain'))).toBe(false);
    expect((await browser.json('/api/me')).body.user.email).toBe(email.toLowerCase());

    // second use fails
    const again = await new Client(e).fetch(link.pathname + link.search);
    expect(again.headers.get('Location')).toBe('/?auth_error=link_invalid');
    expect(again.headers.get('Set-Cookie')).toBeNull();
  });

  it('expires after 15 minutes', async () => {
    const { env: e, send } = mailEnv();
    await new Client(e).fetch('/api/auth/email/start', { method: 'POST', body: { email: freshEmail() } });
    const link = linkFrom(send);
    await env.DB.prepare('UPDATE email_tokens SET expires = ?2 WHERE token_hash = ?1')
      .bind(await sha256Hex(link.searchParams.get('token')!), Date.now() - 1)
      .run();
    const res = await new Client(e).fetch(link.pathname + link.search);
    expect(res.headers.get('Location')).toBe('/?auth_error=link_invalid');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('expiry is set 15 minutes out', async () => {
    const { env: e, send } = mailEnv();
    const before = Date.now();
    await new Client(e).fetch('/api/auth/email/start', { method: 'POST', body: { email: freshEmail() } });
    const row = await env.DB.prepare('SELECT expires FROM email_tokens WHERE token_hash = ?1')
      .bind(await sha256Hex(linkFrom(send).searchParams.get('token')!))
      .first<{ expires: number }>();
    expect(row!.expires - before).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(row!.expires - before).toBeLessThan(15 * 60 * 1000 + 5000);
  });

  it.each(['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x'])(
    'never redirects off-site (return=%s)',
    async (ret) => {
      const { env: e, send } = mailEnv();
      await new Client(e).fetch('/api/auth/email/start', { method: 'POST', body: { email: freshEmail(), return: ret } });
      const link = linkFrom(send);
      const loc = (await new Client(e).fetch(link.pathname + link.search)).headers.get('Location')!;
      expect(loc.startsWith('/')).toBe(true);
      expect(loc.startsWith('//')).toBe(false);
      expect(new URL(loc, 'https://gear.example').origin).toBe('https://gear.example');
    },
  );

  it('rejects garbage tokens', async () => {
    const { env: e } = mailEnv();
    for (const t of ['', 'abc', 'A'.repeat(43)]) {
      const res = await new Client(e).fetch(`/api/auth/email/verify?token=${t}`);
      expect(res.headers.get('Location')).toBe('/?auth_error=link_invalid');
    }
  });

  it('answers 202 even when sending fails, and does not log the address', async () => {
    const { env: e, send } = mailEnv();
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'E_SENDER_NOT_VERIFIED' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const email = freshEmail();
    expect((await new Client(e).fetch('/api/auth/email/start', { method: 'POST', body: { email } })).status).toBe(202);
    expect(JSON.stringify(log.mock.calls)).toContain('E_SENDER_NOT_VERIFIED');
    expect(JSON.stringify(log.mock.calls)).not.toContain(email);
  });

  it('limits links per address silently, and requests per IP with a 429', async () => {
    const { env: e, send } = mailEnv();
    const email = freshEmail();
    for (let i = 0; i < LIMITS.emailAddress.limit + 2; i++) {
      // a different IP each time: only the per-address limit applies
      const r = await new Client(e).json('/api/auth/email/start', { method: 'POST', body: { email } });
      expect(r.status).toBe(202);
    }
    expect(send).toHaveBeenCalledTimes(LIMITS.emailAddress.limit);

    const c = new Client(e);
    for (let i = 0; i < LIMITS.emailIp.limit; i++) {
      expect((await c.fetch('/api/auth/email/start', { method: 'POST', body: { email: freshEmail() } })).status).toBe(202);
    }
    const r = await c.json('/api/auth/email/start', { method: 'POST', body: { email: freshEmail() } });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('rate_limited');
  });

  it('validates the address and is off when no sender is configured', async () => {
    const { env: e } = mailEnv();
    expect((await new Client(e).json('/api/auth/email/start', { method: 'POST', body: { email: 'not an email' } })).status).toBe(400);
    const off = await new Client().json('/api/auth/email/start', { method: 'POST', body: { email: freshEmail() } });
    expect(off.status).toBe(404);
    expect(off.body.error.code).toBe('provider_disabled');
  });
});

// ---------------------------------------------------------------------------------------

const GOOGLE = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'shh' };

function idToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}.c2ln`;
}

function mockGoogle(claims: Record<string, unknown> = {}, status = 200) {
  const full = {
    iss: 'https://accounts.google.com',
    aud: GOOGLE.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'Hiker@Example.com',
    email_verified: true,
    name: 'Trail Name',
    ...claims,
  };
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ id_token: idToken(full), access_token: 'at' }), { status }));
}

async function startGoogle(c: Client, ret?: string) {
  const res = await c.fetch(`/api/auth/google/start${ret === undefined ? '' : `?return=${encodeURIComponent(ret)}`}`);
  expect(res.status).toBe(302);
  return new URL(res.headers.get('Location')!);
}

describe('Google sign-in', () => {
  it('redirects to Google with state and PKCE, and binds the state to a cookie', async () => {
    const c = new Client(makeEnv(GOOGLE));
    const loc = await startGoogle(c, '/lists');
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = loc.searchParams;
    expect(p.get('client_id')).toBe(GOOGLE.GOOGLE_CLIENT_ID);
    expect(p.get('redirect_uri')).toBe('https://gear.example/api/auth/google/callback');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('code_challenge_method')).toBe('S256');
    const state = p.get('state')!;
    expect(c.cookies.get('__Host-oauth')).toBe(state);
    const sc = cookieAttrs(c.setCookies[0]);
    expect(sc.attrs).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'path=/']));
    const row = await env.DB.prepare('SELECT verifier FROM oauth_states WHERE state_hash = ?1')
      .bind(await sha256Hex(state))
      .first<{ verifier: string }>();
    expect(p.get('code_challenge')).toBe(base64url(await sha256(row!.verifier)));
  });

  it('exchanges the code, creates the user and session, and returns to the path', async () => {
    const e = makeEnv(GOOGLE);
    const c = new Client(e);
    const loc = await startGoogle(c, '/lists');
    const fetchMock = mockGoogle({ email: `G.${Date.now()}@Example.com` });
    const res = await c.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/lists');
    expect(c.cookies.has('__Host-session')).toBe(true);
    expect(c.cookies.has('__Host-oauth')).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('code')).toBe('abc');
    expect(form.get('client_secret')).toBe('shh');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = (await c.json('/api/me')).body.user;
    expect(me.email).toMatch(/^g\.\d+@example\.com$/);
    expect(me.name).toBe('Trail Name');

    // the state is single-use
    const replay = new Client(e);
    replay.cookies.set('__Host-oauth', loc.searchParams.get('state')!);
    const r2 = await replay.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(r2.headers.get('Location')).toBe('/?auth_error=google_state');
  });

  it('Google and magic link for the same address reach the same account', async () => {
    const email = freshEmail('same');
    const { env: e, send } = mailEnv(GOOGLE);
    const g = new Client(e);
    const loc = await startGoogle(g);
    mockGoogle({ email: email.toUpperCase() });
    await g.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
    const viaGoogle = (await g.json('/api/me')).body.user.id;

    await new Client(e).fetch('/api/auth/email/start', { method: 'POST', body: { email } });
    const m = new Client(e);
    const link = linkFrom(send);
    await m.fetch(link.pathname + link.search);
    expect((await m.json('/api/me')).body.user.id).toBe(viaGoogle);
  });

  it.each([
    ['no state cookie', (c: Client) => c.cookies.delete('__Host-oauth')],
    ['a different state cookie', (c: Client) => c.cookies.set('__Host-oauth', 'B'.repeat(43))],
  ])('refuses a callback with %s', async (_l, tamper) => {
    const c = new Client(makeEnv(GOOGLE));
    const loc = await startGoogle(c);
    tamper(c);
    const fetchMock = mockGoogle();
    const res = await c.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(res.headers.get('Location')).toBe('/?auth_error=google_state');
    expect(c.cookies.has('__Host-session')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a forged state (cookie and query agree but were never issued)', async () => {
    const c = new Client(makeEnv(GOOGLE));
    const forged = 'C'.repeat(43);
    c.cookies.set('__Host-oauth', forged);
    const fetchMock = mockGoogle();
    const res = await c.fetch(`/api/auth/google/callback?code=abc&state=${forged}`);
    expect(res.headers.get('Location')).toBe('/?auth_error=google_state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an expired state', async () => {
    const c = new Client(makeEnv(GOOGLE));
    const loc = await startGoogle(c);
    const state = loc.searchParams.get('state')!;
    await env.DB.prepare('UPDATE oauth_states SET expires = 1 WHERE state_hash = ?1')
      .bind(await sha256Hex(state))
      .run();
    mockGoogle();
    expect((await c.fetch(`/api/auth/google/callback?code=abc&state=${state}`)).headers.get('Location')).toBe('/?auth_error=google_state');
  });

  it.each([
    ['wrong audience', { aud: 'someone-else' }],
    ['unverified email', { email_verified: false }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired token', { exp: 1000 }],
    ['no email', { email: undefined }],
  ])('refuses an ID token with %s', async (_l, claims) => {
    const c = new Client(makeEnv(GOOGLE));
    const loc = await startGoogle(c);
    mockGoogle(claims);
    const res = await c.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
    expect(res.headers.get('Location')).toBe('/?auth_error=google_failed');
    expect(c.cookies.has('__Host-session')).toBe(false);
  });

  it('handles a token endpoint error and a user who cancels', async () => {
    let c = new Client(makeEnv(GOOGLE));
    let loc = await startGoogle(c);
    mockGoogle({}, 400);
    expect((await c.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`)).headers.get('Location')).toBe(
      '/?auth_error=google_failed',
    );
    c = new Client(makeEnv(GOOGLE));
    loc = await startGoogle(c);
    expect(
      (await c.fetch(`/api/auth/google/callback?error=access_denied&state=${loc.searchParams.get('state')}`)).headers.get('Location'),
    ).toBe('/?auth_error=google_denied');
  });

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', '/\t/evil.example'])(
    'never redirects off-site after sign-in (return=%s)',
    async (ret) => {
      const c = new Client(makeEnv(GOOGLE));
      const loc = await startGoogle(c, ret);
      mockGoogle({ email: freshEmail() });
      const res = await c.fetch(`/api/auth/google/callback?code=abc&state=${loc.searchParams.get('state')}`);
      const target = res.headers.get('Location')!;
      expect(target).toBe('/');
      expect(c.cookies.has('__Host-session')).toBe(true);
    },
  );

  it('is off unless both client id and secret are set', async () => {
    const r = await new Client(makeEnv({ GOOGLE_CLIENT_ID: 'x' })).json('/api/auth/google/start');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('provider_disabled');
  });
});

// ---------------------------------------------------------------------------------------

describe('dev login', () => {
  const LOCAL = 'http://localhost:8787';

  it('works with DEV_AUTH=1 on localhost and sets a plain-named cookie', async () => {
    const c = new Client(makeEnv({ DEV_AUTH: '1' }), LOCAL);
    expect((await c.json('/api/me')).body.dev).toBe(true);
    const email = freshEmail();
    const r = await c.json('/api/auth/dev', { method: 'POST', body: { email } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ user: { email }, dev: true });
    const sc = cookieAttrs(c.setCookies[0]);
    expect(sc.name).toBe('session');
    expect(sc.attrs).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
    expect((await c.json('/api/me')).body.user.email).toBe(email);
  });

  it('is refused when DEV_AUTH is not set', async () => {
    const c = new Client(makeEnv(), LOCAL);
    const r = await c.json('/api/auth/dev', { method: 'POST', body: { email: freshEmail() } });
    expect(r.status).toBe(404);
    expect((await c.json('/api/me')).body.dev).toBeUndefined();
  });

  it.each(['https://gear.example', 'http://localhost.evil.example', 'https://ul-gear-db.someone.workers.dev'])(
    'is refused on a non-local host even with DEV_AUTH=1 (%s)',
    async (origin) => {
      const c = new Client(makeEnv({ DEV_AUTH: '1' }), origin);
      const r = await c.json('/api/auth/dev', { method: 'POST', body: { email: freshEmail() } });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('provider_disabled');
      expect((await c.json('/api/me')).body.dev).toBeUndefined();
    },
  );

  it('is refused for DEV_AUTH values other than "1"', async () => {
    const c = new Client(makeEnv({ DEV_AUTH: 'true' }), LOCAL);
    expect((await c.json('/api/auth/dev', { method: 'POST', body: { email: freshEmail() } })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------

describe('DELETE /api/me', () => {
  it('deletes the user with all their lists, links and sessions, and nothing else', async () => {
    const a = new Client();
    const { userId } = await signIn(a);
    const a2 = new Client();
    a2.cookies.set('__Host-session', (await signIn(new Client(), (await a.json('/api/me')).body.user.email)).token);

    await a.fetch('/api/lists/acct01', { method: 'PUT', body: listBody() });
    const live = (await a.json('/api/lists/acct01/publish', { method: 'PUT' })).body.id;
    const snap = (await a.json('/api/share', { method: 'POST', body: { name: 's', items: [], summary: summary() } })).body.id;

    const b = new Client();
    await signIn(b);
    await b.fetch('/api/lists/acct01', { method: 'PUT', body: listBody({ name: 'B keeps this' }) });
    const anon = (await new Client().json('/api/share', { method: 'POST', body: { name: 'anon', items: [], summary: summary() } })).body.id;

    expect((await a.json('/api/me', { method: 'DELETE', origin: 'https://evil.example' })).status).toBe(403);
    const res = await a.fetch('/api/me', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(cookieAttrs(res.headers.get('Set-Cookie')!).value).toBe('');

    for (const [table, col] of [
      ['users', 'id'],
      ['sessions', 'user_id'],
      ['lists', 'user_id'],
      ['shares', 'owner_id'],
    ]) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?1`).bind(userId).first('n')).toBe(0);
    }
    expect((await a2.json('/api/me')).body.user).toBeNull();
    expect((await new Client().json(`/api/share/${live}`)).status).toBe(404);
    expect((await new Client().json(`/api/share/${snap}`)).status).toBe(404);
    expect((await new Client().json(`/api/share/${anon}`)).status).toBe(200);
    expect((await b.json('/api/lists')).body.lists[0].name).toBe('B keeps this');
    expect((await a.json('/api/me', { method: 'DELETE' })).status).toBe(401);
  });
});
