import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrate } from '../src/lib/data';
import type { DB } from '../src/lib/types';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let db: DB | null = null;
/** The real bundle the app loads; `npm test` builds it first. */
export function loadTestDB(): DB {
  const file = path.join(ROOT, 'public/data/gear.json');
  if (!fs.existsSync(file)) throw new Error('public/data/gear.json is missing: run `npm run data` (or `npm test`, which runs it).');
  return (db ??= hydrate(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
