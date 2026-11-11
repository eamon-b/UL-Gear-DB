import { sha256Hex } from './crypto';
import { HttpError } from './http';
import type { AppEnv } from './env';

/**
 * Fixed-window counters in D1. The Workers Rate Limiting binding only offers 10 s / 60 s
 * windows with approximate, per-location counts; the limits here are per hour / 15 min
 * (magic links per address, shares per IP) and need to be exact and testable offline.
 * One D1 write per limited request is cheap at this site's write volume.
 */
export const LIMITS = {
  /** POST /api/share, per IP */
  share: { limit: 30, windowSec: 3600 },
  /** POST /api/auth/email/start, per IP */
  emailIp: { limit: 10, windowSec: 3600 },
  /** magic links sent to one address */
  emailAddress: { limit: 3, windowSec: 900 },
  /** list writes (PUT/DELETE/publish), per user: generous, sync can be chatty */
  listWrite: { limit: 1200, windowSec: 3600 },
} as const;

export type Bucket = keyof typeof LIMITS;

/** Counts one hit; returns false when the subject is over the limit for this window. */
export async function hit(env: AppEnv, bucket: Bucket, subject: string, now: number): Promise<boolean> {
  const { limit, windowSec } = LIMITS[bucket];
  const windowMs = windowSec * 1000;
  const win = Math.floor(now / windowMs);
  // hashed: the table never holds raw IPs or email addresses
  const key = `${await sha256Hex(`${bucket}:${subject}`)}:${win}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, expires) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(key, (win + 1) * windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

export async function enforce(env: AppEnv, bucket: Bucket, subject: string, now: number): Promise<void> {
  if (!(await hit(env, bucket, subject, now))) {
    throw new HttpError(429, 'rate_limited', 'Too many requests. Try again later.');
  }
}
