# Worker

The Cloudflare Worker that serves the site: the static build (`../dist`) plus a small JSON API for short share links with link previews, optional accounts, and list sync. The request/response types are in [`../shared/api.ts`](../shared/api.ts).

The Worker runs only for `/api/*`, `/l/*` and the pages that exist only in the browser (`/lists`, `/search`, `/compare`, `/share`), which get the empty app shell (`dist/404.html`) with a 200 status. Every other path is a static file, and an unknown path gets the same shell with a 404 status.

## Local development

```bash
npm install                  # in worker/
cp .dev.vars.example .dev.vars
npm run migrate:local        # creates the local D1 database in .wrangler/
(cd .. && npm run build)     # the Worker serves ../dist
npm run dev                  # http://localhost:8787
```

With `DEV_AUTH=1` in `.dev.vars` you can sign in without any provider: `POST /api/auth/dev {"email": "..."}`. It only works for requests to localhost or 127.0.0.1. On plain `http://localhost` the session cookie is called `session`. In production it is `__Host-session`.

```bash
npm test          # Vitest in the Workers runtime (@cloudflare/vitest-plugin), D1 migrations applied
npm run typecheck # regenerates worker-configuration.d.ts (wrangler types), then tsc
```

## Configuration

Each sign-in method turns on only when it is configured. `GET /api/me` lists the configured ones in `providers`.

| Name | Kind | Enables |
| --- | --- | --- |
| `DB` | D1 binding (`wrangler.jsonc`) | Required. Users, sessions, lists, share links, rate limits. |
| `ASSETS` | assets binding (`wrangler.jsonc`) | Required. The static site from `../dist`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | Google sign-in (both required). |
| `EMAIL` | `send_email` binding (commented out in `wrangler.jsonc`) | Magic-link sign-in, together with `EMAIL_FROM`. |
| `EMAIL_FROM` | var in `wrangler.jsonc` | Sender of the magic links, e.g. `UL Gear DB <signin@example.com>`. Must be on a domain onboarded to Email Sending. |
| `DEV_AUTH` | `.dev.vars` only | `1` enables `POST /api/auth/dev` on localhost. Never set it in production. It is ignored for any other host anyway. |

Mail goes through `sendMail()` in `src/mail.ts`. To use another provider, change that function and `mailEnabled()`.

Rate limits (`src/ratelimit.ts`) are fixed-window counters in D1:

- 30 shares per IP per hour
- 10 magic-link requests per IP per hour
- 3 magic links per address per 15 minutes (extra requests still get `202` but send nothing)
- 1200 list writes per user per hour

The Workers Rate Limiting binding was not used, because it only supports 10 s and 60 s windows and its counts are approximate and per location.

## First deploy

1. `npx wrangler login`, then `npx wrangler d1 create ul-gear-db`. Put the printed `database_id` in `wrangler.jsonc`, replacing the all-zero placeholder.
2. `npm run migrate:remote`
3. Google sign-in (optional):
   1. In Google Cloud Console, go to APIs & Services, then Credentials, and create an OAuth client ID of type "Web application".
   2. Add the authorized redirect URI `https://<your-domain>/api/auth/google/callback`. Add `http://localhost:8787/api/auth/google/callback` too if you want to test it locally.
   3. Configure the consent screen with the scopes `openid`, `email` and `profile`.
   4. Run `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
4. Magic links (optional):
   - Email Sending needs the Workers Paid plan to send to arbitrary addresses, and the domain must use Cloudflare DNS.
   - Onboard the domain: in the dashboard, go to Compute, then Email Service, then Email Sending, and choose Onboard Domain. Or run `npx wrangler email sending enable <domain>`.
   - Uncomment `send_email` in `wrangler.jsonc`, and set `EMAIL_FROM` to an address on that domain.
5. Run `npx wrangler deploy` and attach your custom domain to the Worker.
6. For deploys from CI (`.github/workflows/deploy-cloudflare.yml`):
   - Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs these permissions: Workers Scripts Edit, D1 Edit, and Account Settings Read.
   - Add the repository variable `SITE_URL`, set to your domain.
   - Until both secrets exist, the workflow skips itself.

## Data stored

- **Per user:**
  - email (lower-cased, verified by Google or by the magic link)
  - display name from Google, if any
  - creation time
- **Sessions:** the SHA-256 of the session token, the user id, and the expiry (90 days, sliding).
- **Lists:** name, items, the client-computed summary (weights, count, cost), and created/updated times. A deleted list leaves a tombstone with only its id and deletion time, so other devices learn about the deletion.
- **Share links:**
  - snapshots store a copy of name, items and summary
  - live links store only the list they point to
  - anonymous snapshots have no owner
- **Short-lived rows, removed after use or expiry:**
  - magic-link tokens: hashed, with the address and return path, 15 min
  - OAuth state and PKCE verifier: 10 min
  - rate-limit counters: keyed by a hash of the IP or address

`DELETE /api/me` removes the user and every list, share link and session they own. Tokens and email addresses are never logged, and `observability.redact_query_string` keeps magic-link tokens and OAuth codes out of request logs.
