require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY || 'change-this-admin-key';
const isVercel = process.env.VERCEL === '1';

const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp' : path.join(__dirname, 'data'));
const isEphemeralStorage = isVercel && path.resolve(dataDir).startsWith('/tmp');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'buylist.db'));
db.pragma('journal_mode = WAL');

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function setDefaultSetting(key, value) {
  db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(
    key,
    String(value)
  );
}

function getSettingValue(key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
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

function asPublicGame(row) {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    condition_note: normalizeCondition(row.condition_note),
    price_cents: row.price_cents,
    price: centsToMoney(row.price_cents),
    active: Boolean(row.active),
    updated_at: row.updated_at,
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

function splitCsvLineSimple(line) {
  return String(line || '')
    .split(',')
    .map((part) => part.trim());
}

function parseGamesCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const expectedHeader = 'title,platform,condition,price,active';
  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ row: 1, reason: 'CSV must include a header and at least one row.' }],
      expectedHeader,
    };
  }

  if (safeString(lines[0]).toLowerCase() !== expectedHeader) {
    return {
      rows: [],
      errors: [{ row: 1, reason: `Invalid header. Use exactly: ${expectedHeader}` }],
      expectedHeader,
    };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const rowNumber = i + 1;
    const parts = splitCsvLineSimple(lines[i]);
    if (parts.length !== 5) {
      errors.push({ row: rowNumber, reason: 'Expected 5 columns: title,platform,condition,price,active.' });
      continue;
    }

    const [titleRaw, platformRaw, conditionRaw, priceRaw, activeRaw] = parts;
    const title = safeString(titleRaw);
    const platform = normalizePlatform(platformRaw);
    const condition = normalizeCondition(conditionRaw);
    const priceCents = parsePriceToCents(priceRaw);
    const active = parseActiveValue(activeRaw);

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
      key: gameKey(title, platform, condition),
    });
  }

  return { rows, errors, expectedHeader };
}

