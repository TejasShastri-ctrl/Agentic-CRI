import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function reset() {
  try {
    await pool.query('TRUNCATE TABLE emails CASCADE;');
    await pool.query('TRUNCATE TABLE threads CASCADE;');
    await pool.query('TRUNCATE TABLE pgboss.job CASCADE;');
    console.log("✅ Successfully wiped emails, threads, and the job queue.");
    console.log("You can now safely run `node scripts/replay.js` for a fresh end-to-end pipeline test!");
  } catch (e) {
    console.error("❌ Failed to wipe database:", e);
  } finally {
    await pool.end();
  }
}

reset();
