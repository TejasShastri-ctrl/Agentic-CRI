import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
})

pool.on('error', (err) => {
  console.error('Error at db connection pool', err);
});

pool.on('connect', function() {
  console.log("Database connection established");
})

export default pool;
