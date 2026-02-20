#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it before running db:migrate:postgres.');
  process.exit(1);
}

const defaultDataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const sqlitePath = process.env.SQLITE_PATH || path.join(defaultDataDir, 'buylist.db');
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite file not found at: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
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

  CREATE INDEX IF NOT EXISTS idx_market_history_item_source_time
    ON market_price_history (buylist_item_id, source, captured_at DESC);
`;

function currentMonthVersion() {
  return new Date().toISOString().slice(0, 7);
}

function tableHasColumn(tableName, columnName) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function rowsFor(tableName) {
  return sqlite.prepare(`SELECT * FROM ${tableName}`).all();
}

async function resetIdSequence(client, tableName) {
  await client.query(
    `SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 0), 1),
      COALESCE((SELECT MAX(id) FROM ${tableName}), 0) > 0
    )`,
    [tableName]
  );
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(POSTGRES_SCHEMA_SQL);
    await client.query(
      'TRUNCATE TABLE submission_items, market_price_history, submissions, faqs, games, app_settings RESTART IDENTITY CASCADE'
    );

    const games = rowsFor('games');
    for (const row of games) {
      await client.query(
        `INSERT INTO games
          (id, title, platform, condition_note, price_cents, active, pricecharting_product_id, market_source,
           market_last_checked_at, market_cib_price_cents, market_new_price_cents, market_loose_price_cents,
           market_item_url, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15)`,
        [
          row.id,
          row.title,
          row.platform || null,
          row.condition_note || 'CIB',
          row.price_cents,
          Number(row.active || 0),
          row.pricecharting_product_id || null,
          row.market_source || 'pricecharting',
          row.market_last_checked_at || null,
          row.market_cib_price_cents ?? null,
          row.market_new_price_cents ?? null,
          row.market_loose_price_cents ?? null,
          row.market_item_url || null,
          row.created_at || null,
          row.updated_at || row.created_at || null,
        ]
      );
    }

    const submissions = rowsFor('submissions');
    const hasSubmissionUpdatedAt = tableHasColumn('submissions', 'updated_at');
    const hasSubmissionStatus = tableHasColumn('submissions', 'status');
    const hasSubmissionPriceVersion = tableHasColumn('submissions', 'price_version');
    const hasSubmissionEstimatedTotal = tableHasColumn('submissions', 'estimated_total_cents');
    const hasSubmissionInternalNotes = tableHasColumn('submissions', 'internal_notes');

    for (const row of submissions) {
      await client.query(
        `INSERT INTO submissions
          (id, customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          row.id,
          row.customer_name,
          row.email || null,
          row.phone || null,
          row.notes || null,
          row.created_at || null,
          hasSubmissionUpdatedAt ? row.updated_at || row.created_at || null : row.created_at || null,
          hasSubmissionStatus ? row.status || 'Pending' : 'Pending',
          hasSubmissionPriceVersion ? row.price_version || currentMonthVersion() : currentMonthVersion(),
          hasSubmissionEstimatedTotal ? Number(row.estimated_total_cents || 0) : 0,
          hasSubmissionInternalNotes ? row.internal_notes || '' : '',
        ]
      );
    }

    const submissionItems = rowsFor('submission_items');
    const hasTitleAtSubmit = tableHasColumn('submission_items', 'title_at_submit');
    const hasPlatformAtSubmit = tableHasColumn('submission_items', 'platform_at_submit');
    const hasUnitPriceAtSubmit = tableHasColumn('submission_items', 'unit_price_cents_at_submit');
    const hasLineTotalAtSubmit = tableHasColumn('submission_items', 'line_total_cents_at_submit');

    for (const row of submissionItems) {
      const unitPrice = hasUnitPriceAtSubmit
        ? row.unit_price_cents_at_submit ?? row.price_cents_at_submission
        : row.price_cents_at_submission;
      const lineTotal = hasLineTotalAtSubmit
        ? row.line_total_cents_at_submit ?? Number(row.quantity || 0) * Number(unitPrice || 0)
        : Number(row.quantity || 0) * Number(unitPrice || 0);

      await client.query(
        `INSERT INTO submission_items
          (id, submission_id, game_id, quantity, price_cents_at_submission, title_at_submit,
           platform_at_submit, unit_price_cents_at_submit, line_total_cents_at_submit)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.id,
          row.submission_id,
          row.game_id,
          row.quantity,
          row.price_cents_at_submission,
          hasTitleAtSubmit ? row.title_at_submit || null : null,
          hasPlatformAtSubmit ? row.platform_at_submit || null : null,
          unitPrice,
          lineTotal,
        ]
      );
    }

    const faqs = rowsFor('faqs');
    for (const row of faqs) {
      await client.query(
        `INSERT INTO faqs
          (id, question, answer, sort_order, active, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7)`,
        [
          row.id,
          row.question,
          row.answer,
          Number(row.sort_order || 0),
          Number(row.active || 0),
          row.created_at || null,
          row.updated_at || row.created_at || null,
        ]
      );
    }

    const settings = rowsFor('app_settings');
    for (const row of settings) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = EXCLUDED.updated_at`,
        [row.key, row.value, row.updated_at || null]
      );
    }

    const hasMarketHistoryTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'market_price_history'")
      .get();
    if (hasMarketHistoryTable) {
      const history = rowsFor('market_price_history');
      for (const row of history) {
        await client.query(
          `INSERT INTO market_price_history
            (id, buylist_item_id, source, captured_at, cib_price_cents, new_price_cents, loose_price_cents)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7)`,
          [
            row.id,
            row.buylist_item_id,
            row.source || 'pricecharting',
            row.captured_at || null,
            row.cib_price_cents ?? null,
            row.new_price_cents ?? null,
            row.loose_price_cents ?? null,
          ]
        );
      }
    }

    if (!settings.some((row) => row.key === 'current_buylist_version')) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO NOTHING`,
        ['current_buylist_version', currentMonthVersion()]
      );
    }

    await resetIdSequence(client, 'games');
    await resetIdSequence(client, 'submissions');
    await resetIdSequence(client, 'submission_items');
    await resetIdSequence(client, 'faqs');
    await resetIdSequence(client, 'market_price_history');

    await client.query('COMMIT');

    console.log('Migration completed successfully.');
    console.log(`games: ${games.length}`);
    console.log(`submissions: ${submissions.length}`);
    console.log(`submission_items: ${submissionItems.length}`);
    console.log(`faqs: ${faqs.length}`);
    console.log(`app_settings: ${settings.length}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('SQLite -> Postgres migration failed.');
  console.error(error.message || error);
  process.exit(1);
});
