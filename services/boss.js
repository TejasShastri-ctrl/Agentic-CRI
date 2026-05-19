import PgBoss from 'pg-boss';
import dotenv from 'dotenv';

dotenv.config();

// pg-boss manages its own internal schema (pgboss.*) inside our existing DB.
// It does NOT need a separate Pool — it creates its own connection using the
// connection string. We share the same DB, no extra service required.
const boss = new PgBoss({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5431,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // Retention: keep completed jobs for 3 days, failed jobs for 7 days.
  // Keeps the pgboss.job table from growing unboundedly.
  archiveCompletedAfterSeconds: 60 * 60 * 24 * 3,
  deleteAfterDays: 7,
});

boss.on('error', (err) => {
  console.error('[pg-boss] Unexpected error:', err);
});

// Singleton state — boss.start() is idempotent but should only be called once.
let started = false;

/**
 * Returns the pg-boss instance, starting it if this is the first call.
 * Call this wherever you need to enqueue or subscribe to jobs.
 * Awaiting it guarantees the boss is ready before use.
 */
export async function getBoss() {
  if (!started) {
    await boss.start();
    started = true;
    console.log('[pg-boss] Job queue started');
  }
  return boss;
}

export default boss;
