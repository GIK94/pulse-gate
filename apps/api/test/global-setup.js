// Creates the test database (if needed) and applies migrations once per test run.
const { Client } = require('pg');

module.exports = async () => {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://pulsegate:pulsegate@localhost:55432/pulsegate_test';
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  parsed.pathname = '/postgres';
  const admin = new Client({ connectionString: parsed.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();
  const { createPool, runMigrations } = require('@pulsegate/db');
  const pool = createPool({ connectionString: url, max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
};
