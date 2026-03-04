require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY || 'change-this-admin-key';
const isVercel = process.env.VERCEL === '1';
const configuredProvider = String(process.env.DB_PROVIDER || '').trim().toLowerCase();
const dbProvider =
  configuredProvider === 'postgres' || (!configuredProvider && process.env.DATABASE_URL) ? 'postgres' : 'sqlite';
const usingPostgres = dbProvider === 'postgres';
const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp' : path.join(__dirname, 'data'));
const shouldSeedSampleData = String(process.env.SEED_SAMPLE_DATA || (usingPostgres ? 'false' : 'true')).toLowerCase() === 'true';

let sqliteDb = null;
let pgPool = null;

if (usingPostgres) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DB_PROVIDER=postgres.');
  }

  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslMode === 'disable' ? undefined : { rejectUnauthorized: false },
  });
} else {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  sqliteDb = new Database(path.join(dataDir, 'buylist.db'));
  sqliteDb.pragma('journal_mode = WAL');
}

const isEphemeralStorage = !usingPostgres && isVercel && path.resolve(dataDir).startsWith('/tmp');
const persistentStorage = usingPostgres ? true : !isEphemeralStorage;

function quoteIdentifier(name) {
  return `"${String(name || '').replace(/"/g, '""')}"`;
}

function replaceSqliteNowFn(sql) {
  if (!usingPostgres) return sql;
  return String(sql).replace(/datetime\('now'\)/gi, 'NOW()');
}

function convertQuestionParams(sql, params) {
  if (!usingPostgres) {
    return {
      text: sql,
      values: params,
    };
  }

  let position = 0;
  let text = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'" && !inDoubleQuote) {
      text += ch;
      if (inSingleQuote && next === "'") {
        text += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      text += ch;
      if (inDoubleQuote && next === '"') {
        text += next;
        i += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }

    if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      position += 1;
      text += `$${position}`;
      continue;
    }

    text += ch;
  }

  return { text, values: params };
}

function createDbRunner(client = null) {
  async function all(sql, params = []) {
    const normalizedSql = replaceSqliteNowFn(sql);
    if (!usingPostgres) {
      return sqliteDb.prepare(normalizedSql).all(...params);
    }

    const { text, values } = convertQuestionParams(normalizedSql, params);
    const result = await (client || pgPool).query(text, values);
    return result.rows;
  }

  async function get(sql, params = []) {
    const rows = await all(sql, params);
    return rows[0] || null;
  }

  async function run(sql, params = []) {
    const normalizedSql = replaceSqliteNowFn(sql);
    if (!usingPostgres) {
      const info = sqliteDb.prepare(normalizedSql).run(...params);
      return {
        changes: Number(info.changes || 0),
        lastInsertRowid: info.lastInsertRowid === undefined ? null : Number(info.lastInsertRowid),
      };
    }

    const { text, values } = convertQuestionParams(normalizedSql, params);
    const result = await (client || pgPool).query(text, values);
    const first = result.rows && result.rows[0] ? result.rows[0] : null;
    const rowId = first && Object.prototype.hasOwnProperty.call(first, 'id') ? Number(first.id) : null;
    return {
      changes: Number(result.rowCount || 0),
      lastInsertRowid: Number.isFinite(rowId) ? rowId : null,
    };
  }

  async function exec(sql) {
    const normalizedSql = replaceSqliteNowFn(sql);
    if (!usingPostgres) {
      sqliteDb.exec(normalizedSql);
      return;
    }
    await (client || pgPool).query(normalizedSql);
  }

  return { all, get, run, exec };
}

const db = createDbRunner();

async function withTransaction(work) {
  if (!usingPostgres) {
    sqliteDb.exec('BEGIN');
    try {
      const result = await work(db);
      sqliteDb.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        sqliteDb.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw error;
    }
  }

  const client = await pgPool.connect();
  const txDb = createDbRunner(client);
  try {
    await client.query('BEGIN');
    const result = await work(txDb);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw error;
  } finally {
    client.release();
  }
}

async function ensureColumn(tableName, columnName, definition) {
  if (!usingPostgres) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    const exists = columns.some((column) => column.name === columnName);
    if (!exists) {
      await db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
    return;
  }

  const exists = await db.get(
    `SELECT 1 AS present
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  if (!exists) {
    await db.run(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
  }
}

async function setDefaultSetting(key, value) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (key) DO NOTHING`,
    [key, String(value)]
  );
}

async function upsertSettingValue(key, value) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, String(value)]
  );
}

async function getSettingValue(key, fallback) {
  try {
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row ? row.value : fallback;
  } catch (error) {
    console.error(`Setting read failed for "${key}", using fallback.`, error);
    return fallback;
  }
}

function parsePriceToCents(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function normalizeCondition(raw) {
  const value = safeString(raw);
  return value || 'CIB';
}

function normalizePlatform(raw) {
  const original = safeString(raw);
  if (!original) return '';

  const platform = original.toLowerCase().replace(/\s+/g, ' ');
  if (platform.includes('wii u') || platform.includes('wiiu')) return 'Wii U';
  if (platform === 'wii' || platform.includes('nintendo wii')) return 'Wii';
  if (platform === 'ps4' || platform.includes('playstation 4') || platform.includes('playstation4')) return 'PS4';
  if (platform === 'ps3' || platform.includes('playstation 3') || platform.includes('playstation3')) return 'PS3';
  if (platform === 'ps2' || platform.includes('playstation 2') || platform.includes('playstation2')) return 'PS2';
  if (platform === 'xbox' || platform.includes('og xbox') || platform.includes('original xbox')) return 'OG Xbox';
  if (platform.includes('xbox 360') || platform === '360') return 'Xbox 360';
  if (platform.includes('xbox one') || platform.includes('xboxone') || platform.includes('xbox 1')) return 'Xbox One';
  if (platform.includes('nintendo switch') || platform === 'switch' || platform.startsWith('switch ')) {
    return 'Nintendo Switch';
  }
  if (platform.includes('3ds')) return '3DS';
  if (platform.includes('ds')) return 'DS';
  return original;
}

function currentMonthVersion() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeBuylistVersion(raw) {
  const value = safeString(raw);
  if (!value) return currentMonthVersion();
  return /^\d{4}-\d{2}$/.test(value) ? value : currentMonthVersion();
}

function normalizeSubmissionStatus(raw) {
  const value = safeString(raw).toLowerCase();
  if (value === 'received') return 'Received';
  if (value === 'paid') return 'Paid';
  if (value === 'rejected') return 'Rejected';
  return 'Pending';
}

function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function rowsToCsv(rows) {
  return `${rows.map((row) => row.map((v) => escapeCsvValue(v)).join(',')).join('\n')}\n`;
}

function centsToMoney(cents) {
  if (!Number.isInteger(cents)) return null;
  return (cents / 100).toFixed(2);
}

function safeString(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

function normalizeUpc(raw) {
  const digits = String(raw ?? '')
    .replace(/\D+/g, '')
    .trim();
  return digits || null;
}

function normalizeNotes(raw, maxLength = 1000) {
  return safeString(raw).slice(0, maxLength);
}

function normalizeHotValue(raw) {
  return toSettingBoolean(raw, false);
}

function toSettingBoolean(raw, fallback = true) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  const value = safeString(raw).toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(value)) return false;
  return fallback;
}

const DEFAULT_PACKING_NEXT_STEPS_TEXT = [
  '- We have received your submission. Thank you for submitting.',
  '- Please allow 24-48 hours for payout via PayPal after shipment processing.',
  '- Shipments submitted on Friday are expected to be paid by Tuesday evening at the latest.',
  '- We do not process payouts on weekends (business days only).',
].join('\n');

const PACKING_SLIP_SETTING_LIMITS = {
  ship_to_business_name: 120,
  ship_to_contact_name: 120,
  ship_to_address_line1: 120,
  ship_to_address_line2: 120,
  ship_to_city: 80,
  ship_to_state: 80,
  ship_to_postal_code: 24,
  ship_to_country: 80,
  packing_next_steps_text: 2000,
};

function sanitizeSettingText(raw, maxLength) {
  return safeString(raw).slice(0, maxLength);
}

