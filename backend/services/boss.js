import PgBoss from 'pg-boss';
import dotenv from 'dotenv';

dotenv.config();

// NOTE TS - pg-boss manages its own internal schema (pgboss.*) inside our existing DB.
// It does NOT need a separate Pool — it creates its own connection using the
// connection string. We share the same DB, no extra service required.
const boss = new PgBoss({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  archiveCompletedAfterSeconds: 60 * 60 * 24 * 3,
  deleteAfterDays: 7,
});

boss.on('error', (err) => {
  console.error('[pg-boss] Unexpected error:', err);
});

//!!!!!!!!     singleton singleton
let started = false;
 // Returns the pg-boss instance, making sure it is singleton
 // would call this wherever you need to enqueue or subscribe to jobs.
export async function getBoss() {
  if (!started) {
    await boss.start();
    started = true;
    console.log('[pg-boss] Job queue started');
  }
  return boss;
}

export default boss;
