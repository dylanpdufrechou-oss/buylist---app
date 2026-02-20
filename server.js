require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY || 'change-this-admin-key';
const isVercel = process.env.VERCEL === '1';

const MARKET_SOURCE = 'pricecharting';
const MARKET_BADGE_THRESHOLD = Number(process.env.MARKET_BADGE_THRESHOLD || 70);
const DEFAULT_MARKET_SYNC_HOURS = 12;
const MARKET_PROXY_CACHE_HOURS = clampNumber(Number(process.env.MARKET_PROXY_CACHE_HOURS || 12), 6, 24);
const MARKET_PROXY_CACHE_MS = MARKET_PROXY_CACHE_HOURS * 60 * 60 * 1000;
const MARKET_API_TOKEN = String(process.env.PRICECHARTING_API_TOKEN || '').trim();

const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp' : path.join(__dirname, 'data'));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'buylist.db'));
db.pragma('journal_mode = WAL');

const marketResponseCache = new Map();
const marketProxyRateState = new Map();
let marketApiQueue = Promise.resolve();
let marketSyncRunning = false;
let lastMarketSyncStartedAt = 0;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDbDateToMs(value) {
  if (!value) return 0;
  const str = String(value);
  const normalized = str.includes('T') ? str : `${str.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

function getMarketSettings() {
  const showMarketPricesPublicRaw = String(getSettingValue('show_market_prices_public', '0'));
  const showPercentOfMarketRaw = String(getSettingValue('show_percent_of_market', '1'));
  const marketUpdateFrequencyRaw = Number(getSettingValue('market_update_frequency_hours', String(DEFAULT_MARKET_SYNC_HOURS)));

  return {
    showMarketPricesPublic: showMarketPricesPublicRaw === '1',
    showPercentOfMarket: showPercentOfMarketRaw !== '0',
    marketUpdateFrequencyHours: marketUpdateFrequencyRaw === 24 ? 24 : 12,
  };
}

function setMarketSettings(nextSettings) {
  const showMarketPricesPublic = nextSettings.showMarketPricesPublic ? '1' : '0';
  const showPercentOfMarket = nextSettings.showPercentOfMarket ? '1' : '0';
  const marketUpdateFrequencyHours = nextSettings.marketUpdateFrequencyHours === 24 ? '24' : '12';

  const tx = db.transaction(() => {
    db.prepare('UPDATE app_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?').run(
      showMarketPricesPublic,
      'show_market_prices_public'
    );
    db.prepare('UPDATE app_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?').run(
      showPercentOfMarket,
      'show_percent_of_market'
    );
    db.prepare('UPDATE app_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?').run(
      marketUpdateFrequencyHours,
      'market_update_frequency_hours'
    );
  });

  tx();
  return getMarketSettings();
}

function parsePriceToCents(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parseMarketPriceToCents(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric * 100);
  }
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed * 100);
  }
  return null;
}

function normalizeCondition() {
  return 'CIB';
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

function normalizeProductId(raw) {
  const value = safeString(raw);
  return value || null;
}

function firstPresent(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== null && obj[key] !== undefined && String(obj[key]).trim() !== '') {
      return obj[key];
    }
  }
  return null;
}

function marketBandFromPercent(percent) {
  if (!Number.isFinite(percent)) return 'N/A';
  if (percent >= 90) return 'Very High payout vs market';
  if (percent >= 75) return 'High payout vs market';
  if (percent >= 60) return 'Solid payout vs market';
  return 'Below target payout vs market';
}

function toItemSearchUrl(productName, consoleName) {
  const q = `${safeString(productName)} ${safeString(consoleName)}`.trim();
  if (!q) return null;
  return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(q)}`;
}

function sanitizeMarketProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = safeString(firstPresent(raw, ['id', 'product-id', 'product_id']));
  if (!id) return null;

  const productName = safeString(firstPresent(raw, ['product-name', 'product_name', 'name']));
  const consoleName = safeString(firstPresent(raw, ['console-name', 'console_name', 'console']));
  const upc = safeString(firstPresent(raw, ['upc']));
  const itemUrlRaw = safeString(firstPresent(raw, ['url', 'product-url', 'product_url', 'item-url', 'item_url']));

  const cibPriceCents = parseMarketPriceToCents(firstPresent(raw, ['cib-price', 'cib_price', 'cibPrice']));
  const loosePriceCents = parseMarketPriceToCents(firstPresent(raw, ['loose-price', 'loose_price', 'loosePrice']));
  const newPriceCents = parseMarketPriceToCents(firstPresent(raw, ['new-price', 'new_price', 'newPrice']));

  return {
    id,
    productName,
    consoleName,
    upc: upc || null,
    itemUrl: itemUrlRaw || toItemSearchUrl(productName, consoleName),
    cibPriceCents,
    loosePriceCents,
    newPriceCents,
    fetchedAt: new Date().toISOString(),
  };
}

