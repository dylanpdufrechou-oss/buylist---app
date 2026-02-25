const adminKeyInput = document.getElementById('adminKey');
const connectBtn = document.getElementById('connect');
const adminApp = document.getElementById('adminApp');
const adminMessage = document.getElementById('adminMessage');

const currentBuylistVersionInput = document.getElementById('currentBuylistVersion');
const showPriceChangeHighlightsInput = document.getElementById('showPriceChangeHighlights');
const shipToBusinessNameInput = document.getElementById('shipToBusinessName');
const shipToContactNameInput = document.getElementById('shipToContactName');
const shipToAddressLine1Input = document.getElementById('shipToAddressLine1');
const shipToAddressLine2Input = document.getElementById('shipToAddressLine2');
const shipToCityInput = document.getElementById('shipToCity');
const shipToStateInput = document.getElementById('shipToState');
const shipToPostalCodeInput = document.getElementById('shipToPostalCode');
const shipToCountryInput = document.getElementById('shipToCountry');
const packingNextStepsTextInput = document.getElementById('packingNextStepsText');
const saveBuylistVersionBtn = document.getElementById('saveBuylistVersion');
const publishBuylistSnapshotBtn = document.getElementById('publishBuylistSnapshot');
const lastPublishedVersionEl = document.getElementById('lastPublishedVersion');
const lastPublishedAtEl = document.getElementById('lastPublishedAt');
const comparisonBaselineVersionEl = document.getElementById('comparisonBaselineVersion');
const lastPublishedAtWrap = document.getElementById('lastPublishedAtWrap');

const addGameForm = document.getElementById('addGameForm');
const gamesWrap = document.getElementById('gamesWrap');
const refreshGamesBtn = document.getElementById('refreshGames');
const saveAllGamesBtn = document.getElementById('saveAllGames');
const exportCsvBtn = document.getElementById('exportCsv');
const exportFilteredCsvBtn = document.getElementById('exportFilteredCsv');
const importCsvInput = document.getElementById('importCsv');
const addTitleInput = document.getElementById('title');
const addPlatformInput = document.getElementById('platform');
const addConditionInput = document.getElementById('condition');
const addPriceInput = document.getElementById('price');
const addActiveInput = document.getElementById('active');

const gamesSearchInput = document.getElementById('gamesSearch');
const gamesFilterPlatformInput = document.getElementById('gamesFilterPlatform');
const gamesFilterConditionInput = document.getElementById('gamesFilterCondition');
const gamesFilterActiveInput = document.getElementById('gamesFilterActive');
const gamesFilterChangeInput = document.getElementById('gamesFilterChange');
const gamesFilterPriceMinInput = document.getElementById('gamesFilterPriceMin');
const gamesFilterPriceMaxInput = document.getElementById('gamesFilterPriceMax');
const gamesRowsPerPageInput = document.getElementById('gamesRowsPerPage');
const clearGameFiltersBtn = document.getElementById('clearGameFilters');
const gamesFilterCount = document.getElementById('gamesFilterCount');
const gamesPaginationWrap = document.getElementById('gamesPagination');

const bulkToolbar = document.getElementById('bulkToolbar');
const bulkSelectedCount = document.getElementById('bulkSelectedCount');
const bulkSetActiveInput = document.getElementById('bulkSetActive');
const applyBulkActiveBtn = document.getElementById('applyBulkActive');
const bulkSetConditionInput = document.getElementById('bulkSetCondition');
const applyBulkConditionBtn = document.getElementById('applyBulkCondition');
const bulkPriceDirectionInput = document.getElementById('bulkPriceDirection');
const bulkPriceModeInput = document.getElementById('bulkPriceMode');
const bulkPriceValueInput = document.getElementById('bulkPriceValue');
const applyBulkPriceAdjustBtn = document.getElementById('applyBulkPriceAdjust');
const bulkRound99Btn = document.getElementById('bulkRound99');
const bulkRoundDollarBtn = document.getElementById('bulkRoundDollar');
const bulkDeleteSelectedBtn = document.getElementById('bulkDeleteSelected');

const saveChangesBar = document.getElementById('saveChangesBar');
const unsavedChangesCount = document.getElementById('unsavedChangesCount');
const saveChangesBtn = document.getElementById('saveChangesBtn');

const importPreviewPanel = document.getElementById('importPreviewPanel');
const importPreviewSummary = document.getElementById('importPreviewSummary');
const importPreviewErrors = document.getElementById('importPreviewErrors');
const importPreviewRows = document.getElementById('importPreviewRows');
const importModeInput = document.getElementById('importMode');
const importSkipDuplicatesInput = document.getElementById('importSkipDuplicates');
const importStopOnErrorInput = document.getElementById('importStopOnError');
const importReplaceConfirmInput = document.getElementById('importReplaceConfirm');
const commitImportBtn = document.getElementById('commitImport');
const cancelImportBtn = document.getElementById('cancelImport');

const addFaqForm = document.getElementById('addFaqForm');
const faqWrap = document.getElementById('faqWrap');

const submissionsStatusFilterInput = document.getElementById('submissionsStatusFilter');
const submissionsSearchInput = document.getElementById('submissionsSearch');
const submissionsSortInput = document.getElementById('submissionsSort');
const applySubmissionFiltersBtn = document.getElementById('applySubmissionFilters');
const clearSubmissionFiltersBtn = document.getElementById('clearSubmissionFilters');
const exportFilteredSubmissionsCsvBtn = document.getElementById('exportFilteredSubmissionsCsv');
const submissionsTableWrap = document.getElementById('submissionsTableWrap');
const submissionsPaginationWrap = document.getElementById('submissionsPagination');

const submissionDetailModal = document.getElementById('submissionDetailModal');
const closeSubmissionDetailBtn = document.getElementById('closeSubmissionDetail');
const submissionDetailBody = document.getElementById('submissionDetailBody');

const toastContainer = document.getElementById('toastContainer');

let adminKey = '';
let games = [];
let gameDrafts = new Map();
const selectedGameIds = new Set();
let pendingImportCsv = '';
let pendingImportPreview = null;
let faqs = [];
const platformOptions = [
  'Wii',
  'PS3',
  'PS2',
  'PS4',
  'OG Xbox',
  'Xbox 360',
  'Xbox One',
  'Wii U',
  'Nintendo Switch',
  '3DS',
  'DS',
];
const BUYLIST_UPDATED_EVENT = 'buylistUpdatedAt';
const BUYLIST_SNAPSHOT_EVENT = 'buylistSnapshot';
const LAST_PLATFORM_KEY = 'adminLastPlatform';
const LAST_CONDITION_KEY = 'adminLastCondition';
const EPHEMERAL_SNAPSHOT_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const EPHEMERAL_RESET_MAX_SERVER_ROWS = 12;
const EPHEMERAL_RESTORE_MIN_SNAPSHOT_ROWS = 10;
const EPHEMERAL_RESTORE_MIN_DIFF = 5;
const GAMES_ROWS_PER_PAGE_OPTIONS = [10, 20, 25, 50, 100];
const GAMES_ROWS_PER_PAGE_DEFAULT = 25;
const GAMES_ROWS_PER_PAGE_STORAGE_KEY = 'adminGamesRowsPerPage';
const DEFAULT_SEED_TITLES = new Set([
  'Wii Sports Resort',
  'Metal Gear Solid 3: Subsistence',
  'Uncharted 2: Among Thieves',
  'Halo 2',
  'Gears of War 3',
  'Super Mario 3D World',
  'Pokemon Omega Ruby',
  'Mario Kart DS',
]);

const gameFilters = {
  search: '',
  platform: 'all',
  condition: 'all',
  active: 'all',
  change: 'all',
  minPrice: '',
  maxPrice: '',
};
let gamesTableState = {
  page: 1,
  pageSize: loadGamesRowsPerPagePreference(),
};

let submissionsState = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
  status: 'All',
  q: '',
  sort: 'newest',
};
let runtimeInfo = { isVercel: false, ephemeralStorage: false, persistentStorage: true, dbProvider: 'sqlite' };
let hasAttemptedEphemeralRestore = false;
let adminSettings = {
  current_buylist_version: '',
  show_price_change_highlights_public: true,
  ship_to_business_name: '',
  ship_to_contact_name: '',
  ship_to_address_line1: '',
  ship_to_address_line2: '',
  ship_to_city: '',
  ship_to_state: '',
  ship_to_postal_code: '',
  ship_to_country: '',
  packing_next_steps_text: '',
  last_published_version: null,
  last_published_at: null,
  comparison_baseline_version: null,
};

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderNotice(text, type = 'ok') {
  if (!text) {
    adminMessage.innerHTML = '';
    return;
  }
  adminMessage.innerHTML = `<div class="notice ${type}">${escapeHtml(text)}</div>`;
}

function showToast(text, type = 'ok') {
  if (!toastContainer || !text) return;
  const node = document.createElement('div');
  node.className = `toast-item ${type}`;
  node.textContent = text;
  toastContainer.appendChild(node);

  setTimeout(() => {
    node.classList.add('fade-out');
    setTimeout(() => node.remove(), 220);
  }, 1800);
}