function currentGamesByKey() {
  const map = new Map();
  const rows = db.prepare('SELECT id, title, platform, condition_note FROM games').all();
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
    clauses.push('LOWER(title) LIKE ?');
    params.push(`%${search}%`);
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

function getGameRows(includeInactive) {
  const sql = includeInactive
    ? `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       ORDER BY title ASC`
    : `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       WHERE active = 1
       ORDER BY title ASC`;

  return db.prepare(sql).all();
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      platform TEXT,
      condition_note TEXT,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1,
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

    CREATE INDEX IF NOT EXISTS idx_market_history_item_source_time
      ON market_price_history (buylist_item_id, source, captured_at DESC);
  `);

  ensureColumn('submissions', 'updated_at', 'TEXT');
  ensureColumn('submissions', 'status', "TEXT NOT NULL DEFAULT 'Pending'");
  ensureColumn('submissions', 'price_version', 'TEXT');
  ensureColumn('submissions', 'estimated_total_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('submissions', 'internal_notes', 'TEXT');
  ensureColumn('submission_items', 'title_at_submit', 'TEXT');
  ensureColumn('submission_items', 'platform_at_submit', 'TEXT');
  ensureColumn('submission_items', 'unit_price_cents_at_submit', 'INTEGER');
  ensureColumn('submission_items', 'line_total_cents_at_submit', 'INTEGER');

  setDefaultSetting('current_buylist_version', currentMonthVersion());

  const normalizePlatformsTx = db.transaction(() => {
    const rows = db.prepare('SELECT id, platform FROM games').all();
    const updatePlatform = db.prepare(
      `UPDATE games
       SET platform = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );
    for (const row of rows) {
      const current = safeString(row.platform);
      const normalized = normalizePlatform(current);
      if (normalized !== current) {
        updatePlatform.run(normalized, row.id);
      }
    }
  });
  normalizePlatformsTx();

  const count = db.prepare('SELECT COUNT(*) AS c FROM games').get().c;
  if (count === 0) {
    const seed = db.prepare(
      `INSERT INTO games
        (title, platform, condition_note, price_cents, active)
       VALUES (?, ?, ?, ?, 1)`
    );
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
    const tx = db.transaction((items) => {
      for (const row of items) seed.run(...row);
    });
    tx(rows);
  }

  const faqCount = db.prepare('SELECT COUNT(*) AS c FROM faqs').get().c;
  if (faqCount === 0) {
    const insertFaq = db.prepare(
      `INSERT INTO faqs (question, answer, sort_order, active, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'))`
    );
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
    const txFaq = db.transaction((rows) => {
      for (const row of rows) insertFaq.run(...row);
    });
    txFaq(defaultFaqs);
  }

  db.prepare(
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
         )`
  ).run(currentMonthVersion());

  db.prepare(
    `UPDATE submission_items
     SET unit_price_cents_at_submit = COALESCE(unit_price_cents_at_submit, price_cents_at_submission),
         line_total_cents_at_submit = COALESCE(
           line_total_cents_at_submit,
           quantity * COALESCE(unit_price_cents_at_submit, price_cents_at_submission, 0)
         )`
  ).run();
}

initDb();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/runtime', (req, res) => {
  res.json({
    isVercel,
    ephemeralStorage: isEphemeralStorage,
    storagePath: path.resolve(dataDir),
  });
});

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const currentBuylistVersion = normalizeBuylistVersion(getSettingValue('current_buylist_version', currentMonthVersion()));
  res.json({
    current_buylist_version: currentBuylistVersion,
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { current_buylist_version } = req.body || {};

  const currentBuylistVersion = normalizeBuylistVersion(current_buylist_version);
  db.prepare("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
    currentBuylistVersion,
    'current_buylist_version'
  );

  res.json({
    ok: true,
    settings: {
      current_buylist_version: currentBuylistVersion,
    },
  });
});

app.get('/api/games', (req, res) => {
  const adminView = req.headers['x-admin-key'] === adminKey;
  const includeInactive = adminView && req.query.includeInactive === 'true';
  const rows = getGameRows(includeInactive).map((row) => asPublicGame(row));
  res.json(rows);
});

app.get('/api/admin/games', requireAdmin, (req, res) => {
  const rows = getGameRows(true).map((row) => asPublicGame(row));
  res.json(rows);
});

app.post('/api/admin/games/import-preview', requireAdmin, (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV content is required.' });
  }

  const parsed = parseGamesCsv(csv);
  const existingMap = currentGamesByKey();
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
});

app.post('/api/admin/games/import-commit', requireAdmin, (req, res) => {
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

  const existingMap = currentGamesByKey();
  const insertGame = db.prepare(
    `INSERT INTO games (title, platform, condition_note, price_cents, active, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );
  const updateGame = db.prepare(
    `UPDATE games
     SET title = ?, platform = ?, condition_note = ?, price_cents = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`
  );

  let inserted = 0;
  let updated = 0;
  let existingDuplicateCount = 0;

  const tx = db.transaction(() => {
    if (resolvedMode === 'replace') {
      db.prepare('DELETE FROM games').run();
      for (const row of dedupedRows) {
        insertGame.run(row.title, row.platform, row.condition, row.priceCents, row.active);
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
        updateGame.run(row.title, row.platform, row.condition, row.priceCents, row.active, existing.id);
        updated += 1;
        continue;
      }
      insertGame.run(row.title, row.platform, row.condition, row.priceCents, row.active);
      inserted += 1;
    }
  });

  tx();

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
});

app.get('/api/faqs', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, question, answer, sort_order, active
       FROM faqs
       WHERE active = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map((r) => ({
      ...r,
      active: Boolean(r.active),
    }));

  res.json(rows);
});