function normalizePackingSlipSettingsInput(input = {}) {
  return {
    ship_to_business_name: sanitizeSettingText(input.ship_to_business_name, PACKING_SLIP_SETTING_LIMITS.ship_to_business_name),
    ship_to_contact_name: sanitizeSettingText(input.ship_to_contact_name, PACKING_SLIP_SETTING_LIMITS.ship_to_contact_name),
    ship_to_address_line1: sanitizeSettingText(input.ship_to_address_line1, PACKING_SLIP_SETTING_LIMITS.ship_to_address_line1),
    ship_to_address_line2: sanitizeSettingText(input.ship_to_address_line2, PACKING_SLIP_SETTING_LIMITS.ship_to_address_line2),
    ship_to_city: sanitizeSettingText(input.ship_to_city, PACKING_SLIP_SETTING_LIMITS.ship_to_city),
    ship_to_state: sanitizeSettingText(input.ship_to_state, PACKING_SLIP_SETTING_LIMITS.ship_to_state),
    ship_to_postal_code: sanitizeSettingText(input.ship_to_postal_code, PACKING_SLIP_SETTING_LIMITS.ship_to_postal_code),
    ship_to_country: sanitizeSettingText(input.ship_to_country, PACKING_SLIP_SETTING_LIMITS.ship_to_country),
    packing_next_steps_text: sanitizeSettingText(
      input.packing_next_steps_text,
      PACKING_SLIP_SETTING_LIMITS.packing_next_steps_text
    ),
  };
}

async function loadPackingSlipSettings() {
  const [
    businessName,
    contactName,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    nextStepsText,
  ] = await Promise.all([
    getSettingValue('ship_to_business_name', 'I_BuyGames Buylist'),
    getSettingValue('ship_to_contact_name', ''),
    getSettingValue('ship_to_address_line1', ''),
    getSettingValue('ship_to_address_line2', ''),
    getSettingValue('ship_to_city', ''),
    getSettingValue('ship_to_state', ''),
    getSettingValue('ship_to_postal_code', ''),
    getSettingValue('ship_to_country', 'USA'),
    getSettingValue('packing_next_steps_text', DEFAULT_PACKING_NEXT_STEPS_TEXT),
  ]);

  return normalizePackingSlipSettingsInput({
    ship_to_business_name: businessName,
    ship_to_contact_name: contactName,
    ship_to_address_line1: addressLine1,
    ship_to_address_line2: addressLine2,
    ship_to_city: city,
    ship_to_state: state,
    ship_to_postal_code: postalCode,
    ship_to_country: country,
    packing_next_steps_text: nextStepsText,
  });
}

function asPublicGame(row) {
  const priceCents = Number(row.price_cents || 0);
  const previousPriceCents = toFiniteNumber(row.previous_price_cents, null);
  const changeCents = toFiniteNumber(row.price_change_cents, null);
  const changePercent = toFiniteNumber(row.price_change_percent, null);
  const priceChangeDirection = safeString(row.price_change_direction) || 'none';
  const baselineVersion = safeString(row.comparison_baseline_version) || null;
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    condition_note: normalizeCondition(row.condition_note),
    price_cents: priceCents,
    price: centsToMoney(priceCents),
    active: Number(row.active) === 1 || row.active === true,
    upc: normalizeUpc(row.upc),
    is_hot: Number(row.is_hot) === 1 || row.is_hot === true,
    notes: normalizeNotes(row.notes, 1000),
    updated_at: row.updated_at,
    previous_price_cents: previousPriceCents,
    previous_price: previousPriceCents === null ? null : centsToMoney(previousPriceCents),
    price_change_cents: changeCents,
    price_change_percent: changePercent,
    price_change_direction: priceChangeDirection,
    comparison_baseline_version: baselineVersion,
  };
}

function withoutPriceChangeFields(game) {
  return {
    ...game,
    previous_price_cents: null,
    previous_price: null,
    price_change_cents: null,
    price_change_percent: null,
    price_change_direction: 'none',
    comparison_baseline_version: null,
  };
}

function parseActiveValue(raw) {
  const value = safeString(raw).toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'active') return 1;
  if (value === '0' || value === 'false' || value === 'no' || value === 'inactive') return 0;
  return null;
}

function gameKey(title, platform, condition) {
  return `${safeString(title).toLowerCase()}|${normalizePlatform(platform).toLowerCase()}|${normalizeCondition(
    condition
  ).toLowerCase()}`;
}

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatPriceChangePercent(changeCents, previousPriceCents) {
  const prev = toFiniteNumber(previousPriceCents, null);
  if (prev === null || prev <= 0) return null;
  const pct = (Number(changeCents || 0) / prev) * 100;
  return Number(pct.toFixed(1));
}

function withPriceChangeFields(gameRow, baselineVersion, baselineMap) {
  const row = { ...gameRow };
  const normalizedKey = gameKey(row.title, row.platform, row.condition_note);
  const currentCents = toFiniteNumber(row.price_cents, 0);

  row.previous_price_cents = null;
  row.previous_price = null;
  row.price_change_cents = null;
  row.price_change_percent = null;
  row.price_change_direction = baselineVersion ? 'new' : 'none';
  row.comparison_baseline_version = baselineVersion || null;

  if (!baselineVersion) {
    row.price_change_direction = 'none';
    return row;
  }

  const previousItem = baselineMap.get(normalizedKey);
  if (!previousItem) {
    row.price_change_direction = 'new';
    return row;
  }

  const previousCents = toFiniteNumber(previousItem.price_cents, null);
  row.previous_price_cents = previousCents;
  row.previous_price = previousCents === null ? null : centsToMoney(previousCents);

  if (previousCents === null) {
    row.price_change_direction = 'new';
    return row;
  }

  const changeCents = currentCents - previousCents;
  row.price_change_cents = changeCents;
  row.price_change_percent = formatPriceChangePercent(changeCents, previousCents);
  row.price_change_direction = changeCents > 0 ? 'up' : changeCents < 0 ? 'down' : 'same';
  return row;
}

async function getSnapshotVersionMetadata(currentBuylistVersion) {
  const lastPublished = await db.get(
    `SELECT id, version, published_at, item_count
     FROM buylist_snapshots
     ORDER BY version DESC, id DESC
     LIMIT 1`
  );

  const sameVersion = await db.get(
    `SELECT id, version, published_at, item_count
     FROM buylist_snapshots
     WHERE version = ?
     ORDER BY id DESC
     LIMIT 1`,
    [currentBuylistVersion]
  );

  const previousVersion = await db.get(
    `SELECT id, version, published_at, item_count
     FROM buylist_snapshots
     WHERE version < ?
     ORDER BY version DESC, id DESC
     LIMIT 1`,
    [currentBuylistVersion]
  );

  // Compare against the most relevant published baseline:
  // 1) latest snapshot for the current version (if present)
  // 2) otherwise latest published snapshot from a prior version
  const baseline = sameVersion || previousVersion || null;

  return {
    lastPublished: lastPublished || null,
    baseline: baseline || null,
  };
}

async function getPriceComparisonContext(currentBuylistVersion) {
  const { baseline } = await getSnapshotVersionMetadata(currentBuylistVersion);
  if (!baseline || !baseline.id) {
    return {
      baselineVersion: null,
      baselineMap: new Map(),
    };
  }

  const rows = await db.all(
    `SELECT game_key, price_cents
     FROM buylist_snapshot_items
     WHERE snapshot_id = ?`,
    [baseline.id]
  );

  const baselineMap = new Map();
  for (const row of rows) {
    baselineMap.set(String(row.game_key || ''), {
      price_cents: toFiniteNumber(row.price_cents, null),
    });
  }

  return {
    baselineVersion: baseline.version || null,
    baselineMap,
  };
}

function splitCsvLineSimple(line) {
  const input = String(line || '');
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current.trim());
  return out;
}

function parseGamesCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const expectedHeader = 'title,platform,condition,price,active';
  const extendedHeader = 'title,platform,condition,price,active,upc,is_hot,notes';
  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ row: 1, reason: 'CSV must include a header and at least one row.' }],
      expectedHeader,
    };
  }

  const normalizedHeader = safeString(lines[0]).toLowerCase();
  if (normalizedHeader !== expectedHeader && normalizedHeader !== extendedHeader) {
    return {
      rows: [],
      errors: [{ row: 1, reason: `Invalid header. Use: ${expectedHeader} or ${extendedHeader}` }],
      expectedHeader,
    };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const rowNumber = i + 1;
    const parts = splitCsvLineSimple(lines[i]);
    if (parts.length !== 5 && parts.length !== 8) {
      errors.push({
        row: rowNumber,
        reason: 'Expected 5 columns (title,platform,condition,price,active) or 8 columns with upc,is_hot,notes.',
      });
      continue;
    }

    const [titleRaw, platformRaw, conditionRaw, priceRaw, activeRaw, upcRaw = '', hotRaw = '', notesRaw = ''] = parts;
    const title = safeString(titleRaw);
    const platform = normalizePlatform(platformRaw);
    const condition = normalizeCondition(conditionRaw);
    const priceCents = parsePriceToCents(priceRaw);
    const active = parseActiveValue(activeRaw);
    const upc = normalizeUpc(upcRaw);
    const isHot = parts.length >= 6 ? (normalizeHotValue(hotRaw) ? 1 : 0) : 0;
    const notes = normalizeNotes(notesRaw);

    if (!title) {
      errors.push({ row: rowNumber, reason: 'Missing title.' });
      continue;
    }
    if (!platform) {
      errors.push({ row: rowNumber, reason: 'Missing platform.' });
      continue;
    }
    if (!safeString(conditionRaw)) {
      errors.push({ row: rowNumber, reason: 'Missing condition.' });
      continue;
    }
    if (priceCents === null) {
      errors.push({ row: rowNumber, reason: 'Invalid price.' });
      continue;
    }
    if (active === null) {
      errors.push({ row: rowNumber, reason: 'Invalid active value. Use 1/0 or true/false.' });
      continue;
    }

    rows.push({
      row: rowNumber,
      title,
      platform,
      condition,
      priceCents,
      price: Number((priceCents / 100).toFixed(2)),
      active,
      upc,
      isHot,
      notes,
      key: gameKey(title, platform, condition),
    });
  }

  return { rows, errors, expectedHeader };
}

