import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// TEST_MIGRATIONS is a test-only binding added in vitest.config.ts
const { DB, TEST_MIGRATIONS } = env as Env & { TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(DB, TEST_MIGRATIONS);
