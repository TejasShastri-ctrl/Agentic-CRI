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

async function patch() {
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_last_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.last_updated_at = NOW();
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_threads_last_updated ON threads;
      
      CREATE TRIGGER trg_threads_last_updated
          BEFORE UPDATE ON threads
          FOR EACH ROW EXECUTE FUNCTION set_last_updated_at();
    `);
    console.log("Successfully patched the threads trigger in the database!");
  } catch (e) {
    console.error("Error patching database:", e);
  } finally {
    await pool.end();
  }
}

patch();