async function currentGamesByKey() {
  const map = new Map();
  const rows = await db.all('SELECT id, title, platform, condition_note FROM games');
  for (const row of rows) {
    const key = gameKey(row.title, row.platform, row.condition_note);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function buildGameFilterWhere(query) {
  const clauses = [];
  const params = [];

  const search = safeString(query.search || query.q).toLowerCase();
  if (search) {
    const numericSearch = normalizeUpc(search);
    if (numericSearch) {
      clauses.push('(LOWER(title) LIKE ? OR REPLACE(COALESCE(upc, \'\'), \'-\', \'\') LIKE ?)');
      params.push(`%${search}%`, `%${numericSearch}%`);
    } else {
      clauses.push('LOWER(title) LIKE ?');
      params.push(`%${search}%`);
    }
  }

  const platform = safeString(query.platform);
  if (platform && platform.toLowerCase() !== 'all') {
    clauses.push('platform = ?');
    params.push(platform);
  }

  const condition = safeString(query.condition);
  if (condition && condition.toLowerCase() !== 'all') {
    clauses.push('condition_note = ?');
    params.push(condition);
  }

  const active = safeString(query.active).toLowerCase();
  if (active === 'active') {
    clauses.push('active = 1');
  } else if (active === 'inactive') {
    clauses.push('active = 0');
  }

  const minPriceCents = parsePriceToCents(query.minPrice);
  if (safeString(query.minPrice) && minPriceCents !== null) {
    clauses.push('price_cents >= ?');
    params.push(minPriceCents);
  }

  const maxPriceCents = parsePriceToCents(query.maxPrice);
  if (safeString(query.maxPrice) && maxPriceCents !== null) {
    clauses.push('price_cents <= ?');
    params.push(maxPriceCents);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function getGameRows(includeInactive) {
  const fullSql = includeInactive
    ? `SELECT id, title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at
       FROM games
       ORDER BY title ASC`
    : `SELECT id, title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at
       FROM games
       WHERE active = 1
       ORDER BY title ASC`;
  const legacySql = includeInactive
    ? `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       ORDER BY title ASC`
    : `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       WHERE active = 1
       ORDER BY title ASC`;

  let rows;
  try {
    rows = await db.all(fullSql);
  } catch (error) {
    rows = (await db.all(legacySql)).map((row) => ({
      ...row,
      upc: null,
      is_hot: 0,
      notes: '',
    }));
  }
  const currentBuylistVersion = normalizeBuylistVersion(
    await getSettingValue('current_buylist_version', currentMonthVersion())
  );
  const comparison = await getPriceComparisonContext(currentBuylistVersion);
  return rows.map((row) => withPriceChangeFields(row, comparison.baselineVersion, comparison.baselineMap));
}

const SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT,
    condition_note TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    upc TEXT,
    is_hot INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    pricecharting_product_id TEXT,
    market_source TEXT DEFAULT 'pricecharting',
    market_last_checked_at TEXT,
    market_cib_price_cents INTEGER,
    market_new_price_cents INTEGER,
    market_loose_price_cents INTEGER,
    market_item_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submission_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_cents_at_submission INTEGER NOT NULL,
    FOREIGN KEY(submission_id) REFERENCES submissions(id),
    FOREIGN KEY(game_id) REFERENCES games(id)
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS market_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buylist_item_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'pricecharting',
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    cib_price_cents INTEGER,
    new_price_cents INTEGER,
    loose_price_cents INTEGER,
    FOREIGN KEY(buylist_item_id) REFERENCES games(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS title_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_title TEXT,
    requested_upc TEXT,
    email TEXT,
    source TEXT NOT NULL DEFAULT 'public_search',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS buylist_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL UNIQUE,
    published_at TEXT NOT NULL DEFAULT (datetime('now')),
    item_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS buylist_snapshot_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    title TEXT NOT NULL,
    platform TEXT,
    condition_note TEXT,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(snapshot_id) REFERENCES buylist_snapshots(id),
    UNIQUE (snapshot_id, game_key)
  );

  CREATE INDEX IF NOT EXISTS idx_market_history_item_source_time
    ON market_price_history (buylist_item_id, source, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_buylist_snapshot_items_snapshot
    ON buylist_snapshot_items (snapshot_id);
`;

const POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    platform TEXT,
    condition_note TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    upc TEXT,
    is_hot INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS submission_items (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    game_id INTEGER NOT NULL REFERENCES games(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_cents_at_submission INTEGER NOT NULL
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

  CREATE TABLE IF NOT EXISTS title_requests (
    id SERIAL PRIMARY KEY,
    requested_title TEXT,
    requested_upc TEXT,
    email TEXT,
    source TEXT NOT NULL DEFAULT 'public_search',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

async function initDb() {
  await db.exec(usingPostgres ? POSTGRES_SCHEMA_SQL : SQLITE_SCHEMA_SQL);

  await ensureColumn('submissions', 'updated_at', usingPostgres ? 'TIMESTAMPTZ' : 'TEXT');
  await ensureColumn('submissions', 'status', "TEXT NOT NULL DEFAULT 'Pending'");
  await ensureColumn('submissions', 'price_version', 'TEXT');
  await ensureColumn('submissions', 'estimated_total_cents', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('submissions', 'internal_notes', 'TEXT');
  await ensureColumn('submission_items', 'title_at_submit', 'TEXT');
  await ensureColumn('submission_items', 'platform_at_submit', 'TEXT');
  await ensureColumn('submission_items', 'unit_price_cents_at_submit', 'INTEGER');
  await ensureColumn('submission_items', 'line_total_cents_at_submit', 'INTEGER');
  await ensureColumn('games', 'upc', 'TEXT');
  await ensureColumn('games', 'is_hot', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('games', 'notes', 'TEXT');

  await setDefaultSetting('current_buylist_version', currentMonthVersion());
  await setDefaultSetting('show_price_change_highlights_public', 'true');
  await setDefaultSetting('homepage_paid_out_text', '$25,000+');
  await setDefaultSetting('ship_to_business_name', 'I_BuyGames Buylist');
  await setDefaultSetting('ship_to_contact_name', '');
  await setDefaultSetting('ship_to_address_line1', '');
  await setDefaultSetting('ship_to_address_line2', '');
  await setDefaultSetting('ship_to_city', '');
  await setDefaultSetting('ship_to_state', '');
  await setDefaultSetting('ship_to_postal_code', '');
  await setDefaultSetting('ship_to_country', 'USA');
  await setDefaultSetting('packing_next_steps_text', DEFAULT_PACKING_NEXT_STEPS_TEXT);

  await withTransaction(async (tx) => {
    const rows = await tx.all('SELECT id, platform FROM games');
    for (const row of rows) {
      const current = safeString(row.platform);
      const normalized = normalizePlatform(current);
      if (normalized !== current) {
        await tx.run(
          `UPDATE games
           SET platform = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
          [normalized, row.id]
        );
      }
    }
  });

  const countRow = await db.get('SELECT COUNT(*) AS c FROM games');
  const gameCount = Number(countRow?.c || 0);
  if (gameCount === 0 && shouldSeedSampleData) {
    const rows = [
      ['Wii Sports Resort', 'Wii', normalizeCondition(), 600],
      ['Metal Gear Solid 3: Subsistence', 'PS2', normalizeCondition(), 1200],
      ['Uncharted 2: Among Thieves', 'PS3', normalizeCondition(), 500],
      ['Halo 2', 'OG Xbox', normalizeCondition(), 700],
      ['Gears of War 3', 'Xbox 360', normalizeCondition(), 400],
      ['Super Mario 3D World', 'Wii U', normalizeCondition(), 800],
      ['Pokemon Omega Ruby', '3DS', normalizeCondition(), 1600],
      ['Mario Kart DS', 'DS', normalizeCondition(), 900],
    ];
    await withTransaction(async (tx) => {
      for (const row of rows) {
        await tx.run(
          `INSERT INTO games
            (title, platform, condition_note, price_cents, active)
           VALUES (?, ?, ?, ?, 1)`,
          row
        );
      }
    });
  }

  const faqCountRow = await db.get('SELECT COUNT(*) AS c FROM faqs');
  const faqCount = Number(faqCountRow?.c || 0);
  if (faqCount === 0) {
    const defaultFaqs = [
      ['Who pays for shipping?', 'Sellers are responsible for shipping unless otherwise specified.', 1],
      [
        'Is there a minimum payout?',
        'Submit titles listed in the buylist. Orders may be declined if total value is too low.',
        2,
      ],
      [
        'What if my item does not meet condition standards?',
        'Items that do not meet CIB or condition standards may be rejected or returned.',
        3,
      ],
      ['How fast is payment sent?', 'Payment is issued within 24-48 hours after inspection and processing.', 4],
      [
        'Do you buy consoles or accessories?',
        'Only items listed in the current buylist are being purchased at this time.',
        5,
      ],
    ];
    await withTransaction(async (tx) => {
      for (const row of defaultFaqs) {
        await tx.run(
          `INSERT INTO faqs (question, answer, sort_order, active, updated_at)
           VALUES (?, ?, ?, 1, datetime('now'))`,
          row
        );
      }
    });
  }

  await db.run(
    `UPDATE submissions
     SET status = COALESCE(NULLIF(status, ''), 'Pending'),
         updated_at = COALESCE(updated_at, created_at, datetime('now')),
         price_version = COALESCE(NULLIF(price_version, ''), ?),
         estimated_total_cents = COALESCE(
           estimated_total_cents,
           (
             SELECT COALESCE(
               SUM(
                 quantity * COALESCE(unit_price_cents_at_submit, price_cents_at_submission, 0)
               ),
               0
             )
             FROM submission_items si
             WHERE si.submission_id = submissions.id
           ),
           0
         )`,
    [currentMonthVersion()]
  );

  await db.run(
    `UPDATE submission_items
     SET unit_price_cents_at_submit = COALESCE(unit_price_cents_at_submit, price_cents_at_submission),
         line_total_cents_at_submit = COALESCE(
           line_total_cents_at_submit,
           quantity * COALESCE(unit_price_cents_at_submit, price_cents_at_submission, 0)
         )`
  );
}