function readCache(key) {
  const item = marketResponseCache.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    marketResponseCache.delete(key);
    return null;
  }
  return item.value;
}

function writeCache(key, value) {
  marketResponseCache.set(key, {
    value,
    expiresAt: Date.now() + MARKET_PROXY_CACHE_MS,
  });

  if (marketResponseCache.size > 2000) {
    const firstKey = marketResponseCache.keys().next().value;
    if (firstKey) marketResponseCache.delete(firstKey);
  }
}

function checkRateLimit(bucket, maxHits, windowMs) {
  const now = Date.now();
  const current = marketProxyRateState.get(bucket);
  if (!current || current.expiresAt <= now) {
    marketProxyRateState.set(bucket, { count: 1, expiresAt: now + windowMs });
    return false;
  }

  if (current.count >= maxHits) {
    return true;
  }

  current.count += 1;
  marketProxyRateState.set(bucket, current);
  return false;
}

function proxyRateLimit(maxHits, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    if (checkRateLimit(key, maxHits, windowMs)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
    }
    next();
  };
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'I_BuyGames Buylist/1.0',
          Accept: 'application/json',
        },
      },
      (resp) => {
        const statusCode = Number(resp.statusCode || 0);
        let body = '';

        resp.setEncoding('utf8');
        resp.on('data', (chunk) => {
          body += chunk;
        });

        resp.on('end', () => {
          if (statusCode >= 400) {
            return reject(new Error(`PriceCharting request failed (${statusCode}).`));
          }

          try {
            const parsed = body ? JSON.parse(body) : {};
            resolve(parsed);
          } catch {
            reject(new Error('PriceCharting returned invalid JSON.'));
          }
        });
      }
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error('PriceCharting request timed out.'));
    });

    req.on('error', (err) => reject(err));
  });
}

function runThroughMarketQueue(task) {
  const execute = async () => {
    const value = await task();
    await sleep(1000);
    return value;
  };

  const queued = marketApiQueue.then(execute, execute);
  marketApiQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

async function fetchMarketProductById(productId, { forceFresh = false } = {}) {
  if (!MARKET_API_TOKEN) {
    throw new Error('PriceCharting token is not configured.');
  }

  const normalizedId = normalizeProductId(productId);
  if (!normalizedId) {
    throw new Error('Product ID is required.');
  }

  const cacheKey = `product:${normalizedId}`;
  if (!forceFresh) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const url = `https://www.pricecharting.com/api/product?t=${encodeURIComponent(
    MARKET_API_TOKEN
  )}&id=${encodeURIComponent(normalizedId)}`;

  const payload = await runThroughMarketQueue(() => httpGetJson(url));
  const product = sanitizeMarketProduct(payload);
  if (!product) {
    throw new Error('No product found for that ID.');
  }

  writeCache(cacheKey, product);
  return product;
}

async function searchMarketProducts(query, { limit = 5 } = {}) {
  if (!MARKET_API_TOKEN) {
    throw new Error('PriceCharting token is not configured.');
  }

  const normalizedQuery = safeString(query);
  if (!normalizedQuery) {
    return [];
  }

  const cacheKey = `search:${normalizedQuery.toLowerCase()}`;
  const cached = readCache(cacheKey);
  if (cached) return cached.slice(0, limit);

  const url = `https://www.pricecharting.com/api/products?t=${encodeURIComponent(
    MARKET_API_TOKEN
  )}&q=${encodeURIComponent(normalizedQuery)}`;

  const payload = await runThroughMarketQueue(() => httpGetJson(url));
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  const normalized = rows.map((row) => sanitizeMarketProduct(row)).filter(Boolean).slice(0, Math.max(1, limit));

  writeCache(cacheKey, normalized);
  return normalized;
}

function findDuplicateProductId(productId, ignoreGameId = null) {
  const normalized = normalizeProductId(productId);
  if (!normalized) return null;

  if (Number.isInteger(ignoreGameId)) {
    return db
      .prepare('SELECT id, title FROM games WHERE pricecharting_product_id = ? AND id != ? LIMIT 1')
      .get(normalized, ignoreGameId);
  }

  return db.prepare('SELECT id, title FROM games WHERE pricecharting_product_id = ? LIMIT 1').get(normalized);
}

function asPublicGame(row, marketSettings, { adminView = false } = {}) {
  const marketCibCents = Number.isInteger(row.market_cib_price_cents) ? row.market_cib_price_cents : null;
  const offerPercent = marketCibCents && marketCibCents > 0 ? Number(((row.price_cents / marketCibCents) * 100).toFixed(1)) : null;

  const showRawMarket = adminView || marketSettings.showMarketPricesPublic;

  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    condition_note: normalizeCondition(),
    price_cents: row.price_cents,
    price: centsToMoney(row.price_cents),
    active: Boolean(row.active),
    updated_at: row.updated_at,
    pricecharting_product_id: row.pricecharting_product_id || null,
    market_source: row.market_source || MARKET_SOURCE,
    market_last_checked_at: row.market_last_checked_at || null,
    market_item_url: row.market_item_url || null,
    market_offer_percent: offerPercent,
    market_payout_band: marketBandFromPercent(offerPercent),
    market_badge_threshold: MARKET_BADGE_THRESHOLD,
    market_cib_price_cents: showRawMarket ? marketCibCents : null,
    market_loose_price_cents: showRawMarket && Number.isInteger(row.market_loose_price_cents) ? row.market_loose_price_cents : null,
    market_new_price_cents: showRawMarket && Number.isInteger(row.market_new_price_cents) ? row.market_new_price_cents : null,
    market_cib_price: showRawMarket ? centsToMoney(marketCibCents) : null,
    market_loose_price: showRawMarket ? centsToMoney(row.market_loose_price_cents) : null,
    market_new_price: showRawMarket ? centsToMoney(row.market_new_price_cents) : null,
  };
}