app.post('/api/submissions', (req, res) => {
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

  const priceVersion = normalizeBuylistVersion(getSettingValue('current_buylist_version', currentMonthVersion()));

  const insertSubmission = db.prepare(
    `INSERT INTO submissions
      (customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO submission_items
      (submission_id, game_id, quantity, price_cents_at_submission, title_at_submit, platform_at_submit, unit_price_cents_at_submit, line_total_cents_at_submit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getGame = db.prepare('SELECT id, title, platform, price_cents, active FROM games WHERE id = ?');

  const tx = db.transaction(() => {
    const lockedItems = [];
    let estimatedTotalCents = 0;

    for (const item of items) {
      const game = getGame.get(item.gameId);
      if (!game || game.active !== 1) {
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

    const submission = insertSubmission.run(
      customerName.trim(),
      (email || '').trim(),
      (phone || '').trim(),
      (notes || '').trim(),
      'Pending',
      priceVersion,
      estimatedTotalCents,
      ''
    );
    const submissionId = Number(submission.lastInsertRowid);

    for (const item of lockedItems) {
      insertItem.run(
        submissionId,
        item.gameId,
        item.quantity,
        item.unitPriceCents,
        item.title,
        item.platform,
        item.unitPriceCents,
        item.lineTotalCents
      );
    }

    return {
      submissionId,
      estimatedTotalCents,
      lockedItems,
    };
  });

  try {
    const created = tx();
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
});

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

function getSubmissionDetailById(id) {
  const submission = db
    .prepare(
      `SELECT id, customer_name, email, phone, notes, created_at, updated_at, status, price_version, estimated_total_cents, internal_notes
       FROM submissions
       WHERE id = ?`
    )
    .get(id);
  if (!submission) return null;

  const items = db
    .prepare(
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
       ORDER BY si.id ASC`
    )
    .all(id)
    .map((row) => ({
      id: row.id,
      game_id: row.game_id,
      title: row.title || 'Unknown Title',
      platform: row.platform || '',
      qty: row.quantity,
      unit_price_at_submit: centsToMoney(row.unit_price_cents_at_submit),
      line_total_at_submit: centsToMoney(row.line_total_cents_at_submit),
      unit_price_cents_at_submit: Number.isInteger(row.unit_price_cents_at_submit)
        ? row.unit_price_cents_at_submit
        : 0,
      line_total_cents_at_submit: Number.isInteger(row.line_total_cents_at_submit)
        ? row.line_total_cents_at_submit
        : 0,
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
    price_version: submission.price_version || normalizeBuylistVersion(getSettingValue('current_buylist_version', currentMonthVersion())),
    estimated_total_cents: Number(submission.estimated_total_cents || 0),
    estimated_total: centsToMoney(Number(submission.estimated_total_cents || 0)),
    item_count: items.length,
    total_qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    items,
  };
}

app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const pageRaw = Number(req.query.page || 1);
  const pageSizeRaw = Number(req.query.pageSize || 25);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(100, Math.floor(pageSizeRaw)) : 25;

  const filter = buildSubmissionFilter(req.query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM submissions s ${filter.whereSql}`)
    .get(...filter.params);
  const total = Number(totalRow?.c || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT s.id, s.customer_name, s.email, s.phone, s.created_at, s.updated_at, s.status, s.price_version, s.estimated_total_cents,
              (SELECT COUNT(*) FROM submission_items si WHERE si.submission_id = s.id) AS item_count,
              (SELECT COALESCE(SUM(si.quantity), 0) FROM submission_items si WHERE si.submission_id = s.id) AS total_qty
       FROM submissions s
       ${filter.whereSql}
       ORDER BY ${filter.orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...filter.params, pageSize, offset)
    .map((row) => ({
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
      price_version:
        row.price_version || normalizeBuylistVersion(getSettingValue('current_buylist_version', currentMonthVersion())),
    }));

  res.json({
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
  });
});

app.get('/api/admin/submissions/export-csv', requireAdmin, (req, res) => {
  const filter = buildSubmissionFilter(req.query);
  const rows = db
    .prepare(
      `SELECT s.id
       FROM submissions s
       ${filter.whereSql}
       ORDER BY ${filter.orderSql}`
    )
    .all(...filter.params);

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
    const detail = getSubmissionDetailById(row.id);
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
});

app.get('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const detail = getSubmissionDetailById(id);
  if (!detail) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  res.json(detail);
});

app.put('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const existing = db
    .prepare('SELECT id, status, internal_notes FROM submissions WHERE id = ?')
    .get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  const nextStatus = req.body?.status ? normalizeSubmissionStatus(req.body.status) : normalizeSubmissionStatus(existing.status);
  const internalNotes = safeString(req.body?.internalNotes ?? existing.internal_notes ?? '');

  if (nextStatus === 'Rejected' && internalNotes.length < 10) {
    return res.status(400).json({ error: 'Rejected submissions require internal notes of at least 10 characters.' });
  }

  db.prepare(
    `UPDATE submissions
     SET status = ?, internal_notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextStatus, internalNotes, id);

  const detail = getSubmissionDetailById(id);
  res.json({ ok: true, submission: detail });
});

app.get('/api/admin/submissions/:id/export-csv', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  const detail = getSubmissionDetailById(id);
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
});