let dbInitError = null;
const dbInitPromise = initDb().catch((error) => {
  dbInitError = error;
});

app.use(express.json({ limit: '5mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.html' || ext === '.js' || ext === '.css') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  })
);

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.use(
  '/api',
  asyncHandler(async (req, res, next) => {
    await dbInitPromise;
    if (dbInitError) throw dbInitError;
    next();
  })
);

function getRuntimePayload() {
  return {
    isVercel,
    ephemeralStorage: isEphemeralStorage,
    persistentStorage,
    dbProvider,
    storagePath: usingPostgres ? 'postgres' : path.resolve(dataDir),
  };
}

async function getAdminSettingsPayload() {
  const [currentBuylistVersionRaw, showHighlightsRaw, homepagePaidOutTextRaw, packingSlipSettings] = await Promise.all([
    getSettingValue('current_buylist_version', currentMonthVersion()),
    getSettingValue('show_price_change_highlights_public', 'true'),
    getSettingValue('homepage_paid_out_text', '$25,000+'),
    loadPackingSlipSettings(),
  ]);
  const currentBuylistVersion = normalizeBuylistVersion(currentBuylistVersionRaw);
  const showPriceChangeHighlightsPublic = toSettingBoolean(showHighlightsRaw, true);
  const snapshotMeta = await getSnapshotVersionMetadata(currentBuylistVersion);
  const lastPublishedVersion = snapshotMeta.lastPublished ? snapshotMeta.lastPublished.version : null;
  const lastPublishedAt = snapshotMeta.lastPublished ? snapshotMeta.lastPublished.published_at : null;
  const comparisonBaselineVersion = snapshotMeta.baseline ? snapshotMeta.baseline.version : null;
  return {
    current_buylist_version: currentBuylistVersion,
    show_price_change_highlights_public: showPriceChangeHighlightsPublic,
    homepage_paid_out_text: safeString(homepagePaidOutTextRaw) || '$25,000+',
    last_published_version: lastPublishedVersion,
    last_published_at: lastPublishedAt,
    comparison_baseline_version: comparisonBaselineVersion,
    ship_to_business_name: packingSlipSettings.ship_to_business_name,
    ship_to_contact_name: packingSlipSettings.ship_to_contact_name,
    ship_to_address_line1: packingSlipSettings.ship_to_address_line1,
    ship_to_address_line2: packingSlipSettings.ship_to_address_line2,
    ship_to_city: packingSlipSettings.ship_to_city,
    ship_to_state: packingSlipSettings.ship_to_state,
    ship_to_postal_code: packingSlipSettings.ship_to_postal_code,
    ship_to_country: packingSlipSettings.ship_to_country,
    packing_next_steps_text: packingSlipSettings.packing_next_steps_text,
  };
}

async function getAdminGamesPayload() {
  return (await getGameRows(true)).map((row) => asPublicGame(row));
}

async function getAdminFaqsPayload() {
  return (
    await db.all(
      `SELECT id, question, answer, sort_order, active, updated_at
       FROM faqs
       ORDER BY sort_order ASC, id ASC`
    )
  ).map((r) => ({
    ...r,
    active: Boolean(r.active),
  }));
}