function getGameRows(includeInactive) {
  const sql = includeInactive
    ? `SELECT id, title, platform, condition_note, price_cents, active, updated_at,
              pricecharting_product_id, market_source, market_last_checked_at,
              market_cib_price_cents, market_new_price_cents, market_loose_price_cents, market_item_url
       FROM games
       ORDER BY title ASC`
    : `SELECT id, title, platform, condition_note, price_cents, active, updated_at,
              pricecharting_product_id, market_source, market_last_checked_at,
              market_cib_price_cents, market_new_price_cents, market_loose_price_cents, market_item_url
       FROM games
       WHERE active = 1
       ORDER BY title ASC`;

  return db.prepare(sql).all();
}

function shouldCaptureSnapshot(lastCapturedAt, frequencyHours) {
  if (!lastCapturedAt) return true;
  const lastMs = parseDbDateToMs(lastCapturedAt);
  if (!lastMs) return true;
  return Date.now() - lastMs >= frequencyHours * 60 * 60 * 1000;
}

async function fetchMarketProductWithRetry(productId, attempts = 3) {
  let currentAttempt = 0;
  let delayMs = 700;

  while (currentAttempt < attempts) {
    try {
      return await fetchMarketProductById(productId, { forceFresh: true });
    } catch (err) {
      currentAttempt += 1;
      if (currentAttempt >= attempts) throw err;
      await sleep(delayMs);
      delayMs *= 2;
    }
  }

  throw new Error('Market fetch retry exhausted.');
}

