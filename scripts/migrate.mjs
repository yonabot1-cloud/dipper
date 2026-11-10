// Runs db/schema.sql against the database before each build.
// Skips quietly when no database is connected yet.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL;

if (!url) {
  console.log('[migrate] No database URL yet — skipping.');
  process.exit(0);
}

const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const clean = url.replace(/[?&]sslmode=[^&]*/g, '');
const client = new pg.Client({ connectionString: clean, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('[migrate] Database is up to date.');
} catch (err) {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