async function getAdminSubmissionsPayload(query = {}) {
  const pageRaw = Number(query.page || 1);
  const pageSizeRaw = Number(query.pageSize || 25);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(100, Math.floor(pageSizeRaw)) : 25;

  const filter = buildSubmissionFilter(query);
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM submissions s ${filter.whereSql}`, filter.params);
  const total = Number(totalRow?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const defaultVersion = normalizeBuylistVersion(await getSettingValue('current_buylist_version', currentMonthVersion()));
  let rows;
  try {
    rows = (
      await db.all(
        `SELECT s.id, s.customer_name, s.email, s.phone, s.created_at, s.updated_at, s.status, s.price_version, s.estimated_total_cents,
                (SELECT COUNT(*) FROM submission_items si WHERE si.submission_id = s.id) AS item_count,
                (SELECT COALESCE(SUM(si.quantity), 0) FROM submission_items si WHERE si.submission_id = s.id) AS total_qty
         FROM submissions s
         ${filter.whereSql}
         ORDER BY ${filter.orderSql}
         LIMIT ? OFFSET ?`,
        [...filter.params, pageSize, offset]
      )
    ).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
      seller_name: row.customer_name,
      email: row.email || '',
      phone: row.phone || '',
      item_count: Number(row.item_count || 0),
      total_qty: Number(row.total_qty || 0),
      estimated_total: centsToMoney(Number(row.estimated_total_cents || 0)),
      estimated_total_cents: Number(row.estimated_total_cents || 0),
      status: normalizeSubmissionStatus(row.status),
      price_version: row.price_version || defaultVersion,
    }));
  } catch (error) {
    rows = (
      await db.all(
        `SELECT s.id, s.customer_name, s.email, s.phone, s.created_at,
                (SELECT COUNT(*) FROM submission_items si WHERE si.submission_id = s.id) AS item_count,
                (SELECT COALESCE(SUM(si.quantity), 0) FROM submission_items si WHERE si.submission_id = s.id) AS total_qty,
                (
                  SELECT COALESCE(SUM(si.quantity * COALESCE(si.price_cents_at_submission, 0)), 0)
                  FROM submission_items si
                  WHERE si.submission_id = s.id
                ) AS estimated_total_cents
         FROM submissions s
         ${filter.whereSql}
         ORDER BY ${filter.orderSql}
         LIMIT ? OFFSET ?`,
        [...filter.params, pageSize, offset]
      )
    ).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      updated_at: row.created_at,
      seller_name: row.customer_name,
      email: row.email || '',
      phone: row.phone || '',
      item_count: Number(row.item_count || 0),
      total_qty: Number(row.total_qty || 0),
      estimated_total: centsToMoney(Number(row.estimated_total_cents || 0)),
      estimated_total_cents: Number(row.estimated_total_cents || 0),
      status: 'Pending',
      price_version: defaultVersion,
    }));
  }

  return {
    rows,
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
    filters: {
      status: filter.status,
      q: filter.q,
      sort: filter.sort,
    },
  };
}

async function getAdminDashboardPayload() {
  const [pendingRow, activeTitlesRow, settingsPayload] = await Promise.all([
    db.get(`SELECT COUNT(*) AS c FROM submissions WHERE LOWER(COALESCE(status, '')) = 'pending'`),
    db.get(`SELECT COUNT(*) AS c FROM games WHERE active = 1`),
    getAdminSettingsPayload(),
  ]);

  const recentSubmissionsSql = usingPostgres
    ? `SELECT COUNT(*) AS c FROM submissions WHERE created_at >= (NOW() - INTERVAL '7 day')`
    : `SELECT COUNT(*) AS c FROM submissions WHERE created_at >= datetime('now', '-7 day')`;
  const recentRow = await db.get(recentSubmissionsSql);

  return {
    pendingSubmissionsCount: Number(pendingRow?.c || 0),
    submissionsLast7DaysCount: Number(recentRow?.c || 0),
    activeTitlesCount: Number(activeTitlesRow?.c || 0),
    lastPublishedAt: settingsPayload.last_published_at || null,
    currentBuylistVersion: settingsPayload.current_buylist_version || normalizeBuylistVersion(currentMonthVersion()),
  };
}

app.get(
  '/api/runtime',
  asyncHandler(async (req, res) => {
    res.json(getRuntimePayload());
  })
);

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get(
  '/api/admin/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await getAdminSettingsPayload());
  })
);

app.get(
  '/api/admin/bootstrap',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    const results = await Promise.allSettled([
      getAdminSettingsPayload(),
      getAdminGamesPayload(),
      getAdminSubmissionsPayload({ page: 1, pageSize: 25, sort: 'newest', status: 'All', q: '' }),
      getAdminFaqsPayload(),
    ]);
    const [settingsResult, gamesResult, submissionsResult, faqsResult] = results;
    const sectionErrors = {};

    if (settingsResult.status === 'rejected') sectionErrors.settings = settingsResult.reason?.message || 'Failed to load settings.';
    if (gamesResult.status === 'rejected') sectionErrors.games = gamesResult.reason?.message || 'Failed to load games.';
    if (submissionsResult.status === 'rejected') {
      sectionErrors.submissions = submissionsResult.reason?.message || 'Failed to load submissions.';
    }
    if (faqsResult.status === 'rejected') sectionErrors.faqs = faqsResult.reason?.message || 'Failed to load FAQs.';

    res.json({
      runtime: getRuntimePayload(),
      settings:
        settingsResult.status === 'fulfilled'
          ? settingsResult.value
          : {
              current_buylist_version: currentMonthVersion(),
              show_price_change_highlights_public: true,
              homepage_paid_out_text: '$25,000+',
              last_published_version: null,
              last_published_at: null,
              comparison_baseline_version: null,
              ship_to_business_name: 'I_BuyGames Buylist',
              ship_to_contact_name: '',
              ship_to_address_line1: '',
              ship_to_address_line2: '',
              ship_to_city: '',
              ship_to_state: '',
              ship_to_postal_code: '',
              ship_to_country: 'USA',
              packing_next_steps_text: DEFAULT_PACKING_NEXT_STEPS_TEXT,
            },
      games: gamesResult.status === 'fulfilled' ? gamesResult.value : [],
      submissions:
        submissionsResult.status === 'fulfilled'
          ? submissionsResult.value
          : {
              rows: [],
              pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
              filters: { status: 'All', q: '', sort: 'newest' },
            },
      faqs: faqsResult.status === 'fulfilled' ? faqsResult.value : [],
      section_errors: sectionErrors,
    });
  })
);

app.get(
  '/api/admin/dashboard',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.json(await getAdminDashboardPayload());
  })
);

app.put(
  '/api/admin/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { current_buylist_version, show_price_change_highlights_public } = req.body || {};
    const currentBuylistVersion = normalizeBuylistVersion(current_buylist_version);
    const [currentShowHighlightsRaw, existingPackingSlipSettings] = await Promise.all([
      getSettingValue('show_price_change_highlights_public', 'true'),
      loadPackingSlipSettings(),
    ]);
    const showPriceChangeHighlightsPublic = toSettingBoolean(
      show_price_change_highlights_public,
      toSettingBoolean(currentShowHighlightsRaw, true)
    );
    const homepagePaidOutText = safeString(req.body?.homepage_paid_out_text || '$25,000+').slice(0, 80) || '$25,000+';
    const body = req.body || {};
    const hasField = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const packingSlipSettings = normalizePackingSlipSettingsInput({
      ship_to_business_name: hasField('ship_to_business_name')
        ? body.ship_to_business_name
        : existingPackingSlipSettings.ship_to_business_name,
      ship_to_contact_name: hasField('ship_to_contact_name')
        ? body.ship_to_contact_name
        : existingPackingSlipSettings.ship_to_contact_name,
      ship_to_address_line1: hasField('ship_to_address_line1')
        ? body.ship_to_address_line1
        : existingPackingSlipSettings.ship_to_address_line1,
      ship_to_address_line2: hasField('ship_to_address_line2')
        ? body.ship_to_address_line2
        : existingPackingSlipSettings.ship_to_address_line2,
      ship_to_city: hasField('ship_to_city') ? body.ship_to_city : existingPackingSlipSettings.ship_to_city,
      ship_to_state: hasField('ship_to_state') ? body.ship_to_state : existingPackingSlipSettings.ship_to_state,
      ship_to_postal_code: hasField('ship_to_postal_code')
        ? body.ship_to_postal_code
        : existingPackingSlipSettings.ship_to_postal_code,
      ship_to_country: hasField('ship_to_country') ? body.ship_to_country : existingPackingSlipSettings.ship_to_country,
      packing_next_steps_text: hasField('packing_next_steps_text')
        ? body.packing_next_steps_text
        : existingPackingSlipSettings.packing_next_steps_text,
    });

    await Promise.all([
      upsertSettingValue('current_buylist_version', currentBuylistVersion),
      upsertSettingValue('show_price_change_highlights_public', showPriceChangeHighlightsPublic ? 'true' : 'false'),
      upsertSettingValue('homepage_paid_out_text', homepagePaidOutText),
      upsertSettingValue('ship_to_business_name', packingSlipSettings.ship_to_business_name),
      upsertSettingValue('ship_to_contact_name', packingSlipSettings.ship_to_contact_name),
      upsertSettingValue('ship_to_address_line1', packingSlipSettings.ship_to_address_line1),
      upsertSettingValue('ship_to_address_line2', packingSlipSettings.ship_to_address_line2),
      upsertSettingValue('ship_to_city', packingSlipSettings.ship_to_city),
      upsertSettingValue('ship_to_state', packingSlipSettings.ship_to_state),
      upsertSettingValue('ship_to_postal_code', packingSlipSettings.ship_to_postal_code),
      upsertSettingValue('ship_to_country', packingSlipSettings.ship_to_country),
      upsertSettingValue('packing_next_steps_text', packingSlipSettings.packing_next_steps_text),
    ]);

    const snapshotMeta = await getSnapshotVersionMetadata(currentBuylistVersion);
    const lastPublishedVersion = snapshotMeta.lastPublished ? snapshotMeta.lastPublished.version : null;
    const lastPublishedAt = snapshotMeta.lastPublished ? snapshotMeta.lastPublished.published_at : null;
    const comparisonBaselineVersion = snapshotMeta.baseline ? snapshotMeta.baseline.version : null;

    res.json({
      ok: true,
      settings: {
        current_buylist_version: currentBuylistVersion,
        show_price_change_highlights_public: showPriceChangeHighlightsPublic,
        homepage_paid_out_text: homepagePaidOutText,
        last_published_version: lastPublishedVersion,
        last_published_at: lastPublishedAt,
        comparison_baseline_version: comparisonBaselineVersion,
        ship_to_business_name: packingSlipSettings.ship_to_business_name,
        ship_to_contact_name: packingSlipSettings.ship_to_contact_name,
        ship_to_address_line1: packingSlipSettings.ship_to_address_line1,
        ship_to_address_line2: packingSlipSettings.ship_to_address_line2,
        ship_to_city: packingSlipSettings.ship_to_city,
        ship_to_state: packingSlipSettings.ship_to_state,
        ship_to_postal_code: packingSlipSettings.ship_to_postal_code,
        ship_to_country: packingSlipSettings.ship_to_country,
        packing_next_steps_text: packingSlipSettings.packing_next_steps_text,
      },
    });
  })
);

app.get(
  '/api/packing-slip-config',
  asyncHandler(async (req, res) => {
    const settings = await loadPackingSlipSettings();
    res.json({
      shipTo: {
        businessName: settings.ship_to_business_name,
        contactName: settings.ship_to_contact_name,
        addressLine1: settings.ship_to_address_line1,
        addressLine2: settings.ship_to_address_line2,
        city: settings.ship_to_city,
        state: settings.ship_to_state,
        postalCode: settings.ship_to_postal_code,
        country: settings.ship_to_country,
      },
      nextStepsText: settings.packing_next_steps_text,
    });
  })
);

app.post(
  '/api/admin/buylist/publish',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const overwrite = Boolean(req.body && req.body.overwrite === true);
    const currentBuylistVersion = normalizeBuylistVersion(
      await getSettingValue('current_buylist_version', currentMonthVersion())
    );
    const gamesForSnapshot = await db.all(
      `SELECT id, title, platform, condition_note, price_cents, active
       FROM games
       ORDER BY title ASC`
    );

    try {
      const result = await withTransaction(async (tx) => {
        const existing = await tx.get('SELECT id FROM buylist_snapshots WHERE version = ?', [currentBuylistVersion]);
        if (existing && !overwrite) {
          const error = new Error(`Snapshot for version ${currentBuylistVersion} already exists.`);
          error.status = 409;
          throw error;
        }

        if (existing) {
          await tx.run('DELETE FROM buylist_snapshot_items WHERE snapshot_id = ?', [existing.id]);
          await tx.run('DELETE FROM buylist_snapshots WHERE id = ?', [existing.id]);
        }

        const insertSnapshotSql = usingPostgres
          ? `INSERT INTO buylist_snapshots (version, item_count, notes, published_at)
             VALUES (?, ?, ?, datetime('now'))
             RETURNING id`
          : `INSERT INTO buylist_snapshots (version, item_count, notes, published_at)
             VALUES (?, ?, ?, datetime('now'))`;
        const snapshotInsert = await tx.run(insertSnapshotSql, [currentBuylistVersion, gamesForSnapshot.length, null]);
        const snapshotId = Number(snapshotInsert.lastInsertRowid || 0);
        if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
          throw new Error('Could not create snapshot.');
        }

        for (const game of gamesForSnapshot) {
          await tx.run(
            `INSERT INTO buylist_snapshot_items
              (snapshot_id, game_key, title, platform, condition_note, price_cents, active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              snapshotId,
              gameKey(game.title, game.platform, game.condition_note),
              String(game.title || '').trim(),
              String(game.platform || '').trim(),
              normalizeCondition(game.condition_note),
              Number(game.price_cents || 0),
              Number(game.active) === 1 ? 1 : 0,
            ]
          );
        }

        const snapshotInfo = await tx.get('SELECT id, published_at FROM buylist_snapshots WHERE id = ?', [snapshotId]);
        return {
          snapshotId,
          publishedAt: snapshotInfo ? snapshotInfo.published_at : new Date().toISOString(),
        };
      });

      res.json({
        ok: true,
        version: currentBuylistVersion,
        snapshot_id: result.snapshotId,
        item_count: gamesForSnapshot.length,
        published_at: result.publishedAt,
        overwrote: overwrite,
      });
    } catch (error) {
      if (error && error.status === 409) {
        return res.status(409).json({
          error: error.message,
          version: currentBuylistVersion,
        });
      }
      throw error;
    }
  })
);

