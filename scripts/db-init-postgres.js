#!/usr/bin/env node
require('dotenv').config();

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it before running db:init:postgres.');
  process.exit(1);
}

const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslMode === 'disable' ? undefined : { rejectUnauthorized: false },
});

const POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    platform TEXT,
    condition_note TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    pricecharting_product_id TEXT,
    market_source TEXT DEFAULT 'pricecharting',
    market_last_checked_at TIMESTAMPTZ,
    market_cib_price_cents INTEGER,
    market_new_price_cents INTEGER,
    market_loose_price_cents INTEGER,
    market_item_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'Pending',
    price_version TEXT,
    estimated_total_cents INTEGER NOT NULL DEFAULT 0,
    internal_notes TEXT
  );

  CREATE TABLE IF NOT EXISTS submission_items (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    game_id INTEGER NOT NULL REFERENCES games(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_cents_at_submission INTEGER NOT NULL,
    title_at_submit TEXT,
    platform_at_submit TEXT,
    unit_price_cents_at_submit INTEGER,
    line_total_cents_at_submit INTEGER
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS market_price_history (
    id SERIAL PRIMARY KEY,
    buylist_item_id INTEGER NOT NULL REFERENCES games(id),
    source TEXT NOT NULL DEFAULT 'pricecharting',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cib_price_cents INTEGER,
    new_price_cents INTEGER,
    loose_price_cents INTEGER
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS buylist_snapshots (
    id SERIAL PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    item_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS buylist_snapshot_items (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES buylist_snapshots(id),
    game_key TEXT NOT NULL,
    title TEXT NOT NULL,
    platform TEXT,
    condition_note TEXT,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (snapshot_id, game_key)
  );

  CREATE INDEX IF NOT EXISTS idx_market_history_item_source_time
    ON market_price_history (buylist_item_id, source, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_buylist_snapshot_items_snapshot
    ON buylist_snapshot_items (snapshot_id);
`;

function currentMonthVersion() {
  return new Date().toISOString().slice(0, 7);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(POSTGRES_SCHEMA_SQL);
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      ['current_buylist_version', currentMonthVersion()]
    );
    await client.query('COMMIT');
    console.log('Postgres schema initialized successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to initialize Postgres schema.');
  console.error(error.message || error);
  process.exit(1);
});
