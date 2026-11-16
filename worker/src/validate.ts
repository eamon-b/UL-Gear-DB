import type { ApiListItem, Summary } from '../../shared/api';
import { HttpError, badRequest } from './http';

export const MAX_ITEMS = 500;
export const MAX_LIST_BYTES = 200 * 1024;
export const MAX_NAME = 200;
export const MAX_LISTS = 200;
/** Clocks drift, but an `updated` far in the future would win every last-write-wins race. */
export const MAX_CLOCK_SKEW = 24 * 3600 * 1000;

export const LIST_ID = /^[a-z0-9]{6,32}$/;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function body(v: unknown): Record<string, unknown> {
  if (!isPlainObject(v)) throw badRequest('Body must be a JSON object');
  return v;
}

export function name(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name must be a string');
  // count code points, not UTF-16 units
  if ([...v].length > MAX_NAME) throw badRequest(`name must be at most ${MAX_NAME} characters`);
  return v;
}

/** Returns the items and their serialized form (what gets stored). */
export function items(v: unknown): { items: ApiListItem[]; json: string } {
  if (!Array.isArray(v)) throw badRequest('items must be an array');
  if (v.length > MAX_ITEMS) throw badRequest(`A list can hold at most ${MAX_ITEMS} items`);
  for (const it of v) if (!isPlainObject(it)) throw badRequest('Each item must be an object');
  const json = JSON.stringify(v);
  if (new TextEncoder().encode(json).byteLength > MAX_LIST_BYTES) {
    throw new HttpError(413, 'payload_too_large', `A list can be at most ${MAX_LIST_BYTES / 1024} KB`);
  }
  return { items: v as ApiListItem[], json };
}

const nonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function summary(v: unknown): Summary {
  if (!isPlainObject(v)) throw badRequest('summary must be an object');
  const { base_g, total_g, count, cost } = v;
  if (!nonNeg(base_g) || !nonNeg(total_g) || !nonNeg(count)) {
    throw badRequest('summary.base_g, total_g and count must be finite non-negative numbers');
  }
  if (cost !== null && !nonNeg(cost)) throw badRequest('summary.cost must be null or a finite non-negative number');
  return { base_g, total_g, count, cost };
}

export function time(v: unknown, field: string, now: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw badRequest(`${field} must be a ms timestamp`);
  if (v > now + MAX_CLOCK_SKEW) throw badRequest(`${field} is in the future`);
  return v;
}

export function listId(v: string): string {
  if (!LIST_ID.test(v)) throw badRequest('List id must match ^[a-z0-9]{6,32}$');
  return v;
}

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

export function email(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('email must be a string');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw badRequest('That does not look like an email address');
  return e;
}