app.get('/api/admin/faqs', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, question, answer, sort_order, active, updated_at
       FROM faqs
       ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map((r) => ({
      ...r,
      active: Boolean(r.active),
    }));
  res.json(rows);
});

app.post('/api/admin/faqs', requireAdmin, (req, res) => {
  const { question, answer, sortOrder, active } = req.body || {};
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const order = Number.isInteger(Number(sortOrder)) ? Number(sortOrder) : 0;
  if (!q || !a) {
    return res.status(400).json({ error: 'Question and answer are required' });
  }

  const info = db
    .prepare(
      `INSERT INTO faqs (question, answer, sort_order, active, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(q, a, order, active === false ? 0 : 1);

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/faqs/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const existing = db.prepare('SELECT id FROM faqs WHERE id = ?').get(id);
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

  db.prepare(
    `UPDATE faqs
     SET question = ?, answer = ?, sort_order = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(q, a, order, active ? 1 : 0, id);

  const row = db
    .prepare('SELECT id, question, answer, sort_order, active, updated_at FROM faqs WHERE id = ?')
    .get(id);
  res.json({
    ok: true,
    faq: {
      ...row,
      active: Boolean(row.active),
    },
  });
});

app.delete('/api/admin/faqs/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  const result = db.prepare('DELETE FROM faqs WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'FAQ not found' });
  }
  res.json({ ok: true });
});

app.post('/api/admin/games', requireAdmin, (req, res) => {
  const { title, platform, condition, condition_note, conditionNote, price, active } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  const normalizedCondition = normalizeCondition(condition ?? condition_note ?? conditionNote);

  const info = db
    .prepare(
      `INSERT INTO games
        (title, platform, condition_note, price_cents, active, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      title.trim(),
      normalizePlatform(platform),
      normalizedCondition,
      priceCents,
      active === false ? 0 : 1
    );

  const created = db
    .prepare(
      `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       WHERE id = ?`
    )
    .get(Number(info.lastInsertRowid));

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid), game: asPublicGame(created) });
});

app.put('/api/admin/games/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const existing = db.prepare('SELECT id FROM games WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const { title, platform, condition, condition_note, conditionNote, price, active } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }
  const normalizedCondition = normalizeCondition(condition ?? condition_note ?? conditionNote);

  db.prepare(
    `UPDATE games
     SET title = ?,
         platform = ?,
         condition_note = ?,
         price_cents = ?,
         active = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title.trim(),
    normalizePlatform(platform),
    normalizedCondition,
    priceCents,
    active ? 1 : 0,
    id
  );

  const updated = db
    .prepare(
      `SELECT id, title, platform, condition_note, price_cents, active, updated_at
       FROM games
       WHERE id = ?`
    )
    .get(id);

  res.json({
    ok: true,
    game: asPublicGame(updated),
  });
});

app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const result = db.prepare('DELETE FROM games WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Game not found' });
  }

  res.json({ ok: true });
});

app.post('/api/admin/games/import-csv', requireAdmin, (req, res) => {
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

  const insert = db.prepare(
    `INSERT INTO games
      (title, platform, condition_note, price_cents, active, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );

  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM games').run();
    for (const row of rows) {
      insert.run(
        row.title,
        row.platform,
        row.condition,
        row.priceCents,
        row.active
      );
    }
  });

  tx(parsed.rows);
  res.json({ ok: true, imported: parsed.rows.length });
});

app.get('/api/admin/games/export-csv', requireAdmin, (req, res) => {
  const filter = buildGameFilterWhere(req.query || {});
  const rows = db
    .prepare(
      `SELECT title, platform, condition_note, price_cents, active
       FROM games
       ${filter.whereSql}
       ORDER BY title ASC`
    )
    .all(...filter.params);

  const lines = ['title,platform,condition,price,active'];
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.platform || '',
        normalizeCondition(r.condition_note),
        (r.price_cents / 100).toFixed(2),
        r.active ? '1' : '0',
      ].join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="buylist.csv"');
  res.send(`${lines.join('\n')}\n`);
});

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Video game buylist app running on http://localhost:${port}`);
  });
}

module.exports = app;
