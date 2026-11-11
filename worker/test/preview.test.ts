import { describe, expect, it } from 'vitest';
import { describe as describeSummary } from '../src/preview';
import { Client, item, makeEnv, signIn, summary, listBody } from './helpers';

const meta = (html: string, attr: string, key: string) => {
  const all = [...html.matchAll(new RegExp(`<meta ${attr}="${key.replace(':', '\\:')}" content="([^"]*)"`, 'g'))].map((m) => m[1]);
  return all;
};

async function createShare(c: Client, name: string, s = summary()) {
  const { body } = await c.json('/api/share', { method: 'POST', body: { name, items: [item(1)], summary: s } });
  return body.id as string;
}

describe('summary text', () => {
  it('formats weight, count and cost', () => {
    expect(describeSummary(summary())).toBe('Base weight 4.21 kg (9.28 lb) · 37 items · $2,340');
    expect(describeSummary(summary({ cost: null, count: 1 }))).toBe('Base weight 4.21 kg (9.28 lb) · 1 item');
  });
});

describe('GET /l/:id', () => {
  it('serves the shell with preview tags replaced in place', async () => {
    const c = new Client();
    const id = await createShare(c, 'Wind River High Route');
    const res = await c.fetch(`/l/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(res.headers.get('ETag')).toBeNull();
    const html = await res.text();
    expect(html).toContain('<title>Wind River High Route</title>');
    expect(html).not.toContain('<title>UL Gear DB</title>');
    expect(meta(html, 'name', 'description')).toEqual(['Base weight 4.21 kg (9.28 lb) · 37 items · $2,340']);
    expect(meta(html, 'property', 'og:title')).toEqual(['Wind River High Route']);
    expect(meta(html, 'property', 'og:description')).toEqual(['Base weight 4.21 kg (9.28 lb) · 37 items · $2,340']);
    expect(meta(html, 'property', 'og:url')).toEqual([`https://gear.example/l/${id}`]);
    expect(meta(html, 'property', 'og:type')).toEqual(['website']);
    expect(meta(html, 'name', 'twitter:card')).toEqual(['summary']);
    expect(meta(html, 'name', 'robots')).toEqual(['noindex']);
    expect(html).toContain('<div id="root"></div>');
  });

  it('appends the tags when the shell has none', async () => {
    const env = makeEnv({}, '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    const c = new Client(env);
    const id = await createShare(c, 'Bare shell', summary({ cost: null }));
    const html = await (await c.fetch(`/l/${id}`)).text();
    expect(html).toContain('<title>Bare shell</title>');
    expect(meta(html, 'name', 'description')).toEqual(['Base weight 4.21 kg (9.28 lb) · 37 items']);
    expect(meta(html, 'property', 'og:title')).toEqual(['Bare shell']);
    expect(meta(html, 'name', 'robots')).toEqual(['noindex']);
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
  });

  it('prefers the empty shell (/404) over the prerendered home page', async () => {
    const home =
      '<html><head><title>Home</title><link rel="canonical" href="https://gear.example/"></head>' +
      '<body><div id="root" data-route="/"><h1>Prerendered</h1></div></body></html>';
    const empty =
      '<html><head><title>UL Gear DB</title><meta name="robots" content="noindex" /></head><body><div id="root"></div></body></html>';
    const c = new Client(makeEnv({}, home, { '/404': empty }));
    const id = await createShare(c, 'From the shell');
    const html = await (await c.fetch(`/l/${id}`)).text();
    expect(html).not.toContain('Prerendered');
    expect(html).not.toContain('canonical');
    expect(html).toContain('<title>From the shell</title>');
    expect(meta(html, 'name', 'robots')).toEqual(['noindex']);
    const missing = await c.fetch('/l/zzzzzzzz');
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('Prerendered');
  });

  it('escapes HTML in list names', async () => {
    const c = new Client();
    const evil = '</title><script>alert(1)</script>"><img src=x onerror=alert(2)>';
    const id = await createShare(c, evil);
    const html = await (await c.fetch(`/l/${id}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<title>/g)).toHaveLength(1);
    // still present, as text
    expect(html).toContain('&lt;script&gt;');

    // and in appended tags too
    const bare = new Client(makeEnv({}, '<html><head></head><body></body></html>'));
    const id2 = await createShare(bare, evil);
    const html2 = await (await bare.fetch(`/l/${id2}`)).text();
    expect(html2).not.toContain('<script>');
    expect(html2).not.toContain('<img');
    expect(html2.match(/<title>/g)).toHaveLength(1);
  });

  it('serves the shell with status 404 for an unknown id', async () => {
    const c = new Client();
    for (const path of ['/l/zzzzzzzz', '/l/', '/l/not-an-id/extra']) {
      const res = await c.fetch(path);
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain('<div id="root"></div>');
      expect(html).toContain('<title>UL Gear DB</title>');
      expect(meta(html, 'name', 'robots')).toEqual(['noindex']);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('shows the current content of a live link and 404s once the list is deleted', async () => {
    const c = new Client();
    await signIn(c);
    await c.fetch('/api/lists/live01', { method: 'PUT', body: listBody({ name: 'Before' }) });
    const { body: pub } = await c.json('/api/lists/live01/publish', { method: 'PUT' });
    expect(await (await c.fetch(`/l/${pub.id}`)).text()).toContain('<title>Before</title>');
    await c.fetch('/api/lists/live01', { method: 'PUT', body: listBody({ name: 'After', updated: 1_700_000_000_001 }) });
    const res = await c.fetch(`/l/${pub.id}`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('<title>After</title>');
    await c.fetch('/api/lists/live01?updated=1700000000002', { method: 'DELETE' });
    expect((await c.fetch(`/l/${pub.id}`)).status).toBe(404);
  });
});

describe('browser-only pages', () => {
  const home = '<html><head><title>Home</title></head><body><div id="root" data-route="/"><h1>Prerendered</h1></div></body></html>';
  const empty = '<html><head><title>UL Gear DB</title></head><body><div id="root"></div></body></html>';

  it('serves the empty shell with status 200', async () => {
    const c = new Client(makeEnv({}, home, { '/404': empty }));
    for (const path of ['/lists', '/lists/abc123xy', '/search?q=tent', '/compare?ids=a,b', '/share']) {
      const res = await c.fetch(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(empty);
    }
  });

  it('leaves every other path to the assets', async () => {
    const c = new Client(makeEnv({}, home, { '/404': empty }));
    expect(await (await c.fetch('/')).text()).toBe(home);
    expect(await (await c.fetch('/lists/a/b')).text()).toBe('asset /lists/a/b');
    expect(await (await c.fetch('/item/x')).text()).toBe('asset /item/x');
  });
});