app.get(
  '/api/games',
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    const adminView = req.headers['x-admin-key'] === adminKey;
    const includeInactive = adminView && req.query.includeInactive === 'true';
    const showPriceChangeHighlightsPublic = toSettingBoolean(
      await getSettingValue('show_price_change_highlights_public', 'true'),
      true
    );
    let rows = (await getGameRows(includeInactive)).map((row) => asPublicGame(row));
    if (!showPriceChangeHighlightsPublic) {
      rows = rows.map((row) => withoutPriceChangeFields(row));
    }
    res.json(rows);
  })
);

app.get(
  '/api/public-site-config',
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    const homepagePaidOutText = safeString(await getSettingValue('homepage_paid_out_text', '$25,000+')) || '$25,000+';
    res.json({
      homepagePaidOutText,
      homepagePaidOutLabel: 'paid out to sellers',
    });
  })
);

app.get(
  '/api/search/suggest',
  asyncHandler(async (req, res) => {
    const q = safeString(req.query.q);
    const limitRaw = Number(req.query.limit || 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(10, Math.max(1, Math.floor(limitRaw))) : 10;

    if (q.length < 2) {
      return res.json([]);
    }

    const rows = await getGameRows(false);
    const qLower = q.toLowerCase();
    const qUpc = normalizeUpc(q);

    const matches = rows
      .filter((row) => {
        const title = String(row.title || '').toLowerCase();
        const upc = normalizeUpc(row.upc);
        if (qUpc && upc && upc.includes(qUpc)) return true;
        return title.includes(qLower);
      })
      .map((row) => {
        const title = String(row.title || '').toLowerCase();
        const upc = normalizeUpc(row.upc);
        let score = title.startsWith(qLower) ? 300 : title.includes(qLower) ? 200 : 0;
        let matchType = 'title';
        if (qUpc && upc) {
          if (upc === qUpc) {
            score = 1000;
            matchType = 'upc';
          } else if (upc.includes(qUpc)) {
            score = Math.max(score, 500);
            matchType = 'upc';
          }
        }
        if (row.is_hot) score += 50;
        return { row, score, matchType };
      })
      .sort((a, b) => b.score - a.score || Number(b.row.is_hot) - Number(a.row.is_hot) || String(a.row.title).localeCompare(String(b.row.title)))
      .slice(0, limit)
      .map(({ row, matchType }) => ({
        id: row.id,
        title: row.title,
        platform: row.platform,
        price: row.price,
        price_cents: row.price_cents,
        condition_note: row.condition_note,
        is_hot: Boolean(row.is_hot),
        upc: row.upc || null,
        match_type: matchType,
      }));

    res.json(matches);
  })
);

app.post(
  '/api/title-requests',
  asyncHandler(async (req, res) => {
    const requestedTitle = safeString(req.body?.title).slice(0, 180);
    const requestedUpc = normalizeUpc(req.body?.upc);
    const email = safeString(req.body?.email).slice(0, 180);
    const source = safeString(req.body?.source || 'public_search').slice(0, 80) || 'public_search';

    if (!requestedTitle && !requestedUpc) {
      return res.status(400).json({ error: 'A title or UPC is required.' });
    }

    const result = await db.run(
      usingPostgres
        ? `INSERT INTO title_requests (requested_title, requested_upc, email, source, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           RETURNING id`
        : `INSERT INTO title_requests (requested_title, requested_upc, email, source, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
      [requestedTitle || null, requestedUpc || null, email || null, source]
    );

    res.status(201).json({
      ok: true,
      requestId: Number(result.lastInsertRowid || 0),
    });
  })
);

app.get(
  '/api/admin/games',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.json(await getAdminGamesPayload());
  })
);

app.post(
  '/api/admin/games/import-preview',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV content is required.' });
  }

  const parsed = parseGamesCsv(csv);
  const existingMap = await currentGamesByKey();
  const seenKeys = new Set();
  let newRows = 0;
  let updateRows = 0;
  let duplicateRows = 0;

  const previewRows = parsed.rows.map((row) => {
    const duplicateInFile = seenKeys.has(row.key);
    if (!duplicateInFile) seenKeys.add(row.key);
    const existing = existingMap.get(row.key);
    if (existing) updateRows += 1;
    else newRows += 1;
    if (existing || duplicateInFile) duplicateRows += 1;

    let status = 'New';
    if (existing && duplicateInFile) status = 'Duplicate in file, updates existing';
    else if (existing) status = 'Updates existing';
    else if (duplicateInFile) status = 'Duplicate in file';

    return {
      row: row.row,
      title: row.title,
      platform: row.platform,
      condition: row.condition,
      price: row.price,
      active: row.active === 1,
      status,
    };
  });

  res.json({
    summary: {
      totalRows: parsed.rows.length + parsed.errors.length,
      validRows: parsed.rows.length,
      newRows,
      updateRows,
      duplicateRows,
      errorRows: parsed.errors.length,
    },
    previewRows,
    errors: parsed.errors,
  });
  })
);

app.post(
  '/api/admin/games/import-commit',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const { csv, mode, skipDuplicates, stopOnError, replaceConfirm } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV content is required.' });
  }

  const importMode = safeString(mode).toLowerCase();
  const resolvedMode = importMode === 'add' || importMode === 'replace' ? importMode : 'upsert';
  if (resolvedMode === 'replace' && safeString(replaceConfirm) !== 'REPLACE') {
    return res.status(400).json({ error: 'Type REPLACE to confirm full replace mode.' });
  }

  const parsed = parseGamesCsv(csv);
  if (stopOnError && parsed.errors.length > 0) {
    return res.status(400).json({
      error: 'Import contains validation errors. Fix errors or disable stop on error.',
      errors: parsed.errors,
    });
  }
  if (parsed.rows.length === 0) {
    return res.status(400).json({
      error: 'No valid rows found in CSV import.',
      errors: parsed.errors,
    });
  }

  const dedupedRows = [];
  const dedupeIndex = new Map();
  let duplicateInFileCount = 0;
  let skipped = 0;
  for (const row of parsed.rows) {
    if (!dedupeIndex.has(row.key)) {
      dedupeIndex.set(row.key, dedupedRows.length);
      dedupedRows.push(row);
      continue;
    }
    duplicateInFileCount += 1;
    if (skipDuplicates) {
      skipped += 1;
      continue;
    }
    const idx = dedupeIndex.get(row.key);
    dedupedRows[idx] = row;
  }

  const existingMap = await currentGamesByKey();

  let inserted = 0;
  let updated = 0;
  let existingDuplicateCount = 0;

  await withTransaction(async (tx) => {
    if (resolvedMode === 'replace') {
      await tx.run('DELETE FROM games');
      for (const row of dedupedRows) {
      await tx.run(
          `INSERT INTO games (title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [row.title, row.platform, row.condition, row.priceCents, row.active, row.upc, row.isHot, row.notes]
        );
        inserted += 1;
      }
      return;
    }

    for (const row of dedupedRows) {
      const existing = existingMap.get(row.key);
      if (existing) {
        existingDuplicateCount += 1;
        if (skipDuplicates) {
          skipped += 1;
          continue;
        }
        if (resolvedMode === 'add') {
          skipped += 1;
          continue;
        }
        await tx.run(
          `UPDATE games
           SET title = ?, platform = ?, condition_note = ?, price_cents = ?, active = ?, upc = ?, is_hot = ?, notes = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [row.title, row.platform, row.condition, row.priceCents, row.active, row.upc, row.isHot, row.notes, existing.id]
        );
        updated += 1;
        continue;
      }
      await tx.run(
        `INSERT INTO games (title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [row.title, row.platform, row.condition, row.priceCents, row.active, row.upc, row.isHot, row.notes]
      );
      inserted += 1;
    }
  });

  res.json({
    ok: true,
    mode: resolvedMode,
    inserted,
    updated,
    skipped,
    duplicates: duplicateInFileCount + existingDuplicateCount,
    errors: parsed.errors.length,
    validationErrors: parsed.errors,
  });
  })
);