function money(price) {
  return `$${Number(price).toFixed(2)}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
}

function formatSignedMoneyFromCents(cents) {
  const amount = Number(cents || 0) / 100;
  const abs = Math.abs(amount).toFixed(2);
  return `${amount >= 0 ? '+' : '-'}$${abs}`;
}

function normalizeChangeDirection(rawDirection) {
  const direction = String(rawDirection || '').toLowerCase();
  if (direction === 'up' || direction === 'down' || direction === 'same' || direction === 'new') return direction;
  return 'none';
}

function getPriceChangeMeta(draft) {
  const currentPriceCents = Math.round(Number(draft.price || 0) * 100);
  const previousPriceCents =
    draft.previous_price_cents === null || draft.previous_price_cents === undefined
      ? null
      : Number(draft.previous_price_cents);

  const baselineVersion = String(draft.comparison_baseline_version || '').trim();
  if (!baselineVersion) {
    return {
      direction: 'none',
      rowClass: '',
      noteClass: 'none',
      noteText: '',
      tooltip: '',
    };
  }

  if (previousPriceCents === null || !Number.isFinite(previousPriceCents)) {
    return {
      direction: 'new',
      rowClass: 'price-new',
      noteClass: 'new',
      noteText: 'New this version',
      tooltip: `No prior price in ${baselineVersion}`,
    };
  }

  const changeCents = currentPriceCents - previousPriceCents;
  const changePercent =
    previousPriceCents > 0 ? Number(((changeCents / previousPriceCents) * 100).toFixed(1)) : null;
  if (changeCents > 0) {
    return {
      direction: 'up',
      rowClass: 'price-up',
      noteClass: 'up',
      noteText: `▲ ${formatSignedMoneyFromCents(changeCents)}${
        changePercent === null ? '' : ` (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%)`
      }`,
      tooltip: `Was ${money(previousPriceCents / 100)} in ${baselineVersion}`,
    };
  }
  if (changeCents < 0) {
    return {
      direction: 'down',
      rowClass: 'price-down',
      noteClass: 'down',
      noteText: `▼ ${formatSignedMoneyFromCents(changeCents)}${
        changePercent === null ? '' : ` (${changePercent.toFixed(1)}%)`
      }`,
      tooltip: `Was ${money(previousPriceCents / 100)} in ${baselineVersion}`,
    };
  }

  return {
    direction: 'same',
    rowClass: 'price-same',
    noteClass: 'same',
    noteText: 'No change',
    tooltip: `Same as ${baselineVersion}`,
  };
}

function renderPublishMeta() {
  if (!lastPublishedVersionEl || !comparisonBaselineVersionEl) return;
  const lastVersion = adminSettings.last_published_version || '-';
  const baselineVersion = adminSettings.comparison_baseline_version || 'None';
  lastPublishedVersionEl.textContent = lastVersion;
  comparisonBaselineVersionEl.textContent = baselineVersion;

  if (lastPublishedAtEl) {
    lastPublishedAtEl.textContent = adminSettings.last_published_at ? formatDateTime(adminSettings.last_published_at) : '-';
  }
  if (lastPublishedAtWrap) {
    lastPublishedAtWrap.style.display = adminSettings.last_published_version ? 'inline' : 'none';
  }
  if (showPriceChangeHighlightsInput) {
    showPriceChangeHighlightsInput.value = adminSettings.show_price_change_highlights_public ? '1' : '0';
  }
}

function renderPlatformSelect(id, selectedValue) {
  const dynamicPlatforms = getAllPlatformsFromDrafts();
  const mergedOptions = Array.from(new Set([...platformOptions, ...dynamicPlatforms]));
  const normalizedSelected = selectedValue || '';
  const hasSelected = normalizedSelected && mergedOptions.includes(normalizedSelected);
  return `
    <select data-field="platform" data-id="${id}">
      <option value="">Select Platform</option>
      ${
        !hasSelected && normalizedSelected
          ? `<option value="${escapeHtml(normalizedSelected)}" selected>${escapeHtml(normalizedSelected)}</option>`
          : ''
      }
      ${mergedOptions
        .map(
          (platform) =>
            `<option value="${escapeHtml(platform)}" ${normalizedSelected === platform ? 'selected' : ''}>${escapeHtml(
              platform
            )}</option>`
        )
        .join('')}
    </select>
  `;
}

function normalizeConditionValue(raw) {
  const value = String(raw || '').trim();
  return value || 'CIB';
}

function renderConditionSelect(id, selectedValue) {
  const options = getAllConditionsFromDrafts();
  const normalizedSelected = normalizeConditionValue(selectedValue);
  const merged = options.includes(normalizedSelected) ? options : [...options, normalizedSelected];

  return `
    <select data-field="condition_note" data-id="${id}">
      ${merged
        .map(
          (condition) =>
            `<option value="${escapeHtml(condition)}" ${normalizedSelected === condition ? 'selected' : ''}>${escapeHtml(
              condition
            )}</option>`
        )
        .join('')}
    </select>
  `;
}

function getGameById(id) {
  return games.find((g) => g.id === id);
}

function getDraftById(id) {
  return gameDrafts.get(id);
}

function gameToDraft(game) {
  return {
    id: game.id,
    title: String(game.title || ''),
    platform: String(game.platform || ''),
    condition_note: normalizeConditionValue(game.condition_note),
    price: Number(game.price || 0),
    active: Boolean(game.active),
    previous_price_cents:
      game.previous_price_cents === null || game.previous_price_cents === undefined
        ? null
        : Number(game.previous_price_cents),
    previous_price: game.previous_price ?? null,
    price_change_cents:
      game.price_change_cents === null || game.price_change_cents === undefined
        ? null
        : Number(game.price_change_cents),
    price_change_percent:
      game.price_change_percent === null || game.price_change_percent === undefined
        ? null
        : Number(game.price_change_percent),
    price_change_direction: String(game.price_change_direction || 'none'),
    comparison_baseline_version: game.comparison_baseline_version || null,
    deleted: false,
  };
}

function resetDraftsFromGames() {
  gameDrafts = new Map();
  for (const game of games) {
    gameDrafts.set(game.id, gameToDraft(game));
  }
  selectedGameIds.clear();
}

function getRowPayloadFromDraft(id) {
  const draft = getDraftById(id);
  if (!draft) return null;
  return {
    title: String(draft.title || '').trim(),
    platform: String(draft.platform || '').trim(),
    condition: normalizeConditionValue(draft.condition_note),
    price: Number(draft.price),
    active: Boolean(draft.active),
  };
}

function isRowChanged(existing, payload, isDeleted = false) {
  if (!existing || !payload) return false;
  if (isDeleted) return true;
  const existingPrice = Number(existing.price);
  const nextPrice = Number(payload.price);

  return (
    payload.title !== String(existing.title || '') ||
    payload.platform !== String(existing.platform || '') ||
    normalizeConditionValue(payload.condition) !== normalizeConditionValue(existing.condition_note) ||
    payload.active !== Boolean(existing.active) ||
    Number.isNaN(nextPrice) ||
    Math.abs(existingPrice - nextPrice) >= 0.001
  );
}

async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new Error('Unauthorized. Check your admin key.');
  }

  return res;
}

async function loadRuntimeInfo() {
  try {
    const res = await fetch(`/api/runtime?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    runtimeInfo = {
      isVercel: Boolean(body && body.isVercel),
      ephemeralStorage: Boolean(body && body.ephemeralStorage),
      persistentStorage: body?.persistentStorage !== false,
      dbProvider: String(body?.dbProvider || 'sqlite'),
    };
  } catch {
    runtimeInfo = { isVercel: false, ephemeralStorage: false, persistentStorage: true, dbProvider: 'sqlite' };
  }
}