async function runMarketSyncJob({ forceRun = false, forceCapture = false, reason = 'scheduled' } = {}) {
  if (!MARKET_API_TOKEN) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing-token',
      message: 'PRICECHARTING_API_TOKEN is not configured.',
    };
  }

  if (marketSyncRunning) {
    return {
      ok: false,
      skipped: true,
      reason: 'already-running',
    };
  }

  const marketSettings = getMarketSettings();
  const now = Date.now();
  const requiredGapMs = marketSettings.marketUpdateFrequencyHours * 60 * 60 * 1000;
  if (!forceRun && lastMarketSyncStartedAt > 0 && now - lastMarketSyncStartedAt < requiredGapMs) {
    return {
      ok: true,
      skipped: true,
      reason: 'sync-window-not-reached',
      nextEligibleInMs: requiredGapMs - (now - lastMarketSyncStartedAt),
    };
  }

  marketSyncRunning = true;
  lastMarketSyncStartedAt = now;

  const updateGameStmt = db.prepare(
    `UPDATE games
     SET market_source = ?,
         market_last_checked_at = datetime('now'),
         market_cib_price_cents = ?,
         market_new_price_cents = ?,
         market_loose_price_cents = ?,
         market_item_url = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  );
  const latestHistoryStmt = db.prepare(
    `SELECT captured_at
     FROM market_price_history
     WHERE buylist_item_id = ? AND source = ?
     ORDER BY captured_at DESC
     LIMIT 1`
  );
  const insertHistoryStmt = db.prepare(
    `INSERT INTO market_price_history
      (buylist_item_id, source, captured_at, cib_price_cents, new_price_cents, loose_price_cents)
     VALUES (?, ?, datetime('now'), ?, ?, ?)`
  );

  const targets = db
    .prepare(
      `SELECT id, title, platform, pricecharting_product_id
       FROM games
       WHERE active = 1 AND pricecharting_product_id IS NOT NULL AND trim(pricecharting_product_id) != ''
       ORDER BY id ASC`
    )
    .all();

  const summary = {
    ok: true,
    skipped: false,
    reason,
    total: targets.length,
    synced: 0,
    failed: 0,
    snapshotInserted: 0,
    errors: [],
    startedAt: new Date(now).toISOString(),
  };

  try {
    for (const game of targets) {
      try {
        const market = await fetchMarketProductWithRetry(game.pricecharting_product_id, 3);

        updateGameStmt.run(
          MARKET_SOURCE,
          market.cibPriceCents,
          market.newPriceCents,
          market.loosePriceCents,
          market.itemUrl,
          game.id
        );

        const latest = latestHistoryStmt.get(game.id, MARKET_SOURCE);
        const shouldCapture =
          forceCapture || shouldCaptureSnapshot(latest?.captured_at, marketSettings.marketUpdateFrequencyHours);

        if (shouldCapture) {
          insertHistoryStmt.run(
            game.id,
            MARKET_SOURCE,
            market.cibPriceCents,
            market.newPriceCents,
            market.loosePriceCents
          );
          summary.snapshotInserted += 1;
        }

        summary.synced += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          gameId: game.id,
          title: game.title,
          error: err.message || 'Unknown sync error',
        });
      }
    }
  } finally {
    marketSyncRunning = false;
    summary.finishedAt = new Date().toISOString();
  }

  return summary;
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

  ensureColumn('games', 'pricecharting_product_id', 'TEXT');
  ensureColumn('games', 'market_source', `TEXT DEFAULT '${MARKET_SOURCE}'`);
  ensureColumn('games', 'market_last_checked_at', 'TEXT');
  ensureColumn('games', 'market_cib_price_cents', 'INTEGER');
  ensureColumn('games', 'market_new_price_cents', 'INTEGER');
  ensureColumn('games', 'market_loose_price_cents', 'INTEGER');
  ensureColumn('games', 'market_item_url', 'TEXT');
  ensureColumn('submissions', 'updated_at', 'TEXT');
  ensureColumn('submissions', 'status', "TEXT NOT NULL DEFAULT 'Pending'");
  ensureColumn('submissions', 'price_version', 'TEXT');
  ensureColumn('submissions', 'estimated_total_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('submissions', 'internal_notes', 'TEXT');
  ensureColumn('submission_items', 'title_at_submit', 'TEXT');
  ensureColumn('submission_items', 'platform_at_submit', 'TEXT');
  ensureColumn('submission_items', 'unit_price_cents_at_submit', 'INTEGER');
  ensureColumn('submission_items', 'line_total_cents_at_submit', 'INTEGER');

  setDefaultSetting('show_market_prices_public', '0');
  setDefaultSetting('show_percent_of_market', '1');
  setDefaultSetting('market_update_frequency_hours', String(DEFAULT_MARKET_SYNC_HOURS));
  setDefaultSetting('current_buylist_version', currentMonthVersion());

  const count = db.prepare('SELECT COUNT(*) AS c FROM games').get().c;
  if (count === 0) {
    const seed = db.prepare(
      `INSERT INTO games
        (title, platform, condition_note, price_cents, active, market_source)
       VALUES (?, ?, ?, ?, 1, ?)`
    );
    const rows = [
      ['Wii Sports Resort', 'Wii', normalizeCondition(), 600, MARKET_SOURCE],
      ['Metal Gear Solid 3: Subsistence', 'PS2', normalizeCondition(), 1200, MARKET_SOURCE],
      ['Uncharted 2: Among Thieves', 'PS3', normalizeCondition(), 500, MARKET_SOURCE],
      ['Halo 2', 'OG Xbox', normalizeCondition(), 700, MARKET_SOURCE],
      ['Gears of War 3', 'Xbox 360', normalizeCondition(), 400, MARKET_SOURCE],
      ['Super Mario 3D World', 'Wii U', normalizeCondition(), 800, MARKET_SOURCE],
      ['Pokemon Omega Ruby', '3DS', normalizeCondition(), 1600, MARKET_SOURCE],
      ['Mario Kart DS', 'DS', normalizeCondition(), 900, MARKET_SOURCE],
    ];
    const tx = db.transaction((items) => {
      for (const row of items) seed.run(...row);
    });
    tx(rows);
  }

  db.prepare('UPDATE games SET condition_note = ?').run(normalizeCondition());

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/settings/public', (req, res) => {
  const settings = getMarketSettings();
  res.json({
    show_market_prices_public: settings.showMarketPricesPublic,
    show_percent_of_market: settings.showPercentOfMarket,
    market_badge_threshold: MARKET_BADGE_THRESHOLD,
  });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = getMarketSettings();
  const currentBuylistVersion = normalizeBuylistVersion(getSettingValue('current_buylist_version', currentMonthVersion()));
  res.json({
    show_market_prices_public: settings.showMarketPricesPublic,
    show_percent_of_market: settings.showPercentOfMarket,
    market_update_frequency_hours: settings.marketUpdateFrequencyHours,
    current_buylist_version: currentBuylistVersion,
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { show_market_prices_public, show_percent_of_market, market_update_frequency_hours, current_buylist_version } =
    req.body || {};
  const currentSettings = getMarketSettings();

  const next = setMarketSettings({
    showMarketPricesPublic:
      show_market_prices_public === undefined
        ? currentSettings.showMarketPricesPublic
        : show_market_prices_public === true || show_market_prices_public === 1,
    showPercentOfMarket:
      show_percent_of_market === undefined
        ? currentSettings.showPercentOfMarket
        : show_percent_of_market !== false && show_percent_of_market !== 0,
    marketUpdateFrequencyHours:
      market_update_frequency_hours === undefined
        ? currentSettings.marketUpdateFrequencyHours
        : Number(market_update_frequency_hours) === 24
          ? 24
          : 12,
  });

  const currentBuylistVersion = normalizeBuylistVersion(current_buylist_version);
  db.prepare("UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
    currentBuylistVersion,
    'current_buylist_version'
  );

  res.json({
    ok: true,
    settings: {
      show_market_prices_public: next.showMarketPricesPublic,
      show_percent_of_market: next.showPercentOfMarket,
      market_update_frequency_hours: next.marketUpdateFrequencyHours,
      current_buylist_version: currentBuylistVersion,
    },
  });
});

app.get('/api/games', (req, res) => {
  const adminView = req.headers['x-admin-key'] === adminKey;
  const includeInactive = adminView && req.query.includeInactive === 'true';
  const settings = getMarketSettings();
  const rows = getGameRows(includeInactive).map((row) => asPublicGame(row, settings, { adminView }));
  res.json(rows);
});

app.get('/api/admin/games', requireAdmin, (req, res) => {
  const settings = getMarketSettings();
  const rows = getGameRows(true).map((row) => asPublicGame(row, settings, { adminView: true }));
  res.json(rows);
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

app.get('/api/market/history', (req, res) => {
  const adminView = req.headers['x-admin-key'] === adminKey;
  const marketSettings = getMarketSettings();
  if (!adminView && !marketSettings.showMarketPricesPublic) {
    return res.status(403).json({ error: 'Market history is not publicly enabled.' });
  }

  const gameId = Number(req.query.gameId);
  const daysRaw = Number(req.query.days || 90);
  const days = clampNumber(daysRaw, 7, 365);

  if (!Number.isInteger(gameId)) {
    return res.status(400).json({ error: 'Valid gameId is required.' });
  }

  const game = db
    .prepare(
      `SELECT id, title, platform, market_last_checked_at, market_item_url, pricecharting_product_id
       FROM games
       WHERE id = ? AND active = 1`
    )
    .get(gameId);

  if (!game) {
    return res.status(404).json({ error: 'Game not found.' });
  }

  const points = db
    .prepare(
      `SELECT captured_at, cib_price_cents, new_price_cents, loose_price_cents
       FROM market_price_history
       WHERE buylist_item_id = ?
         AND source = ?
         AND captured_at >= datetime('now', ?)
       ORDER BY captured_at ASC`
    )
    .all(gameId, MARKET_SOURCE, `-${days} days`)
    .map((row) => ({
      captured_at: row.captured_at,
      cib_price: centsToMoney(row.cib_price_cents),
      new_price: centsToMoney(row.new_price_cents),
      loose_price: centsToMoney(row.loose_price_cents),
      cib_price_cents: Number.isInteger(row.cib_price_cents) ? row.cib_price_cents : null,
    }));

  res.json({
    game: {
      id: game.id,
      title: game.title,
      platform: game.platform,
      market_last_checked_at: game.market_last_checked_at,
      market_item_url: game.market_item_url,
      pricecharting_product_id: game.pricecharting_product_id,
    },
    points,
  });
});

app.get('/api/market/product', requireAdmin, proxyRateLimit(40, 60 * 1000), async (req, res) => {
  try {
    const id = normalizeProductId(req.query.id);
    if (!id) return res.status(400).json({ error: 'Product id is required.' });

    const product = await fetchMarketProductById(id, { forceFresh: req.query.force === 'true' });
    res.json({
      id: product.id,
      product_name: product.productName,
      console_name: product.consoleName,
      cib_price: centsToMoney(product.cibPriceCents),
      loose_price: centsToMoney(product.loosePriceCents),
      new_price: centsToMoney(product.newPriceCents),
      upc: product.upc,
      item_url: product.itemUrl,
      fetched_at: product.fetchedAt,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch market product.' });
  }
});

app.get('/api/market/search', requireAdmin, proxyRateLimit(30, 60 * 1000), async (req, res) => {
  try {
    const q = safeString(req.query.q);
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
    }

    const products = await searchMarketProducts(q, { limit: 5 });
    res.json(
      products.map((item) => ({
        id: item.id,
        product_name: item.productName,
        console_name: item.consoleName,
        upc: item.upc,
        item_url: item.itemUrl,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not search market products.' });
  }
});

app.post('/api/admin/market/sync', requireAdmin, async (req, res) => {
  try {
    const summary = await runMarketSyncJob({
      forceRun: req.body?.forceRun === true,
      forceCapture: req.body?.forceCapture === true,
      reason: 'manual',
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Market sync failed.' });
  }
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
  const { title, platform, price, active, pricechartingProductId } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }

  const normalizedProductId = normalizeProductId(pricechartingProductId);
  const duplicate = findDuplicateProductId(normalizedProductId);
  if (duplicate) {
    return res.status(409).json({
      error: `PriceCharting Product ID already used by "${duplicate.title}" (ID ${duplicate.id}).`,
    });
  }

  const info = db
    .prepare(
      `INSERT INTO games
        (title, platform, condition_note, price_cents, active, pricecharting_product_id, market_source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      title.trim(),
      (platform || '').trim(),
      normalizeCondition(),
      priceCents,
      active === false ? 0 : 1,
      normalizedProductId,
      MARKET_SOURCE
    );

  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/games/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const existing = db
    .prepare(
      `SELECT id, pricecharting_product_id,
              market_last_checked_at, market_cib_price_cents, market_new_price_cents, market_loose_price_cents, market_item_url
       FROM games
       WHERE id = ?`
    )
    .get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const { title, platform, price, active, pricechartingProductId } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required' });
  }

  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    return res.status(400).json({ error: 'Price must be a non-negative number' });
  }

  const normalizedProductId = normalizeProductId(pricechartingProductId);
  const duplicate = findDuplicateProductId(normalizedProductId, id);
  if (duplicate) {
    return res.status(409).json({
      error: `PriceCharting Product ID already used by "${duplicate.title}" (ID ${duplicate.id}).`,
    });
  }

  const productChanged = normalizeProductId(existing.pricecharting_product_id) !== normalizedProductId;

  db.prepare(
    `UPDATE games
     SET title = ?,
         platform = ?,
         condition_note = ?,
         price_cents = ?,
         active = ?,
         pricecharting_product_id = ?,
         market_source = ?,
         market_last_checked_at = ?,
         market_cib_price_cents = ?,
         market_new_price_cents = ?,
         market_loose_price_cents = ?,
         market_item_url = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title.trim(),
    (platform || '').trim(),
    normalizeCondition(),
    priceCents,
    active ? 1 : 0,
    normalizedProductId,
    MARKET_SOURCE,
    productChanged ? null : existing.market_last_checked_at,
    productChanged ? null : existing.market_cib_price_cents,
    productChanged ? null : existing.market_new_price_cents,
    productChanged ? null : existing.market_loose_price_cents,
    productChanged ? null : existing.market_item_url,
    id
  );

  const updated = db
    .prepare(
      `SELECT id, title, platform, condition_note, price_cents, active, updated_at,
              pricecharting_product_id, market_source, market_last_checked_at,
              market_cib_price_cents, market_new_price_cents, market_loose_price_cents, market_item_url
       FROM games
       WHERE id = ?`
    )
    .get(id);

  res.json({
    ok: true,
    game: asPublicGame(updated, getMarketSettings(), { adminView: true }),
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

  db.prepare('DELETE FROM market_price_history WHERE buylist_item_id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/games/import-csv', requireAdmin, (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV content is required' });
  }

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must include a header and at least one row' });
  }

  const header = lines[0].toLowerCase();
  const expectedLegacy = 'title,platform,condition,price,active';
  const expectedExtended = 'title,platform,condition,price,active,pricecharting_product_id';
  const supportsProductId = header === expectedExtended;
  if (!supportsProductId && header !== expectedLegacy) {
    return res.status(400).json({
      error: `Invalid header. Use exactly: ${expectedLegacy} or ${expectedExtended}`,
    });
  }

  const insert = db.prepare(
    `INSERT INTO games
      (title, platform, condition_note, price_cents, active, pricecharting_product_id, market_source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM market_price_history').run();
    db.prepare('DELETE FROM games').run();
    for (const row of rows) {
      insert.run(
        row.title,
        row.platform,
        row.conditionNote,
        row.priceCents,
        row.active,
        row.pricechartingProductId,
        MARKET_SOURCE
      );
    }
  });

  const parsed = [];
  const seenProductIds = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    const expectedLen = supportsProductId ? 6 : 5;
    if (parts.length !== expectedLen) {
      return res.status(400).json({ error: `Invalid row ${i + 1}` });
    }

    const [title, platform, _conditionNote, priceRaw, activeRaw, productIdRaw = ''] = parts.map((v) => v.trim());
    const priceCents = parsePriceToCents(priceRaw);
    if (!title || priceCents === null) {
      return res.status(400).json({ error: `Invalid values in row ${i + 1}` });
    }

    const pricechartingProductId = normalizeProductId(productIdRaw);
    if (pricechartingProductId) {
      if (seenProductIds.has(pricechartingProductId)) {
        return res.status(400).json({ error: `Duplicate PriceCharting Product ID in CSV row ${i + 1}` });
      }
      seenProductIds.add(pricechartingProductId);
    }

    parsed.push({
      title,
      platform,
      conditionNote: normalizeCondition(),
      priceCents,
      active: activeRaw === '0' || activeRaw.toLowerCase() === 'false' ? 0 : 1,
      pricechartingProductId,
    });
  }

  tx(parsed);
  res.json({ ok: true, imported: parsed.length });
});

app.get('/api/admin/games/export-csv', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT title, platform, condition_note, price_cents, active, pricecharting_product_id
       FROM games
       ORDER BY title ASC`
    )
    .all();

  const lines = ['title,platform,condition,price,active,pricecharting_product_id'];
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.platform || '',
        normalizeCondition(),
        (r.price_cents / 100).toFixed(2),
        r.active ? '1' : '0',
        r.pricecharting_product_id || '',
      ].join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="buylist.csv"');
  res.send(`${lines.join('\n')}\n`);
});

if (!isVercel) {
  setInterval(() => {
    runMarketSyncJob({ reason: 'scheduled' }).catch(() => {});
  }, 60 * 60 * 1000);

  setTimeout(() => {
    runMarketSyncJob({ reason: 'startup' }).catch(() => {});
  }, 15000);

  app.listen(port, () => {
    console.log(`Video game buylist app running on http://localhost:${port}`);
  });
}

module.exports = app;
