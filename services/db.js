import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  password: "password",
  database: "mydb",
  port: 5431
})

pool.on('error', (err) => {
  console.error('Error at db connection pool', err);
});

pool.on('connect', function() {
  console.log("Database connection established");
})

export default pool;