app.get(
  '/api/faqs',
  asyncHandler(async (req, res) => {
    const rows = (
      await db.all(
        `SELECT id, question, answer, sort_order, active
         FROM faqs
         WHERE active = 1
         ORDER BY sort_order ASC, id ASC`
      )
    ).map((r) => ({
      ...r,
      active: Boolean(r.active),
    }));

    res.json(rows);
  })
);

app.post(
  '/api/submissions',
  asyncHandler(async (req, res) => {
  const { customerName, email, phone, notes, items } = req.body || {};

  if (!customerName || typeof customerName !== 'string') {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one selected game is required' });
  }

  for (const item of items) {
    if (!Number.isInteger(item.gameId) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return res.status(400).json({ error: 'Invalid submission items' });
    }
  }

  const priceVersion = normalizeBuylistVersion(
    await getSettingValue('current_buylist_version', currentMonthVersion())
  );

  try {
    const created = await withTransaction(async (tx) => {
      const lockedItems = [];
      let estimatedTotalCents = 0;

      for (const item of items) {
        const game = await tx.get('SELECT id, title, platform, price_cents, active FROM games WHERE id = ?', [
          item.gameId,
        ]);
        if (!game || Number(game.active) !== 1) {
          throw new Error(`Game ${item.gameId} is unavailable`);
        }

        const unitPriceCents = Number(game.price_cents);
        const lineTotalCents = unitPriceCents * item.quantity;
        estimatedTotalCents += lineTotalCents;
        lockedItems.push({
          gameId: game.id,
          title: game.title,
          platform: game.platform || '',
          quantity: item.quantity,
          unitPriceCents,
          lineTotalCents,
        });
      }

      const insertSubmissionSql = usingPostgres
        ? `INSERT INTO submissions
            (customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)
           RETURNING id`
        : `INSERT INTO submissions
            (customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`;
      const submission = await tx.run(insertSubmissionSql, [
        customerName.trim(),
        (email || '').trim(),
        (phone || '').trim(),
        (notes || '').trim(),
        'Pending',
        priceVersion,
        estimatedTotalCents,
        '',
      ]);
      const submissionId = Number(submission.lastInsertRowid || 0);
      if (!Number.isInteger(submissionId) || submissionId <= 0) {
        throw new Error('Could not create submission ID');
      }

      for (const item of lockedItems) {
        await tx.run(
          `INSERT INTO submission_items
            (submission_id, game_id, quantity, price_cents_at_submission, title_at_submit, platform_at_submit, unit_price_cents_at_submit, line_total_cents_at_submit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            submissionId,
            item.gameId,
            item.quantity,
            item.unitPriceCents,
            item.title,
            item.platform,
            item.unitPriceCents,
            item.lineTotalCents,
          ]
        );
      }

      return {
        submissionId,
        estimatedTotalCents,
        lockedItems,
      };
    });

    res.status(201).json({
      ok: true,
      submissionId: created.submissionId,
      shipment: {
        id: `SHIP-${String(created.submissionId).padStart(6, '0')}`,
        submissionId: created.submissionId,
        total: (created.estimatedTotalCents / 100).toFixed(2),
        createdAt: new Date().toISOString(),
        priceVersion,
        status: 'Pending',
        items: created.lockedItems.map((item) => ({
          title: item.title,
          platform: item.platform,
          quantity: item.quantity,
          price: (item.unitPriceCents / 100).toFixed(2),
          lineTotal: (item.lineTotalCents / 100).toFixed(2),
        })),
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not create submission' });
  }
  })
);

function buildSubmissionFilter(query) {
  const where = [];
  const params = [];

  const normalizedStatus =
    query.status && query.status !== 'All' ? normalizeSubmissionStatus(query.status) : null;
  if (normalizedStatus) {
    where.push('s.status = ?');
    params.push(normalizedStatus);
  }

  const q = safeString(query.q);
  if (q) {
    where.push('(s.customer_name LIKE ? OR s.email LIKE ? OR CAST(s.id AS TEXT) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const sort = safeString(query.sort).toLowerCase() === 'oldest' ? 'oldest' : 'newest';
  const orderSql = sort === 'oldest' ? 's.created_at ASC, s.id ASC' : 's.created_at DESC, s.id DESC';

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    sort,
    orderSql,
    q,
    status: normalizedStatus || 'All',
  };
}

async function getSubmissionDetailById(id) {
  const submission = await db.get(
    `SELECT id, customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes
     FROM submissions
     WHERE id = ?`,
    [id]
  );
  if (!submission) return null;

  const items = (
    await db.all(
      `SELECT si.id,
              si.game_id,
              si.quantity,
              COALESCE(si.unit_price_cents_at_submit, si.price_cents_at_submission) AS unit_price_cents_at_submit,
              COALESCE(
                si.line_total_cents_at_submit,
                si.quantity * COALESCE(si.unit_price_cents_at_submit, si.price_cents_at_submission, 0)
              ) AS line_total_cents_at_submit,
              COALESCE(si.title_at_submit, g.title) AS title,
              COALESCE(si.platform_at_submit, g.platform, '') AS platform
       FROM submission_items si
       LEFT JOIN games g ON g.id = si.game_id
       WHERE si.submission_id = ?
       ORDER BY si.id ASC`,
      [id]
    )
  ).map((row) => ({
    id: row.id,
    game_id: row.game_id,
    title: row.title || 'Unknown Title',
    platform: row.platform || '',
    qty: Number(row.quantity || 0),
    unit_price_at_submit: centsToMoney(Number(row.unit_price_cents_at_submit || 0)),
    line_total_at_submit: centsToMoney(Number(row.line_total_cents_at_submit || 0)),
    unit_price_cents_at_submit: Number(row.unit_price_cents_at_submit || 0),
    line_total_cents_at_submit: Number(row.line_total_cents_at_submit || 0),
  }));

  return {
    id: submission.id,
    created_at: submission.created_at,
    updated_at: submission.updated_at || submission.created_at,
    seller_name: submission.customer_name,
    email: submission.email || '',
    phone: submission.phone || '',
    notes: submission.notes || '',
    internal_notes: submission.internal_notes || '',
    status: normalizeSubmissionStatus(submission.status),
    price_version:
      submission.price_version ||
      normalizeBuylistVersion(await getSettingValue('current_buylist_version', currentMonthVersion())),
    estimated_total_cents: Number(submission.estimated_total_cents || 0),
    estimated_total: centsToMoney(Number(submission.estimated_total_cents || 0)),
    item_count: items.length,
    total_qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    items,
  };
}

app.get(
  '/api/admin/submissions',
  requireAdmin,
  asyncHandler(async (req, res) => {
  res.json(await getAdminSubmissionsPayload(req.query));
  })
);

app.get(
  '/api/admin/submissions/export-csv',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const filter = buildSubmissionFilter(req.query);
  const rows = await db.all(
    `SELECT s.id
     FROM submissions s
     ${filter.whereSql}
     ORDER BY ${filter.orderSql}`,
    filter.params
  );

  const csvRows = [
    [
      'submission_id',
      'created_at',
      'updated_at',
      'status',
      'price_version',
      'seller_name',
      'email',
      'phone',
      'estimated_total',
      'title',
      'platform',
      'qty',
      'unit_price_at_submit',
      'line_total_at_submit',
    ],
  ];

  for (const row of rows) {
    const detail = await getSubmissionDetailById(row.id);
    if (!detail) continue;

    if (detail.items.length === 0) {
      csvRows.push([
        detail.id,
        detail.created_at,
        detail.updated_at,
        detail.status,
        detail.price_version,
        detail.seller_name,
        detail.email,
        detail.phone,
        detail.estimated_total,
        '',
        '',
        '',
        '',
        '',
      ]);
      continue;
    }

    for (const item of detail.items) {
      csvRows.push([
        detail.id,
        detail.created_at,
        detail.updated_at,
        detail.status,
        detail.price_version,
        detail.seller_name,
        detail.email,
        detail.phone,
        detail.estimated_total,
        item.title,
        item.platform,
        item.qty,
        item.unit_price_at_submit,
        item.line_total_at_submit,
      ]);
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
  res.send(rowsToCsv(csvRows));
  })
);

app.get(
  '/api/admin/submissions/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const detail = await getSubmissionDetailById(id);
  if (!detail) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  res.json(detail);
  })
);

app.put(
  '/api/admin/submissions/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const existing = await db.get('SELECT id, status, internal_notes FROM submissions WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  const nextStatus = req.body?.status ? normalizeSubmissionStatus(req.body.status) : normalizeSubmissionStatus(existing.status);
  const internalNotes = safeString(req.body?.internalNotes ?? existing.internal_notes ?? '');

  if (nextStatus === 'Rejected' && internalNotes.length < 10) {
    return res.status(400).json({ error: 'Rejected submissions require internal notes of at least 10 characters.' });
  }

  await db.run(
    `UPDATE submissions
     SET status = ?, internal_notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [nextStatus, internalNotes, id]
  );

  const detail = await getSubmissionDetailById(id);
  res.json({ ok: true, submission: detail });
  })
);

app.delete(
  '/api/admin/submissions/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const existing = await db.get('SELECT id FROM submissions WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  await withTransaction(async (tx) => {
    await tx.run('DELETE FROM submission_items WHERE submission_id = ?', [id]);
    await tx.run('DELETE FROM submissions WHERE id = ?', [id]);
  });

  res.json({ ok: true, id });
  })
);

app.get(
  '/api/admin/submissions/:id/export-csv',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const detail = await getSubmissionDetailById(id);
  if (!detail) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  const rows = [
    [
      'submission_id',
      'created_at',
      'updated_at',
      'status',
      'price_version',
      'seller_name',
      'email',
      'phone',
      'estimated_total',
    ],
    [
      detail.id,
      detail.created_at,
      detail.updated_at,
      detail.status,
      detail.price_version,
      detail.seller_name,
      detail.email,
      detail.phone,
      detail.estimated_total,
    ],
    [],
    ['title', 'platform', 'qty', 'unit_price_at_submit', 'line_total_at_submit'],
    ...detail.items.map((item) => [
      item.title,
      item.platform,
      item.qty,
      item.unit_price_at_submit,
      item.line_total_at_submit,
    ]),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="submission-${id}.csv"`);
  res.send(rowsToCsv(rows));
  })
);

app.get(
  '/api/admin/faqs',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await getAdminFaqsPayload());
  })
);

app.post(
  '/api/admin/faqs',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const { question, answer, sortOrder, active } = req.body || {};
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const order = Number.isInteger(Number(sortOrder)) ? Number(sortOrder) : 0;
  if (!q || !a) {
    return res.status(400).json({ error: 'Question and answer are required' });
  }

  const info = await db.run(
    usingPostgres
      ? `INSERT INTO faqs (question, answer, sort_order, active, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         RETURNING id`
      : `INSERT INTO faqs (question, answer, sort_order, active, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
    [q, a, order, active === false ? 0 : 1]
  );

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  })
);

app.put(
  '/api/admin/faqs/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const existing = await db.get('SELECT id FROM faqs WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'FAQ not found' });
  }

  const { question, answer, sortOrder, active } = req.body || {};
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const order = Number.isInteger(Number(sortOrder)) ? Number(sortOrder) : 0;
  if (!q || !a) {
    return res.status(400).json({ error: 'Question and answer are required' });
  }

  await db.run(
    `UPDATE faqs
     SET question = ?, answer = ?, sort_order = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [q, a, order, active ? 1 : 0, id]
  );

  const row = await db.get('SELECT id, question, answer, sort_order, active, updated_at FROM faqs WHERE id = ?', [id]);
  res.json({
    ok: true,
    faq: {
      ...row,
      active: Boolean(row.active),
    },
  });
  })
);

app.delete(
  '/api/admin/faqs/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  const result = await db.run('DELETE FROM faqs WHERE id = ?', [id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'FAQ not found' });
  }
  res.json({ ok: true });
  })
);

app.post(
  '/api/admin/games',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const { title, platform, condition, condition_note, conditionNote, price, active, upc, is_hot, notes } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  const normalizedCondition = normalizeCondition(condition ?? condition_note ?? conditionNote);

  const info = await db.run(
    usingPostgres
      ? `INSERT INTO games
          (title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         RETURNING id`
      : `INSERT INTO games
          (title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      title.trim(),
      normalizePlatform(platform),
      normalizedCondition,
      priceCents,
      active === false ? 0 : 1,
      normalizeUpc(upc),
      normalizeHotValue(is_hot) ? 1 : 0,
      normalizeNotes(notes),
    ]
  );

  const created = await db.get(
    `SELECT id, title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at
     FROM games
     WHERE id = ?`,
    [Number(info.lastInsertRowid)]
  );

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid), game: asPublicGame(created) });
  })
);

