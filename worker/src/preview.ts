import type { SharedList, Summary } from '../../shared/api';
import type { Ctx } from './env';
import { loadShare, shareUrl } from './shares';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "Base weight 4.21 kg (9.28 lb) · 37 items · $2,340" */
export function describe(s: Summary): string {
  const kg = (s.base_g / 1000).toFixed(2);
  const lb = (s.base_g / 453.59237).toFixed(2);
  const n = Math.round(s.count);
  const parts = [`Base weight ${kg} kg (${lb} lb)`, `${n} ${n === 1 ? 'item' : 'items'}`];
  if (s.cost !== null) parts.push(usd.format(s.cost));
  return parts.join(' · ');
}

type Tag = { attr: 'name' | 'property'; key: string; value: string };

function previewTags(list: SharedList, url: string): Tag[] {
  const name = list.name.trim() || 'Pack list';
  const description = describe(list.summary);
  return [
    { attr: 'name', key: 'description', value: description },
    { attr: 'property', key: 'og:title', value: name },
    { attr: 'property', key: 'og:description', value: description },
    { attr: 'property', key: 'og:url', value: url },
    { attr: 'property', key: 'og:type', value: 'website' },
    { attr: 'name', key: 'twitter:card', value: 'summary' },
    { attr: 'name', key: 'robots', value: 'noindex' },
  ];
}

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const metaTag = (t: Tag) => `<meta ${t.attr}="${t.key}" content="${escapeAttr(t.value)}">`;

/**
 * Sets each tag's `content` in place when the shell already has it, and appends the rest
 * before </head>. List names are untrusted: setInnerContent escapes text, and every meta
 * tag is written through escapeAttr.
 */
function rewrite(res: Response, title: string | null, tags: Tag[]): Response {
  const pending = new Map(tags.map((t) => [`${t.attr}:${t.key.toLowerCase()}`, t]));
  let sawTitle = false;
  const rw = new HTMLRewriter()
    .on('title', {
      element(el) {
        if (sawTitle) return;
        sawTitle = true;
        if (title !== null) el.setInnerContent(title);
      },
    })
    .on('meta', {
      element(el) {
        for (const attr of ['name', 'property'] as const) {
          const key = el.getAttribute(attr)?.toLowerCase();
          if (!key) continue;
          const t = pending.get(`${attr}:${key}`);
          if (t) {
            // replaced whole rather than via setAttribute, which escapes only the quote character
            el.replace(metaTag(t), { html: true });
            pending.delete(`${attr}:${key}`);
            return;
          }
        }
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag((end) => {
          let html = '';
          if (!sawTitle && title !== null) html += `<title>${escapeAttr(title)}</title>`;
          for (const t of pending.values()) html += metaTag(t);
          if (html) end.before(html, { html: true });
        });
      },
    });
  return rw.transform(res);
}

const isHtml = (r: Response) => (r.headers.get('Content-Type') ?? '').includes('text/html');

/**
 * The app shell to serve. The build prerenders real pages into dist/index.html, so the empty
 * shell is dist/404.html (served at /404 with html_handling auto-trailing-slash). Builds
 * without it fall back to /, which then is the plain Vite shell.
 */
export async function fetchShell(env: Ctx['env'], url: URL): Promise<Response | null> {
  for (const path of ['/404', '/']) {
    const res = await env.ASSETS.fetch(new Request(new URL(path, url)));
    if (res.status < 500 && isHtml(res)) return res;
  }
  return null;
}

/** GET /l/:id: the SPA shell with link-preview tags for the shared list. */
export async function sharePage(c: Ctx): Promise<Response> {
  const shell = await fetchShell(c.env, c.url);
  if (!shell) return new Response('Site shell not found', { status: 500 });
  const id = c.params.id ?? '';
  const list = id ? await loadShare(c.env, id) : null;

  const headers = new Headers(shell.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', list && !list.live ? 'public, max-age=60' : 'no-store');
  headers.set('X-Robots-Tag', 'noindex');
  const base = new Response(c.request.method === 'HEAD' ? null : shell.body, { status: list ? 200 : 404, headers });
  if (c.request.method === 'HEAD') return base;

  if (!list) return rewrite(base, null, [{ attr: 'name', key: 'robots', value: 'noindex' }]);
  const title = list.name.trim() || 'Pack list';
  return rewrite(base, title, previewTags(list, shareUrl(c.url, list.id)));
}