function loadLocalBuylistSnapshot() {
  try {
    const raw = localStorage.getItem(BUYLIST_SNAPSHOT_EVENT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.games)) return null;
    const updatedAt = Number(parsed.updatedAt || 0);
    if (!updatedAt || Date.now() - updatedAt > EPHEMERAL_SNAPSHOT_MAX_AGE_MS) return null;
    return {
      updatedAt,
      games: parsed.games,
    };
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function gamesToCsv(rows) {
  const lines = ['title,platform,condition,price,active'];
  for (const row of rows) {
    const title = String(row?.title || '').trim();
    if (!title) continue;
    const platform = String(row?.platform || '').trim();
    const condition = normalizeConditionValue(row?.condition_note || row?.condition);
    const numericPrice = Number(row?.price);
    const price = Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : '0.00';
    const active = row?.active ? '1' : '0';
    lines.push(
      [title, platform, condition, price, active]
        .map((value) => csvEscape(value))
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function canonicalGameSignature(rows) {
  if (!Array.isArray(rows)) return '';
  return rows
    .map((row) => {
      const title = String(row?.title || '').trim().toLowerCase();
      const platform = String(row?.platform || '').trim().toLowerCase();
      const condition = normalizeConditionValue(row?.condition_note || row?.condition).toLowerCase();
      const numericPrice = Number(row?.price);
      const price = Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : '0.00';
      const active = row?.active ? '1' : '0';
      return `${title}|${platform}|${condition}|${price}|${active}`;
    })
    .sort()
    .join('~');
}

function isLikelySeedGames(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > DEFAULT_SEED_TITLES.size) return false;
  return rows.every((row) => DEFAULT_SEED_TITLES.has(String(row?.title || '').trim()));
}

function shouldAttemptEphemeralRestore(serverRows, snapshot) {
  if (!runtimeInfo.ephemeralStorage || hasAttemptedEphemeralRestore) return false;
  if (!snapshot || !Array.isArray(snapshot.games)) return false;
  if (snapshot.games.length === 0) return false;
  if (canonicalGameSignature(snapshot.games) === canonicalGameSignature(serverRows)) return false;
  if (!Array.isArray(serverRows) || serverRows.length === 0) return true;
  if (isLikelySeedGames(serverRows)) return snapshot.games.length > serverRows.length;
  if (snapshot.games.length < EPHEMERAL_RESTORE_MIN_SNAPSHOT_ROWS) return false;
  if (serverRows.length > EPHEMERAL_RESET_MAX_SERVER_ROWS) return false;
  return snapshot.games.length - serverRows.length >= EPHEMERAL_RESTORE_MIN_DIFF;
}

async function restoreFromLocalSnapshot(snapshot) {
  const csv = gamesToCsv(snapshot.games);
  if (!csv.trim()) return false;

  const res = await adminFetch('/api/admin/games/import-commit', {
    method: 'POST',
    body: JSON.stringify({
      csv,
      mode: 'replace',
      skipDuplicates: false,
      stopOnError: true,
      replaceConfirm: 'REPLACE',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Could not restore local backup.');
  }
  return true;
}

function markBuylistUpdated() {
  const now = String(Date.now());
  localStorage.setItem(BUYLIST_UPDATED_EVENT, now);
  localStorage.setItem(BUYLIST_SNAPSHOT_EVENT, JSON.stringify({ updatedAt: now, games }));
}

function getAllPlatformsFromDrafts() {
  const set = new Set();
  for (const draft of gameDrafts.values()) {
    if (!draft.deleted && draft.platform) set.add(draft.platform);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function getAllConditionsFromDrafts() {
  const set = new Set(['CIB']);
  for (const draft of gameDrafts.values()) {
    if (!draft.deleted && draft.condition_note) set.add(normalizeConditionValue(draft.condition_note));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function syncSelectOptions(selectEl, values, allLabel = null) {
  if (!selectEl) return;
  const current = String(selectEl.value || '');
  const options = allLabel ? [{ value: 'all', label: allLabel }] : [];
  for (const value of values) {
    options.push({ value, label: value });
  }
  selectEl.innerHTML = options
    .map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`)
    .join('');
  if (options.some((opt) => opt.value === current)) {
    selectEl.value = current;
  }
}

function syncGameFilterOptions() {
  syncSelectOptions(gamesFilterPlatformInput, getAllPlatformsFromDrafts(), 'All Platforms');
  syncSelectOptions(gamesFilterConditionInput, getAllConditionsFromDrafts(), 'All Conditions');
  syncSelectOptions(bulkSetConditionInput, [''].concat(getAllConditionsFromDrafts()), null);
  syncSelectOptions(addConditionInput, getAllConditionsFromDrafts(), null);
  if (bulkSetConditionInput && bulkSetConditionInput.options.length > 0) {
    bulkSetConditionInput.options[0].textContent = 'Set Condition...';
  }
}

function normalizeGamesPageSize(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return GAMES_ROWS_PER_PAGE_DEFAULT;
  return GAMES_ROWS_PER_PAGE_OPTIONS.includes(parsed) ? parsed : GAMES_ROWS_PER_PAGE_DEFAULT;
}

function loadGamesRowsPerPagePreference() {
  try {
    return normalizeGamesPageSize(localStorage.getItem(GAMES_ROWS_PER_PAGE_STORAGE_KEY));
  } catch (_) {
    return GAMES_ROWS_PER_PAGE_DEFAULT;
  }
}

function saveGamesRowsPerPagePreference(pageSize) {
  try {
    localStorage.setItem(GAMES_ROWS_PER_PAGE_STORAGE_KEY, String(normalizeGamesPageSize(pageSize)));
  } catch (_) {
    // Ignore localStorage write failures.
  }
}

function syncGamesRowsPerPageInput() {
  if (!gamesRowsPerPageInput) return;
  gamesRowsPerPageInput.value = String(normalizeGamesPageSize(gamesTableState.pageSize));
}

function readGameFiltersFromInputs() {
  gameFilters.search = String(gamesSearchInput?.value || '').trim().toLowerCase();
  gameFilters.platform = String(gamesFilterPlatformInput?.value || 'all');
  gameFilters.condition = String(gamesFilterConditionInput?.value || 'all');
  gameFilters.active = String(gamesFilterActiveInput?.value || 'all');
  gameFilters.change = String(gamesFilterChangeInput?.value || 'all');
  gameFilters.minPrice = String(gamesFilterPriceMinInput?.value || '').trim();
  gameFilters.maxPrice = String(gamesFilterPriceMaxInput?.value || '').trim();
}

function clearGameFilters() {
  if (gamesSearchInput) gamesSearchInput.value = '';
  if (gamesFilterPlatformInput) gamesFilterPlatformInput.value = 'all';
  if (gamesFilterConditionInput) gamesFilterConditionInput.value = 'all';
  if (gamesFilterActiveInput) gamesFilterActiveInput.value = 'all';
  if (gamesFilterChangeInput) gamesFilterChangeInput.value = 'all';
  if (gamesFilterPriceMinInput) gamesFilterPriceMinInput.value = '';
  if (gamesFilterPriceMaxInput) gamesFilterPriceMaxInput.value = '';
  readGameFiltersFromInputs();
}

function draftMatchesFilters(draft) {
  if (draft.deleted) return false;
  if (gameFilters.search && !String(draft.title || '').toLowerCase().includes(gameFilters.search)) return false;
  if (gameFilters.platform !== 'all' && String(draft.platform || '') !== gameFilters.platform) return false;
  if (gameFilters.condition !== 'all' && normalizeConditionValue(draft.condition_note) !== gameFilters.condition) return false;
  if (gameFilters.active === 'active' && !draft.active) return false;
  if (gameFilters.active === 'inactive' && draft.active) return false;
  if (gameFilters.change !== 'all') {
    const direction = getPriceChangeMeta(draft).direction;
    if (gameFilters.change === 'buffs' && direction !== 'up') return false;
    if (gameFilters.change === 'nerfs' && direction !== 'down') return false;
    if (gameFilters.change === 'unchanged' && direction !== 'same') return false;
    if (gameFilters.change === 'new' && direction !== 'new') return false;
  }

  const min = Number(gameFilters.minPrice);
  if (gameFilters.minPrice && Number.isFinite(min) && Number(draft.price) < min) return false;
  const max = Number(gameFilters.maxPrice);
  if (gameFilters.maxPrice && Number.isFinite(max) && Number(draft.price) > max) return false;
  return true;
}

function getFilteredDrafts() {
  const rows = Array.from(gameDrafts.values()).filter((draft) => draftMatchesFilters(draft));
  rows.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  return rows;
}

function getVisibleNonDeletedCount() {
  return Array.from(gameDrafts.values()).filter((draft) => !draft.deleted).length;
}

function getDirtyDraftIds() {
  const ids = [];
  for (const [id, draft] of gameDrafts.entries()) {
    const original = getGameById(id);
    const payload = getRowPayloadFromDraft(id);
    if (isRowChanged(original, payload, Boolean(draft.deleted))) ids.push(id);
  }
  return ids;
}

function getDirtyCount() {
  return getDirtyDraftIds().length;
}

function updateSaveChangesUi() {
  const count = getDirtyCount();
  if (unsavedChangesCount) {
    unsavedChangesCount.textContent = `Unsaved changes: ${count}`;
  }
  if (saveChangesBtn) {
    saveChangesBtn.disabled = count === 0;
  }
  if (saveAllGamesBtn) {
    saveAllGamesBtn.disabled = count === 0;
  }
  if (saveChangesBar) {
    saveChangesBar.classList.toggle('has-changes', count > 0);
  }
  if (publishBuylistSnapshotBtn) {
    publishBuylistSnapshotBtn.disabled = count > 0;
    publishBuylistSnapshotBtn.title = count > 0 ? 'Save changes before publishing a snapshot.' : '';
  }
}

function updateFilterCount({ start = 0, end = 0, filteredTotal = 0, total = 0 } = {}) {
  if (gamesFilterCount) {
    const suffix = filteredTotal !== total ? ` (filtered from ${total})` : '';
    if (filteredTotal <= 0) {
      gamesFilterCount.textContent = `Showing 0 of ${filteredTotal}${suffix}`;
      return;
    }
    gamesFilterCount.textContent = `Showing ${start}\u2013${end} of ${filteredTotal}${suffix}`;
  }
}

function renderGamesPagination({ page, pageSize, totalRows, totalPages }) {
  if (!gamesPaginationWrap) return;
  gamesPaginationWrap.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'secondary';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = page <= 1 || totalRows <= 0;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = page >= totalPages || totalRows <= 0;

  const pageInfo = document.createElement('span');
  pageInfo.className = 'muted';
  pageInfo.textContent = `Page ${page} of ${totalPages}`;

  const totalInfo = document.createElement('span');
  totalInfo.className = 'muted';
  totalInfo.textContent = `${totalRows} total`;

  prevBtn.addEventListener('click', () => {
    gamesTableState.page = Math.max(1, gamesTableState.page - 1);
    renderGamesTable();
  });

  nextBtn.addEventListener('click', () => {
    gamesTableState.page = Math.min(totalPages, gamesTableState.page + 1);
    renderGamesTable();
  });

  gamesPaginationWrap.appendChild(prevBtn);
  gamesPaginationWrap.appendChild(nextBtn);
  gamesPaginationWrap.appendChild(pageInfo);
  gamesPaginationWrap.appendChild(totalInfo);

  const select = document.createElement('select');
  select.className = 'games-page-size-select';
  select.setAttribute('aria-label', 'Rows per page');
  for (const option of GAMES_ROWS_PER_PAGE_OPTIONS) {
    const el = document.createElement('option');
    el.value = String(option);
    el.textContent = String(option);
    if (option === pageSize) el.selected = true;
    select.appendChild(el);
  }
  select.addEventListener('change', () => {
    const next = normalizeGamesPageSize(select.value);
    gamesTableState.pageSize = next;
    gamesTableState.page = 1;
    saveGamesRowsPerPagePreference(next);
    syncGamesRowsPerPageInput();
    renderGamesTable();
  });

  const label = document.createElement('label');
  label.className = 'games-pagination-size';
  label.append('Rows per page ', select);
  gamesPaginationWrap.appendChild(label);
}

function reconcileSelectedIds() {
  for (const id of Array.from(selectedGameIds)) {
    const draft = getDraftById(id);
    if (!draft || draft.deleted) {
      selectedGameIds.delete(id);
    }
  }
}

function getSelectedDrafts() {
  reconcileSelectedIds();
  const rows = [];
  for (const id of selectedGameIds) {
    const draft = getDraftById(id);
    if (draft && !draft.deleted) rows.push(draft);
  }
  return rows;
}

function updateBulkToolbarUi() {
  const count = getSelectedDrafts().length;
  if (bulkSelectedCount) {
    bulkSelectedCount.textContent = `${count} selected`;
  }
  if (bulkToolbar) {
    bulkToolbar.classList.toggle('is-hidden', count === 0);
  }
}

function renderGamesTable() {
  readGameFiltersFromInputs();
  reconcileSelectedIds();
  syncGameFilterOptions();
  syncGamesRowsPerPageInput();
  readGameFiltersFromInputs();

  const rows = getFilteredDrafts();
  const total = getVisibleNonDeletedCount();
  const pageSize = normalizeGamesPageSize(gamesTableState.pageSize);
  gamesTableState.pageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  gamesTableState.page = Math.min(Math.max(1, gamesTableState.page), totalPages);
  const startIndex = rows.length > 0 ? (gamesTableState.page - 1) * pageSize : 0;
  const pagedRows = rows.slice(startIndex, startIndex + pageSize);
  const start = rows.length > 0 ? startIndex + 1 : 0;
  const end = rows.length > 0 ? startIndex + pagedRows.length : 0;

  updateFilterCount({ start, end, filteredTotal: rows.length, total });
  renderGamesPagination({
    page: gamesTableState.page,
    pageSize,
    totalRows: rows.length,
    totalPages,
  });
  updateSaveChangesUi();
  updateBulkToolbarUi();

  if (rows.length === 0) {
    gamesWrap.innerHTML = '<p class="muted">No games match the current filters.</p>';
    return;
  }
  const dirtySet = new Set(getDirtyDraftIds());

  gamesWrap.innerHTML = `
    <table class="games-table">
      <thead>
        <tr>
          <th style="width:42px"><input type="checkbox" id="selectAllVisibleGames" /></th>
          <th>Title</th>
          <th>Platform</th>
          <th>Condition</th>
          <th>Price</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pagedRows
          .map((draft) => {
            const id = Number(draft.id);
            const isDirty = dirtySet.has(id);
            const changeMeta = getPriceChangeMeta(draft);
            const rowClasses = [];
            if (changeMeta.rowClass) rowClasses.push(changeMeta.rowClass);
            if (isDirty) rowClasses.push('row-dirty');
            return `
              <tr data-game-id="${id}" class="${rowClasses.join(' ')}">
                <td><input type="checkbox" data-select-game-id="${id}" ${selectedGameIds.has(id) ? 'checked' : ''} /></td>
                <td><input data-field="title" data-id="${id}" value="${escapeHtml(draft.title)}" /></td>
                <td>${renderPlatformSelect(id, draft.platform || '')}</td>
                <td>${renderConditionSelect(id, draft.condition_note || 'CIB')}</td>
                <td>
                  <div class="price-cell-wrap">
                    <input data-field="price" data-id="${id}" type="number" min="0" step="0.01" value="${escapeHtml(
                      Number.isFinite(Number(draft.price)) ? Number(draft.price).toFixed(2) : '0.00'
                    )}" style="width: 100px" />
                    ${
                      changeMeta.noteText
                        ? `<span class="price-change-note ${changeMeta.noteClass}" title="${escapeHtml(changeMeta.tooltip)}">${escapeHtml(
                            changeMeta.noteText
                          )}</span>`
                        : ''
                    }
                  </div>
                </td>
                <td>
                  <select data-field="active" data-id="${id}">
                    <option value="1" ${draft.active ? 'selected' : ''}>Yes</option>
                    <option value="0" ${!draft.active ? 'selected' : ''}>No</option>
                  </select>
                </td>
                <td class="row-actions">
                  <button class="secondary" data-action="reset-row" data-id="${id}" type="button">Reset</button>
                  <button class="danger" data-action="delete-row" data-id="${id}" type="button">Delete</button>
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  const visibleIds = pagedRows.map((row) => Number(row.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedGameIds.has(id));
  const selectAll = document.getElementById('selectAllVisibleGames');
  if (selectAll) {
    selectAll.checked = allVisibleSelected;
    selectAll.addEventListener('change', () => {
      if (selectAll.checked) {
        for (const id of visibleIds) selectedGameIds.add(id);
      } else {
        for (const id of visibleIds) selectedGameIds.delete(id);
      }
      updateBulkToolbarUi();
      renderGamesTable();
    });
  }

  gamesWrap.querySelectorAll('input[data-select-game-id]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = Number(el.getAttribute('data-select-game-id'));
      if (!Number.isInteger(id)) return;
      if (el.checked) selectedGameIds.add(id);
      else selectedGameIds.delete(id);
      updateBulkToolbarUi();
      renderGamesTable();
    });
  });

  gamesWrap.querySelectorAll('[data-field]').forEach((el) => {
    const field = String(el.getAttribute('data-field') || '');
    const id = Number(el.getAttribute('data-id'));
    if (!Number.isInteger(id)) return;

    const eventName = field === 'title' || field === 'price' ? 'input' : 'change';
    el.addEventListener(eventName, () => {
      const draft = getDraftById(id);
      if (!draft) return;
      if (field === 'title') draft.title = String(el.value || '');
      if (field === 'platform') draft.platform = String(el.value || '').trim();
      if (field === 'condition_note') draft.condition_note = normalizeConditionValue(el.value);
      if (field === 'price') {
        const value = Number(el.value);
        draft.price = Number.isFinite(value) && value >= 0 ? value : 0;
      }
      if (field === 'active') draft.active = String(el.value) === '1';
      renderGamesTable();
    });
  });

  gamesWrap.querySelectorAll('button[data-action="reset-row"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const original = getGameById(id);
      if (!original) return;
      gameDrafts.set(id, gameToDraft(original));
      renderGamesTable();
    });
  });

  gamesWrap.querySelectorAll('button[data-action="delete-row"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      const draft = getDraftById(id);
      if (!draft) return;
      if (!confirm(`This will mark "${draft.title}" for deletion on save. Continue?`)) return;
      draft.deleted = true;
      selectedGameIds.delete(id);
      renderGamesTable();
    });
  });
}

function confirmBulkUpdate(count) {
  if (count <= 0) {
    renderNotice('Select at least one row first.', 'warn');
    return false;
  }
  return confirm(`This will update ${count} rows. Continue?`);
}

function applyBulkUpdate(mutator, successLabel) {
  const selected = getSelectedDrafts();
  if (!confirmBulkUpdate(selected.length)) return;
  for (const draft of selected) mutator(draft);
  renderGamesTable();
  showToast(successLabel);
}

async function saveDirtyChanges() {
  const dirtyIds = getDirtyDraftIds();
  if (dirtyIds.length === 0) {
    renderNotice('No pending edits to save.');
    return;
  }

  const failures = [];
  for (const id of dirtyIds) {
    const draft = getDraftById(id);
    const payload = getRowPayloadFromDraft(id);
    if (!draft || !payload) continue;
    try {
      if (draft.deleted) {
        const res = await adminFetch(`/api/admin/games/${id}`, { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Could not delete ${payload.title}`);
      } else {
        const res = await adminFetch(`/api/admin/games/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Could not update ${payload.title}`);
      }
    } catch (err) {
      failures.push(err.message || `Row ${id} failed`);
    }
  }

  if (failures.length > 0) {
    renderNotice(`Saved with ${failures.length} error(s): ${failures[0]}`, 'error');
    showToast('Some changes failed', 'error');
    await loadGames();
    return;
  }

  await loadGames();
  markBuylistUpdated();
  renderNotice(`Saved ${dirtyIds.length} change${dirtyIds.length === 1 ? '' : 's'}.`);
  showToast('Saved');
}

function renderImportPreview(preview, csv) {
  pendingImportCsv = csv;
  pendingImportPreview = preview;
  if (!importPreviewPanel) return;

  importPreviewPanel.classList.remove('is-hidden');
  const summary = preview.summary || {};
  importPreviewSummary.innerHTML = `
    <strong>Summary:</strong>
    New ${Number(summary.newRows || 0)} |
    Updates ${Number(summary.updateRows || 0)} |
    Duplicates ${Number(summary.duplicateRows || 0)} |
    Errors ${Number(summary.errorRows || 0)}
  `;

  const errors = Array.isArray(preview.errors) ? preview.errors : [];
  if (errors.length === 0) {
    importPreviewErrors.innerHTML = '<span class="muted">No validation errors found.</span>';
  } else {
    importPreviewErrors.innerHTML = `
      <div class="notice warn" style="margin-top:0.6rem">
        <strong>Errors (${errors.length}):</strong>
        <ul style="margin:0.5rem 0 0; padding-left:1rem">
          ${errors
            .slice(0, 10)
            .map((err) => `<li>Row ${Number(err.row || 0)}: ${escapeHtml(err.reason || 'Invalid row')}</li>`)
            .join('')}
        </ul>
      </div>
    `;
  }

  const rows = Array.isArray(preview.previewRows) ? preview.previewRows : [];
  if (rows.length === 0) {
    importPreviewRows.innerHTML = '<p class="muted">No valid rows to preview.</p>';
  } else {
    importPreviewRows.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Title</th>
            <th>Platform</th>
            <th>Condition</th>
            <th>Price</th>
            <th>Active</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice(0, 20)
            .map(
              (row) => `
            <tr>
              <td>${Number(row.row || 0)}</td>
              <td>${escapeHtml(row.title || '')}</td>
              <td>${escapeHtml(row.platform || '')}</td>
              <td>${escapeHtml(row.condition || '')}</td>
              <td>${money(Number(row.price || 0))}</td>
              <td>${row.active ? 'Yes' : 'No'}</td>
              <td>${escapeHtml(row.status || '')}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  if (importModeInput) importModeInput.value = 'upsert';
  if (importSkipDuplicatesInput) importSkipDuplicatesInput.checked = false;
  if (importStopOnErrorInput) importStopOnErrorInput.checked = false;
  if (importReplaceConfirmInput) {
    importReplaceConfirmInput.value = '';
    importReplaceConfirmInput.classList.add('is-hidden');
  }
}

function hideImportPreview() {
  pendingImportCsv = '';
  pendingImportPreview = null;
  if (importPreviewPanel) importPreviewPanel.classList.add('is-hidden');
  if (importPreviewSummary) importPreviewSummary.innerHTML = '';
  if (importPreviewErrors) importPreviewErrors.innerHTML = '';
  if (importPreviewRows) importPreviewRows.innerHTML = '';
}

async function loadAdminSettings() {
  const res = await adminFetch('/api/admin/settings');
  const settings = await res.json();
  if (!res.ok) throw new Error(settings.error || 'Could not load settings');

  const nextCurrentVersion = settings.current_buylist_version || '';
  adminSettings = {
    current_buylist_version: nextCurrentVersion,
    show_price_change_highlights_public: settings.show_price_change_highlights_public !== false,
    ship_to_business_name: settings.ship_to_business_name || '',
    ship_to_contact_name: settings.ship_to_contact_name || '',
    ship_to_address_line1: settings.ship_to_address_line1 || '',
    ship_to_address_line2: settings.ship_to_address_line2 || '',
    ship_to_city: settings.ship_to_city || '',
    ship_to_state: settings.ship_to_state || '',
    ship_to_postal_code: settings.ship_to_postal_code || '',
    ship_to_country: settings.ship_to_country || '',
    packing_next_steps_text: settings.packing_next_steps_text || '',
    last_published_version: settings.last_published_version || null,
    last_published_at: settings.last_published_at || null,
    comparison_baseline_version: settings.comparison_baseline_version || null,
  };
  currentBuylistVersionInput.value = nextCurrentVersion;
  if (shipToBusinessNameInput) shipToBusinessNameInput.value = adminSettings.ship_to_business_name;
  if (shipToContactNameInput) shipToContactNameInput.value = adminSettings.ship_to_contact_name;
  if (shipToAddressLine1Input) shipToAddressLine1Input.value = adminSettings.ship_to_address_line1;
  if (shipToAddressLine2Input) shipToAddressLine2Input.value = adminSettings.ship_to_address_line2;
  if (shipToCityInput) shipToCityInput.value = adminSettings.ship_to_city;
  if (shipToStateInput) shipToStateInput.value = adminSettings.ship_to_state;
  if (shipToPostalCodeInput) shipToPostalCodeInput.value = adminSettings.ship_to_postal_code;
  if (shipToCountryInput) shipToCountryInput.value = adminSettings.ship_to_country;
  if (packingNextStepsTextInput) packingNextStepsTextInput.value = adminSettings.packing_next_steps_text;
  renderPublishMeta();
}

async function saveAdminSettings() {
  const payload = {
    current_buylist_version: currentBuylistVersionInput.value.trim(),
    show_price_change_highlights_public: showPriceChangeHighlightsInput
      ? showPriceChangeHighlightsInput.value === '1'
      : true,
    ship_to_business_name: shipToBusinessNameInput ? shipToBusinessNameInput.value : '',
    ship_to_contact_name: shipToContactNameInput ? shipToContactNameInput.value : '',
    ship_to_address_line1: shipToAddressLine1Input ? shipToAddressLine1Input.value : '',
    ship_to_address_line2: shipToAddressLine2Input ? shipToAddressLine2Input.value : '',
    ship_to_city: shipToCityInput ? shipToCityInput.value : '',
    ship_to_state: shipToStateInput ? shipToStateInput.value : '',
    ship_to_postal_code: shipToPostalCodeInput ? shipToPostalCodeInput.value : '',
    ship_to_country: shipToCountryInput ? shipToCountryInput.value : '',
    packing_next_steps_text: packingNextStepsTextInput ? packingNextStepsTextInput.value : '',
  };

  const res = await adminFetch('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not save settings');

  const settings = body.settings || {};
  const nextCurrentVersion = settings.current_buylist_version || currentBuylistVersionInput.value;
  adminSettings = {
    current_buylist_version: nextCurrentVersion,
    show_price_change_highlights_public: settings.show_price_change_highlights_public !== false,
    ship_to_business_name: settings.ship_to_business_name || payload.ship_to_business_name || '',
    ship_to_contact_name: settings.ship_to_contact_name || payload.ship_to_contact_name || '',
    ship_to_address_line1: settings.ship_to_address_line1 || payload.ship_to_address_line1 || '',
    ship_to_address_line2: settings.ship_to_address_line2 || payload.ship_to_address_line2 || '',
    ship_to_city: settings.ship_to_city || payload.ship_to_city || '',
    ship_to_state: settings.ship_to_state || payload.ship_to_state || '',
    ship_to_postal_code: settings.ship_to_postal_code || payload.ship_to_postal_code || '',
    ship_to_country: settings.ship_to_country || payload.ship_to_country || '',
    packing_next_steps_text: settings.packing_next_steps_text || payload.packing_next_steps_text || '',
    last_published_version: settings.last_published_version || null,
    last_published_at: settings.last_published_at || null,
    comparison_baseline_version: settings.comparison_baseline_version || null,
  };
  currentBuylistVersionInput.value = nextCurrentVersion;
  if (shipToBusinessNameInput) shipToBusinessNameInput.value = adminSettings.ship_to_business_name;
  if (shipToContactNameInput) shipToContactNameInput.value = adminSettings.ship_to_contact_name;
  if (shipToAddressLine1Input) shipToAddressLine1Input.value = adminSettings.ship_to_address_line1;
  if (shipToAddressLine2Input) shipToAddressLine2Input.value = adminSettings.ship_to_address_line2;
  if (shipToCityInput) shipToCityInput.value = adminSettings.ship_to_city;
  if (shipToStateInput) shipToStateInput.value = adminSettings.ship_to_state;
  if (shipToPostalCodeInput) shipToPostalCodeInput.value = adminSettings.ship_to_postal_code;
  if (shipToCountryInput) shipToCountryInput.value = adminSettings.ship_to_country;
  if (packingNextStepsTextInput) packingNextStepsTextInput.value = adminSettings.packing_next_steps_text;
  renderPublishMeta();
}

async function publishBuylistSnapshot(overwrite = false) {
  if (getDirtyCount() > 0) {
    renderNotice('Save changes before publishing a snapshot.', 'warn');
    return;
  }

  const res = await adminFetch('/api/admin/buylist/publish', {
    method: 'POST',
    body: JSON.stringify({ overwrite }),
  });
  const body = await res.json();

  if (res.status === 409 && !overwrite) {
    const version = body?.version || currentBuylistVersionInput.value.trim();
    const confirmed = confirm(
      `A snapshot for ${version || 'this version'} already exists. Overwrite it with current prices?`
    );
    if (!confirmed) return;
    await publishBuylistSnapshot(true);
    return;
  }

  if (!res.ok) {
    throw new Error(body.error || 'Could not publish buylist snapshot.');
  }

  await loadAdminSettings();
  await loadGames();
  const itemCount = Number(body.item_count || 0);
  showToast('Snapshot published');
  renderNotice(
    `Published snapshot for ${body.version}. Captured ${itemCount} title${itemCount === 1 ? '' : 's'}.`
  );
}

async function loadGames() {
  const fetchGames = async () => {
    const res = await adminFetch(`/api/admin/games?t=${Date.now()}`, {
      cache: 'no-store',
    });
    return res.json();
  };

  let rows = await fetchGames();
  let nextGames = Array.isArray(rows) ? rows : [];
  const snapshot = loadLocalBuylistSnapshot();
  if (shouldAttemptEphemeralRestore(nextGames, snapshot)) {
    hasAttemptedEphemeralRestore = true;
    try {
      const restored = await restoreFromLocalSnapshot(snapshot);
      if (restored) {
        rows = await fetchGames();
        nextGames = Array.isArray(rows) ? rows : [];
        games = nextGames;
        markBuylistUpdated();
        showToast('Recovered buylist from local backup.', 'warn');
        renderNotice('Recovered buylist from local browser backup after storage reset.', 'warn');
      }
    } catch (err) {
      renderNotice(err.message || 'Could not recover local backup.', 'error');
    }
  }

  games = nextGames;
  resetDraftsFromGames();
  syncGameFilterOptions();
  renderGamesTable();
}

function copyText(text, label) {
  navigator.clipboard
    .writeText(String(text || ''))
    .then(() => showToast(`${label} copied`))
    .catch(() => showToast('Copy failed', 'error'));
}

async function downloadAdminCsv(url, filename) {
  const res = await fetch(url, {
    headers: { 'x-admin-key': adminKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not export CSV');
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

function submissionStatusClass(status) {
  return String(status || 'pending').toLowerCase().replaceAll(' ', '-');
}

function submissionFiltersQueryString(includePage = true) {
  const params = new URLSearchParams();
  if (submissionsState.status && submissionsState.status !== 'All') params.set('status', submissionsState.status);
  if (submissionsState.q) params.set('q', submissionsState.q);
  if (submissionsState.sort) params.set('sort', submissionsState.sort);
  if (includePage) {
    params.set('page', String(submissionsState.page));
    params.set('pageSize', String(submissionsState.pageSize));
  }
  return params.toString();
}

function selectedSubmissionSort() {
  return submissionsSortInput && submissionsSortInput.value === 'oldest' ? 'oldest' : 'newest';
}

function renderSubmissionsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    submissionsTableWrap.innerHTML = '<p class="muted">No submissions match your filters.</p>';
    return;
  }

  submissionsTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Submission ID</th>
          <th>Seller Name</th>
          <th>Email</th>
          <th>Item Count</th>
          <th>Estimated Total</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${escapeHtml(row.created_at || '')}</td>
            <td>#${row.id}</td>
            <td>${escapeHtml(row.seller_name || '')}</td>
            <td>${escapeHtml(row.email || '-')}</td>
            <td>${Number(row.total_qty || row.item_count || 0)}</td>
            <td>${money(row.estimated_total || 0)}</td>
            <td><span class="submission-status ${submissionStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
            <td class="row-actions">
              <button class="secondary" data-action="view-submission" data-id="${row.id}">View</button>
              <button class="secondary" data-action="export-submission" data-id="${row.id}">Export CSV</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  submissionsTableWrap.querySelectorAll('button[data-action="view-submission"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      try {
        await openSubmissionDetail(id);
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  submissionsTableWrap.querySelectorAll('button[data-action="export-submission"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      try {
        await downloadAdminCsv(`/api/admin/submissions/${id}/export-csv`, `submission-${id}.csv`);
        showToast('Exported');
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });
}

function renderSubmissionPagination() {
  submissionsPaginationWrap.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'secondary';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = submissionsState.page <= 1;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = submissionsState.page >= submissionsState.totalPages;

  const info = document.createElement('span');
  info.className = 'muted';
  info.textContent = `Page ${submissionsState.page} of ${submissionsState.totalPages} (${submissionsState.total} total)`;

  prevBtn.addEventListener('click', () => loadSubmissions(submissionsState.page - 1));
  nextBtn.addEventListener('click', () => loadSubmissions(submissionsState.page + 1));

  submissionsPaginationWrap.appendChild(prevBtn);
  submissionsPaginationWrap.appendChild(nextBtn);
  submissionsPaginationWrap.appendChild(info);
}

async function loadSubmissions(page = 1) {
  submissionsState.page = page;
  const query = submissionFiltersQueryString(true);

  const res = await adminFetch(`/api/admin/submissions?${query}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not load submissions');

  const pagination = body.pagination || {};
  const filters = body.filters || {};
  submissionsState.page = Number(pagination.page || 1);
  submissionsState.pageSize = Number(pagination.pageSize || 25);
  submissionsState.total = Number(pagination.total || 0);
  submissionsState.totalPages = Number(pagination.totalPages || 1);
  submissionsState.status = filters.status || submissionsState.status;
  submissionsState.q = filters.q || submissionsState.q;
  submissionsState.sort = filters.sort || submissionsState.sort;

  submissionsStatusFilterInput.value = submissionsState.status;
  submissionsSearchInput.value = submissionsState.q;
  if (submissionsSortInput) submissionsSortInput.value = submissionsState.sort;

  renderSubmissionsTable(body.rows || []);
  renderSubmissionPagination();
}

function closeSubmissionDetailModal() {
  submissionDetailModal.classList.add('is-hidden');
  document.body.classList.remove('modal-open');
}

async function saveSubmissionDetail(id, status, internalNotes) {
  if (status === 'Rejected' && String(internalNotes || '').trim().length < 10) {
    throw new Error('Rejected submissions require internal notes of at least 10 characters.');
  }

  const res = await adminFetch(`/api/admin/submissions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, internalNotes }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not save submission changes');
  return body.submission;
}

function renderSubmissionDetail(detail) {
  submissionDetailBody.innerHTML = `
    <div class="grid" style="gap: 0.7rem">
      <div class="grid two">
        <div><strong>Submission ID:</strong> #${detail.id}</div>
        <div><strong>Created:</strong> ${escapeHtml(detail.created_at || '')}</div>
        <div><strong>Price Version:</strong> ${escapeHtml(detail.price_version || '-')}</div>
        <div>
          <label class="muted" for="detailStatus">Status</label>
          <select id="detailStatus">
            <option value="Pending" ${detail.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Received" ${detail.status === 'Received' ? 'selected' : ''}>Received</option>
            <option value="Paid" ${detail.status === 'Paid' ? 'selected' : ''}>Paid</option>
            <option value="Rejected" ${detail.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </div>
      </div>

      <section class="card" style="margin: 0">
        <h3 style="margin-top: 0">Seller</h3>
        <div class="grid two">
          <div><strong>Name:</strong> ${escapeHtml(detail.seller_name || '-')}</div>
          <div class="row-actions">
            <strong>Email:</strong> ${escapeHtml(detail.email || '-')}
            <button type="button" class="secondary" data-copy="email">Copy</button>
          </div>
          <div class="row-actions">
            <strong>Phone:</strong> ${escapeHtml(detail.phone || '-')}
            <button type="button" class="secondary" data-copy="phone">Copy</button>
          </div>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Platform</th>
            <th>Qty</th>
            <th>Unit Price (Locked)</th>
            <th>Line Total (Locked)</th>
          </tr>
        </thead>
        <tbody>
          ${detail.items
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.title || '')}</td>
              <td>${escapeHtml(item.platform || '')}</td>
              <td>${Number(item.qty || 0)}</td>
              <td>${money(item.unit_price_at_submit || 0)}</td>
              <td>${money(item.line_total_at_submit || 0)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <div><strong>Estimated Total (Locked):</strong> ${money(detail.estimated_total || 0)}</div>

      <div class="grid">
        <label for="detailInternalNotes" class="muted">Internal Notes</label>
        <textarea id="detailInternalNotes" rows="4" placeholder="Internal processing notes">${escapeHtml(
          detail.internal_notes || ''
        )}</textarea>
      </div>

      <div class="row-actions">
        <button type="button" id="saveSubmissionDetail">Save</button>
        <button type="button" class="secondary" data-status-action="Received">Mark Received</button>
        <button type="button" class="secondary" data-status-action="Paid">Mark Paid</button>
        <button type="button" class="secondary" data-status-action="Rejected">Mark Rejected</button>
        <button type="button" class="secondary" id="exportSubmissionCsvFromDetail">Export CSV</button>
      </div>
    </div>
  `;

  submissionDetailBody.querySelectorAll('button[data-copy="email"]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(detail.email || '', 'Email'));
  });
  submissionDetailBody.querySelectorAll('button[data-copy="phone"]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(detail.phone || '', 'Phone'));
  });

  const statusSelect = document.getElementById('detailStatus');
  const notesInput = document.getElementById('detailInternalNotes');
  const saveBtn = document.getElementById('saveSubmissionDetail');
  const exportBtn = document.getElementById('exportSubmissionCsvFromDetail');

  saveBtn.addEventListener('click', async () => {
    try {
      const updated = await saveSubmissionDetail(detail.id, statusSelect.value, notesInput.value);
      showToast('Saved');
      await loadSubmissions(submissionsState.page);
      renderSubmissionDetail(updated);
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });

  submissionDetailBody.querySelectorAll('button[data-status-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextStatus = btn.getAttribute('data-status-action');
      statusSelect.value = nextStatus;

      try {
        const updated = await saveSubmissionDetail(detail.id, nextStatus, notesInput.value);
        showToast('Status updated');
        await loadSubmissions(submissionsState.page);
        renderSubmissionDetail(updated);
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  exportBtn.addEventListener('click', async () => {
    try {
      await downloadAdminCsv(`/api/admin/submissions/${detail.id}/export-csv`, `submission-${detail.id}.csv`);
      showToast('Exported');
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

async function openSubmissionDetail(id) {
  const res = await adminFetch(`/api/admin/submissions/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not load submission detail');

  submissionDetailModal.classList.remove('is-hidden');
  document.body.classList.add('modal-open');
  renderSubmissionDetail(body);
}

async function loadFaqs() {
  const res = await adminFetch('/api/admin/faqs');
  faqs = await res.json();

  if (faqs.length === 0) {
    faqWrap.innerHTML = '<p class="muted">No FAQs yet.</p>';
    return;
  }

  faqWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Question</th>
          <th>Answer</th>
          <th>Sort</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${faqs
          .map(
            (f) => `
          <tr data-faq-id="${f.id}">
            <td><input data-field="question" data-id="${f.id}" value="${escapeHtml(f.question)}" /></td>
            <td><textarea data-field="answer" data-id="${f.id}" rows="2">${escapeHtml(f.answer)}</textarea></td>
            <td><input data-field="sort_order" data-id="${f.id}" type="number" value="${Number(
              f.sort_order || 0
            )}" style="width: 88px" /></td>
            <td>
              <select data-field="active" data-id="${f.id}">
                <option value="1" ${f.active ? 'selected' : ''}>Yes</option>
                <option value="0" ${!f.active ? 'selected' : ''}>No</option>
              </select>
            </td>
            <td class="row-actions">
              <button class="secondary" data-action="save-faq" data-id="${f.id}">Save</button>
              <button class="danger" data-action="delete-faq" data-id="${f.id}">Delete</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  faqWrap.querySelectorAll('button[data-action="save-faq"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      const payload = {
        question: faqWrap.querySelector(`input[data-field="question"][data-id="${id}"]`).value.trim(),
        answer: faqWrap.querySelector(`textarea[data-field="answer"][data-id="${id}"]`).value.trim(),
        sortOrder: Number(faqWrap.querySelector(`input[data-field="sort_order"][data-id="${id}"]`).value || 0),
        active: faqWrap.querySelector(`select[data-field="active"][data-id="${id}"]`).value === '1',
      };

      try {
        const res = await adminFetch(`/api/admin/faqs/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not update FAQ');
        renderNotice('FAQ updated.');
        showToast('Saved');
        await loadFaqs();
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  faqWrap.querySelectorAll('button[data-action="delete-faq"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      if (!confirm('Delete this FAQ?')) return;
      try {
        const res = await adminFetch(`/api/admin/faqs/${id}`, { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not delete FAQ');
        renderNotice('FAQ deleted.');
        showToast('Saved');
        await loadFaqs();
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });
}

function gameFilterQueryString() {
  readGameFiltersFromInputs();
  const params = new URLSearchParams();
  if (gameFilters.search) params.set('search', gameFilters.search);
  if (gameFilters.platform !== 'all') params.set('platform', gameFilters.platform);
  if (gameFilters.condition !== 'all') params.set('condition', gameFilters.condition);
  if (gameFilters.active !== 'all') params.set('active', gameFilters.active);
  if (gameFilters.minPrice) params.set('minPrice', gameFilters.minPrice);
  if (gameFilters.maxPrice) params.set('maxPrice', gameFilters.maxPrice);
  return params.toString();
}

function loadQuickAddDefaults() {
  const savedPlatform = localStorage.getItem(LAST_PLATFORM_KEY);
  const savedCondition = localStorage.getItem(LAST_CONDITION_KEY);
  if (savedPlatform && addPlatformInput) addPlatformInput.value = savedPlatform;
  if (savedCondition && addConditionInput) {
    const hasCondition = Array.from(addConditionInput.options).some((opt) => opt.value === savedCondition);
    if (!hasCondition) {
      const opt = document.createElement('option');
      opt.value = savedCondition;
      opt.textContent = savedCondition;
      addConditionInput.appendChild(opt);
    }
    addConditionInput.value = savedCondition;
  }
}

function updateImportReplaceConfirmVisibility() {
  if (!importModeInput || !importReplaceConfirmInput) return;
  const isReplace = importModeInput.value === 'replace';
  importReplaceConfirmInput.classList.toggle('is-hidden', !isReplace);
}

saveAllGamesBtn.addEventListener('click', () => {
  saveDirtyChanges().catch((err) => renderNotice(err.message, 'error'));
});

if (saveChangesBtn) {
  saveChangesBtn.addEventListener('click', () => {
    saveDirtyChanges().catch((err) => renderNotice(err.message, 'error'));
  });
}

window.addEventListener('beforeunload', (e) => {
  if (getDirtyCount() === 0) return;
  e.preventDefault();
  e.returnValue = '';
});

async function bootstrapAdmin() {
  try {
    await loadRuntimeInfo();
    await loadGames();
    await loadSubmissions(1);
    await loadFaqs();
    await loadAdminSettings();
    loadQuickAddDefaults();
    clearGameFilters();
    renderGamesTable();
    updateImportReplaceConfirmVisibility();
    adminApp.style.display = 'block';
    if (runtimeInfo.ephemeralStorage) {
      renderNotice(
        'Connected. Warning: this deployment uses temporary storage. Local backup recovery is enabled for this browser.',
        'warn'
      );
    } else if (runtimeInfo.dbProvider === 'postgres') {
      renderNotice('Connected. Persistent storage is active (Postgres).');
    } else {
      renderNotice('Connected.');
    }
  } catch (err) {
    renderNotice(err.message, 'error');
  }
}

connectBtn.addEventListener('click', () => {
  adminKey = adminKeyInput.value.trim();
  if (!adminKey) {
    renderNotice('Enter your admin key.', 'error');
    return;
  }
  bootstrapAdmin();
});

saveBuylistVersionBtn.addEventListener('click', async () => {
  try {
    await saveAdminSettings();
    renderNotice('Settings saved.');
    showToast('Saved');
    await loadGames();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

if (publishBuylistSnapshotBtn) {
  publishBuylistSnapshotBtn.addEventListener('click', async () => {
    try {
      await publishBuylistSnapshot(false);
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

addGameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const title = String(addTitleInput.value || '').trim();
    const platform = String(addPlatformInput.value || '').trim();
    const condition = normalizeConditionValue(addConditionInput.value);
    const payload = {
      title,
      platform,
      condition,
      price: Number(addPriceInput.value),
      active: addActiveInput.value === '1',
    };

    const res = await adminFetch('/api/admin/games', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add game');

    localStorage.setItem(LAST_PLATFORM_KEY, platform);
    localStorage.setItem(LAST_CONDITION_KEY, condition);
    addTitleInput.value = '';
    addPriceInput.value = '';
    addTitleInput.focus();
    renderNotice('Game added.');
    showToast(`Added: ${title} (${platform || 'No Platform'})`);
    await loadGames();
    markBuylistUpdated();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

refreshGamesBtn.addEventListener('click', async () => {
  if (getDirtyCount() > 0 && !confirm('You have unsaved changes. Refresh and discard them?')) return;
  try {
    await loadGames();
    await loadSubmissions(submissionsState.page);
    await loadFaqs();
    await loadAdminSettings();
    renderNotice('Data refreshed.');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

exportCsvBtn.addEventListener('click', async () => {
  try {
    await downloadAdminCsv('/api/admin/games/export-csv', 'buylist.csv');
    showToast('Exported');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

if (exportFilteredCsvBtn) {
  exportFilteredCsvBtn.addEventListener('click', async () => {
    try {
      const query = gameFilterQueryString();
      const url = query ? `/api/admin/games/export-csv?${query}` : '/api/admin/games/export-csv';
      await downloadAdminCsv(url, 'buylist-filtered.csv');
      showToast('Exported');
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

importCsvInput.addEventListener('change', async () => {
  const file = importCsvInput.files && importCsvInput.files[0];
  if (!file) return;
  try {
    const csv = await file.text();
    const res = await adminFetch('/api/admin/games/import-preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not preview CSV');
    renderImportPreview(body, csv);
    renderNotice('Import preview ready.');
  } catch (err) {
    renderNotice(err.message, 'error');
  } finally {
    importCsvInput.value = '';
  }
});

if (importModeInput) {
  importModeInput.addEventListener('change', updateImportReplaceConfirmVisibility);
}

if (cancelImportBtn) {
  cancelImportBtn.addEventListener('click', () => {
    hideImportPreview();
    renderNotice('Import canceled.', 'warn');
  });
}

if (commitImportBtn) {
  commitImportBtn.addEventListener('click', async () => {
    if (!pendingImportCsv || !pendingImportPreview) {
      renderNotice('Upload a CSV first to preview import.', 'warn');
      return;
    }
    const mode = importModeInput ? importModeInput.value : 'upsert';
    const replaceConfirm = importReplaceConfirmInput ? importReplaceConfirmInput.value.trim() : '';
    if (mode === 'replace' && replaceConfirm !== 'REPLACE') {
      renderNotice('Type REPLACE to confirm full replace import.', 'error');
      return;
    }

    try {
      const res = await adminFetch('/api/admin/games/import-commit', {
        method: 'POST',
        body: JSON.stringify({
          csv: pendingImportCsv,
          mode,
          skipDuplicates: Boolean(importSkipDuplicatesInput && importSkipDuplicatesInput.checked),
          stopOnError: Boolean(importStopOnErrorInput && importStopOnErrorInput.checked),
          replaceConfirm,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Import failed');
      hideImportPreview();
      await loadGames();
      markBuylistUpdated();
      renderNotice(
        `Import complete. Added ${Number(body.inserted || 0)}, updated ${Number(body.updated || 0)}, skipped ${Number(
          body.skipped || 0
        )}, errors ${Number(body.errors || 0)}.`
      );
      showToast('Saved');
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

function bindGameFilterEvents() {
  const bindings = [
    [gamesSearchInput, 'input'],
    [gamesFilterPlatformInput, 'change'],
    [gamesFilterConditionInput, 'change'],
    [gamesFilterActiveInput, 'change'],
    [gamesFilterChangeInput, 'change'],
    [gamesFilterPriceMinInput, 'input'],
    [gamesFilterPriceMaxInput, 'input'],
  ];
  for (const [el, eventName] of bindings) {
    if (!el) continue;
    el.addEventListener(eventName, () => {
      gamesTableState.page = 1;
      renderGamesTable();
    });
  }
  if (gamesRowsPerPageInput) {
    gamesRowsPerPageInput.value = String(normalizeGamesPageSize(gamesTableState.pageSize));
    gamesRowsPerPageInput.addEventListener('change', () => {
      const next = normalizeGamesPageSize(gamesRowsPerPageInput.value);
      gamesTableState.pageSize = next;
      gamesTableState.page = 1;
      saveGamesRowsPerPagePreference(next);
      renderGamesTable();
    });
  }
  if (clearGameFiltersBtn) {
    clearGameFiltersBtn.addEventListener('click', () => {
      clearGameFilters();
      gamesTableState.page = 1;
      renderGamesTable();
    });
  }
}

bindGameFilterEvents();

if (applyBulkActiveBtn) {
  applyBulkActiveBtn.addEventListener('click', () => {
    if (!bulkSetActiveInput || bulkSetActiveInput.value === '') {
      renderNotice('Choose Active Yes/No for bulk update.', 'warn');
      return;
    }
    applyBulkUpdate((draft) => {
      draft.active = bulkSetActiveInput.value === '1';
    }, 'Bulk Active updated');
  });
}

if (applyBulkConditionBtn) {
  applyBulkConditionBtn.addEventListener('click', () => {
    const rawCondition = String(bulkSetConditionInput?.value || '').trim();
    if (!rawCondition) {
      renderNotice('Choose a condition for bulk update.', 'warn');
      return;
    }
    const nextCondition = normalizeConditionValue(rawCondition);
    applyBulkUpdate((draft) => {
      draft.condition_note = nextCondition;
    }, 'Bulk Condition updated');
  });
}

if (applyBulkPriceAdjustBtn) {
  applyBulkPriceAdjustBtn.addEventListener('click', () => {
    const amount = Number(bulkPriceValueInput?.value || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      renderNotice('Enter a valid bulk price adjustment value.', 'warn');
      return;
    }
    const mode = bulkPriceModeInput?.value === 'percent' ? 'percent' : 'amount';
    const direction = bulkPriceDirectionInput?.value === 'decrease' ? -1 : 1;
    applyBulkUpdate((draft) => {
      const current = Number(draft.price || 0);
      if (mode === 'percent') {
        const multiplier = 1 + direction * (amount / 100);
        draft.price = Math.max(0, Number((current * multiplier).toFixed(2)));
      } else {
        draft.price = Math.max(0, Number((current + direction * amount).toFixed(2)));
      }
    }, 'Bulk price adjusted');
  });
}

if (bulkRound99Btn) {
  bulkRound99Btn.addEventListener('click', () => {
    applyBulkUpdate((draft) => {
      const base = Math.max(0, Math.floor(Number(draft.price || 0)));
      draft.price = Number((base + 0.99).toFixed(2));
    }, 'Bulk rounded to .99');
  });
}

if (bulkRoundDollarBtn) {
  bulkRoundDollarBtn.addEventListener('click', () => {
    applyBulkUpdate((draft) => {
      draft.price = Math.max(0, Math.round(Number(draft.price || 0)));
    }, 'Bulk rounded to dollar');
  });
}

if (bulkDeleteSelectedBtn) {
  bulkDeleteSelectedBtn.addEventListener('click', () => {
    const selected = getSelectedDrafts();
    if (!confirmBulkUpdate(selected.length)) return;
    if (!confirm(`Delete ${selected.length} selected rows on next Save Changes?`)) return;
    for (const draft of selected) {
      draft.deleted = true;
      selectedGameIds.delete(draft.id);
    }
    renderGamesTable();
    showToast('Bulk delete queued');
  });
}

addFaqForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      question: document.getElementById('faqQuestion').value.trim(),
      answer: document.getElementById('faqAnswer').value.trim(),
      sortOrder: Number(document.getElementById('faqSortOrder').value || 0),
      active: document.getElementById('faqActive').value === '1',
    };

    const res = await adminFetch('/api/admin/faqs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add FAQ');

    addFaqForm.reset();
    document.getElementById('faqSortOrder').value = '0';
    document.getElementById('faqActive').value = '1';
    renderNotice('FAQ added.');
    showToast('Saved');
    await loadFaqs();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

applySubmissionFiltersBtn.addEventListener('click', async () => {
  submissionsState.status = submissionsStatusFilterInput.value || 'All';
  submissionsState.q = submissionsSearchInput.value.trim();
  submissionsState.sort = selectedSubmissionSort();
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

clearSubmissionFiltersBtn.addEventListener('click', async () => {
  submissionsStatusFilterInput.value = 'All';
  submissionsSearchInput.value = '';
  if (submissionsSortInput) submissionsSortInput.value = 'newest';
  submissionsState.status = 'All';
  submissionsState.q = '';
  submissionsState.sort = 'newest';
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

submissionsSearchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  submissionsState.status = submissionsStatusFilterInput.value || 'All';
  submissionsState.q = submissionsSearchInput.value.trim();
  submissionsState.sort = selectedSubmissionSort();
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

if (submissionsSortInput) {
  submissionsSortInput.addEventListener('change', async () => {
    submissionsState.sort = selectedSubmissionSort();
    try {
      await loadSubmissions(1);
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

exportFilteredSubmissionsCsvBtn.addEventListener('click', async () => {
  try {
    const query = submissionFiltersQueryString(false);
    const url = query ? `/api/admin/submissions/export-csv?${query}` : '/api/admin/submissions/export-csv';
    await downloadAdminCsv(url, 'submissions-filtered.csv');
    showToast('Exported');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

closeSubmissionDetailBtn.addEventListener('click', closeSubmissionDetailModal);

submissionDetailModal.addEventListener('click', (e) => {
  if (e.target === submissionDetailModal) {
    closeSubmissionDetailModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSubmissionDetailModal();
});