app.put(
  '/api/admin/games/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const existing = await db.get('SELECT id FROM games WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const { title, platform, condition, condition_note, conditionNote, price, active, upc, is_hot, notes } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  const normalizedCondition = normalizeCondition(condition ?? condition_note ?? conditionNote);

  await db.run(
    `UPDATE games
     SET title = ?,
         platform = ?,
         condition_note = ?,
         price_cents = ?,
         active = ?,
         upc = ?,
         is_hot = ?,
         notes = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      title.trim(),
      normalizePlatform(platform),
      normalizedCondition,
      priceCents,
      active ? 1 : 0,
      normalizeUpc(upc),
      normalizeHotValue(is_hot) ? 1 : 0,
      normalizeNotes(notes),
      id,
    ]
  );

  const updated = await db.get(
    `SELECT id, title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at
     FROM games
     WHERE id = ?`,
    [id]
  );

  res.json({
    ok: true,
    game: asPublicGame(updated),
  });
  })
);

app.delete(
  '/api/admin/games/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const result = await db.run('DELETE FROM games WHERE id = ?', [id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Game not found' });
  }

  res.json({ ok: true });
  })
);

app.post(
  '/api/admin/games/import-csv',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV content is required' });
  }

  const parsed = parseGamesCsv(csv);
  if (parsed.errors.length > 0) {
    return res.status(400).json({
      error: `Import has ${parsed.errors.length} error(s).`,
      errors: parsed.errors,
    });
  }

  await withTransaction(async (tx) => {
    await tx.run('DELETE FROM games');
    for (const row of parsed.rows) {
      await tx.run(
        `INSERT INTO games
          (title, platform, condition_note, price_cents, active, upc, is_hot, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [row.title, row.platform, row.condition, row.priceCents, row.active, row.upc, row.isHot, row.notes]
      );
    }
  });

  res.json({ ok: true, imported: parsed.rows.length });
  })
);

app.get(
  '/api/admin/games/export-csv',
  requireAdmin,
  asyncHandler(async (req, res) => {
  const filter = buildGameFilterWhere(req.query || {});
  const rows = await db.all(
    `SELECT title, platform, condition_note, price_cents, active, upc, is_hot, notes
     FROM games
     ${filter.whereSql}
     ORDER BY title ASC`,
    filter.params
  );

  const csvRows = [['title', 'platform', 'condition', 'price', 'active', 'upc', 'is_hot', 'notes']];
  for (const r of rows) {
    csvRows.push([
      r.title,
      r.platform || '',
      normalizeCondition(r.condition_note),
      (r.price_cents / 100).toFixed(2),
      r.active ? '1' : '0',
      normalizeUpc(r.upc) || '',
      Number(r.is_hot) === 1 || r.is_hot === true ? '1' : '0',
      normalizeNotes(r.notes),
    ]);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="buylist.csv"');
  res.send(rowsToCsv(csvRows));
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Video game buylist app running on http://localhost:${port}`);
  });
}

module.exports = app;
