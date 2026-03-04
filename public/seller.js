const buylistWrap = document.getElementById('buylistTableWrap');
const platformTabsWrap = document.getElementById('platformTabs');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clearSearch');
const sellerRowsPerPageInput = document.getElementById('sellerRowsPerPage');
const sellerPaginationWrap = document.getElementById('sellerPagination');
const stickyPayout = document.getElementById('stickyPayout');
const mobileSubmitAmount = document.getElementById('mobileSubmitAmount');
const mobileSubmitCount = document.getElementById('mobileSubmitCount');
const mobileGoToSubmitBtn = document.getElementById('mobileGoToSubmit');
const form = document.getElementById('submissionForm');
const shipmentSection = document.getElementById('shipmentSection');
const msg = document.getElementById('message');
const totalPreview = document.getElementById('totalPreview');
const shipmentPreview = document.getElementById('shipmentPreview');
const selectedItemsWrap = document.getElementById('selectedItemsWrap');
const tableMeta = document.getElementById('tableMeta');
const faqListWrap = document.getElementById('faqList');
const stepProgress = document.getElementById('stepProgress');
const shipmentJumpLinks = document.querySelectorAll('[data-shipment-jump]');
const conditionStandardsDetails = document.getElementById('conditionStandardsDetails');
const conditionStandardsAction = document.querySelector('.policy-summary-action');

const BUYLIST_UPDATED_EVENT = 'buylistUpdatedAt';
const BUYLIST_SNAPSHOT_EVENT = 'buylistSnapshot';
const AUTO_REFRESH_MS = 15000;
const SNAPSHOT_GRACE_MS = 5 * 60 * 1000;
const CONDITION_RULES_STORAGE_KEY = 'conditionRulesExpanded';
const PRICING_LOCK_QUESTION = 'When is pricing locked in?';
const PRICING_LOCK_ANSWER = 'Pricing is locked in once your shipment is submitted.';
const MIN_TABLE_HEIGHT = 300;
const MOBILE_PLATFORM_BREAKPOINT_QUERY = '(max-width: 640px)';
const ALL_PLATFORMS_VALUE = '__all__';
const TITLE_PREVIEW_HOLD_MS = 220;
const PACKING_SLIP_SESSION_KEY = 'ibgPackingSlipPayload';
const PACKING_SLIP_LOCAL_KEY = 'ibgPackingSlipPayloadBackup';
const PACKING_SLIP_PATH = '/packing-slip.html';
const SELLER_ROWS_PER_PAGE_OPTIONS = [10, 20, 25, 50, 100];
const SELLER_ROWS_PER_PAGE_DEFAULT = 25;
const SELLER_ROWS_PER_PAGE_STORAGE_KEY = 'sellerRowsPerPage';
const isSellerPageView = /\/seller(\.html)?$/i.test(window.location.pathname || '');

let games = [];
const qtyMap = new Map();
const platformTabs = [
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
let activePlatformTab = platformTabs[0] || '';
let gamesSignature = '';
let localSnapshotUpdatedAt = 0;
let hasSubmittedShipment = false;
let mobileSubmitToastTimer = 0;
const mobilePlatformMedia = window.matchMedia(MOBILE_PLATFORM_BREAKPOINT_QUERY);
let isMobilePlatformUi = mobilePlatformMedia.matches;
let titlePreviewBubble = null;
let titlePreviewHoldTimer = 0;
let titlePreviewTrigger = null;
let titlePreviewHoldTriggered = false;
let sellerTableState = {
  page: 1,
  pageSize: loadSellerRowsPerPagePreference(),
};

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function asMoney(price) {
  return `$${Number(price).toFixed(2)}`;
}

function normalizeSellerRowsPerPage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return SELLER_ROWS_PER_PAGE_DEFAULT;
  return SELLER_ROWS_PER_PAGE_OPTIONS.includes(parsed) ? parsed : SELLER_ROWS_PER_PAGE_DEFAULT;
}

function loadSellerRowsPerPagePreference() {
  try {
    return normalizeSellerRowsPerPage(localStorage.getItem(SELLER_ROWS_PER_PAGE_STORAGE_KEY));
  } catch {
    return SELLER_ROWS_PER_PAGE_DEFAULT;
  }
}

function saveSellerRowsPerPagePreference(pageSize) {
  try {
    localStorage.setItem(SELLER_ROWS_PER_PAGE_STORAGE_KEY, String(normalizeSellerRowsPerPage(pageSize)));
  } catch {
    // Ignore localStorage failures.
  }
}

function syncSellerRowsPerPageControl() {
  if (!sellerRowsPerPageInput) return;
  sellerRowsPerPageInput.value = String(normalizeSellerRowsPerPage(sellerTableState.pageSize));
}

function formatSignedMoneyFromCents(cents) {
  const amount = Number(cents || 0);
  const abs = Math.abs(amount / 100).toFixed(2);
  return `${amount >= 0 ? '+' : '-'}$${abs}`;
}

function computeGamesSignature(items) {
  return items
    .map(
      (g) =>
        `${g.id}|${g.title}|${g.platform || ''}|${g.price}|${g.active ? 1 : 0}|${g.price_change_direction || ''}|${
          g.previous_price_cents ?? ''
        }|${g.comparison_baseline_version || ''}`
    )
    .join('~');
}

function priceDeltaMeta(game) {
  const baselineVersion = String(game?.comparison_baseline_version || '').trim();
  const previousRaw = game?.previous_price_cents;
  const previousParsed = Number(previousRaw);
  const hasPrevious =
    previousRaw !== null && previousRaw !== undefined && previousRaw !== '' && Number.isFinite(previousParsed);
  const previousCents = hasPrevious ? previousParsed : null;
  const currentCents = Math.round(Number(game?.price || 0) * 100);
  const changeCents = hasPrevious ? currentCents - previousCents : null;
  const changePercent = hasPrevious && previousCents > 0 ? Number(((changeCents / previousCents) * 100).toFixed(1)) : null;
  let direction = String(game?.price_change_direction || '').toLowerCase();
  if (direction !== 'up' && direction !== 'down' && direction !== 'same' && direction !== 'new') {
    if (hasPrevious) {
      direction = currentCents > previousCents ? 'up' : currentCents < previousCents ? 'down' : 'same';
    } else if (baselineVersion) {
      direction = 'new';
    } else {
      direction = 'none';
    }
  }
  const baselineSuffix = baselineVersion ? ` in ${baselineVersion}` : '';

  if (direction === 'up') {
    return {
      className: 'up',
      extra: '<span class="price-delta-arrow">▲</span>',
      tooltip: hasPrevious ? `Was ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
      deltaLine: `${formatSignedMoneyFromCents(changeCents)}${
        changePercent === null ? '' : ` (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%)`
      }`,
    };
  }
  if (direction === 'down') {
    return {
      className: 'down',
      extra: '<span class="price-delta-arrow">▼</span>',
      tooltip: hasPrevious ? `Was ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
      deltaLine: `${formatSignedMoneyFromCents(changeCents)}${
        changePercent === null ? '' : ` (${changePercent.toFixed(1)}%)`
      }`,
    };
  }
  if (direction === 'new') {
    return {
      className: 'new',
      extra: '<span class="price-delta-tag">New</span>',
      tooltip: baselineVersion ? `New this version (vs ${baselineVersion})` : 'New this version',
      deltaLine: '',
    };
  }

  return {
    className: '',
    extra: '',
    tooltip: hasPrevious && baselineVersion ? `Same as ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
    deltaLine: '',
  };
}

function renderPriceWithDelta(game, meta = priceDeltaMeta(game)) {
  const titleAttr = meta.tooltip ? ` title="${escapeHtml(meta.tooltip)}"` : '';
  const className = meta.className ? `price-cell-value ${meta.className}` : 'price-cell-value';
  const noteClass = meta.className ? meta.className : 'same';
  const note = meta.deltaLine
    ? `<span class="price-delta-note ${noteClass}"${titleAttr}>${escapeHtml(meta.deltaLine)}</span>`
    : '';
  return `<span class="price-cell-stack"><span class="${className}"${titleAttr}>${asMoney(game.price)}${meta.extra}</span>${note}</span>`;
}

function renderTitleWithDelta(game, meta = priceDeltaMeta(game)) {
  const arrow = meta.className === 'up' ? '▲' : meta.className === 'down' ? '▼' : '';
  const className = meta.className ? `title-cell-value ${meta.className}` : 'title-cell-value';
  const fullTitle = escapeHtml(game.title || '');
  const recentlyAddedBadge = game?.recently_added_badge_active ? '<span class="title-new-badge">★ New</span>' : '';
  return `<span class="title-cell-stack">${recentlyAddedBadge}<span class="${className} js-title-preview-trigger" data-full-title="${fullTitle}" title="${fullTitle}">${fullTitle}${
    arrow ? `<span class="title-delta-arrow">${arrow}</span>` : ''
  }</span></span>`;
}

function ensureTitlePreviewBubble() {
  if (titlePreviewBubble && titlePreviewBubble.isConnected) return titlePreviewBubble;
  const bubble = document.createElement('div');
  bubble.className = 'title-preview-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bubble);
  titlePreviewBubble = bubble;
  return bubble;
}

function clearTitlePreviewTimer() {
  if (!titlePreviewHoldTimer) return;
  clearTimeout(titlePreviewHoldTimer);
  titlePreviewHoldTimer = 0;
}

function isTitlePreviewVisible() {
  return Boolean(titlePreviewBubble && titlePreviewBubble.classList.contains('is-visible'));
}

function hideTitlePreviewBubble() {
  clearTitlePreviewTimer();
  if (titlePreviewBubble) {
    titlePreviewBubble.classList.remove('is-visible');
  }
  titlePreviewHoldTriggered = false;
  titlePreviewTrigger = null;
}

function positionTitlePreviewBubble(trigger, bubble) {
  const spacing = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(140, viewportWidth - spacing * 2);
  bubble.style.maxWidth = `${maxWidth}px`;
  bubble.style.left = `${spacing}px`;
  bubble.style.top = `${spacing}px`;

  const bubbleRect = bubble.getBoundingClientRect();
  let left = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2;
  left = Math.max(spacing, Math.min(left, viewportWidth - bubbleRect.width - spacing));

  let top = triggerRect.top - bubbleRect.height - spacing;
  if (top < spacing) {
    top = triggerRect.bottom + spacing;
  }
  if (top + bubbleRect.height > viewportHeight - spacing) {
    top = Math.max(spacing, viewportHeight - bubbleRect.height - spacing);
  }

  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function showTitlePreviewBubble(trigger) {
  if (!mobilePlatformMedia.matches || !trigger) return;
  const fullTitle = String(trigger.getAttribute('data-full-title') || trigger.textContent || '').trim();
  if (!fullTitle) return;

  const bubble = ensureTitlePreviewBubble();
  bubble.textContent = fullTitle;
  bubble.classList.add('is-visible');
  positionTitlePreviewBubble(trigger, bubble);
}

function queueTitlePreviewBubble(trigger) {
  clearTitlePreviewTimer();
  titlePreviewTrigger = trigger;
  titlePreviewHoldTriggered = false;
  titlePreviewHoldTimer = window.setTimeout(() => {
    if (titlePreviewTrigger !== trigger) return;
    titlePreviewHoldTriggered = true;
    showTitlePreviewBubble(trigger);
  }, TITLE_PREVIEW_HOLD_MS);
}

function setupMobileTitlePreview() {
  if (!buylistWrap) return;

  buylistWrap.addEventListener('pointerdown', (event) => {
    if (!mobilePlatformMedia.matches) return;
    if (event.pointerType === 'mouse') return;
    const trigger = event.target.closest('.js-title-preview-trigger');
    if (!trigger || !buylistWrap.contains(trigger)) {
      if (isTitlePreviewVisible()) hideTitlePreviewBubble();
      return;
    }
    queueTitlePreviewBubble(trigger);
  });

  document.addEventListener(
    'pointerup',
    (event) => {
      if (!mobilePlatformMedia.matches || event.pointerType === 'mouse') return;
      const hadPendingHold = Boolean(titlePreviewHoldTimer);
      clearTitlePreviewTimer();
      if (!titlePreviewHoldTriggered && hadPendingHold && isTitlePreviewVisible()) {
        hideTitlePreviewBubble();
        return;
      }
      titlePreviewHoldTriggered = false;
      titlePreviewTrigger = null;
    },
    true
  );

  document.addEventListener(
    'pointercancel',
    () => {
      clearTitlePreviewTimer();
      titlePreviewHoldTriggered = false;
      titlePreviewTrigger = null;
    },
    true
  );

  const dismissPreview = () => hideTitlePreviewBubble();
  window.addEventListener('scroll', dismissPreview, { passive: true });
  window.addEventListener('blur', dismissPreview);
}

function applyGames(nextGames) {
  const nextSignature = computeGamesSignature(nextGames);
  if (nextSignature === gamesSignature) return;

  const validIds = new Set(nextGames.map((g) => g.id));
  for (const id of Array.from(qtyMap.keys())) {
    if (!validIds.has(id)) qtyMap.delete(id);
  }

  games = nextGames;
  gamesSignature = nextSignature;
  renderTabs();
  renderSelectedItems();
  renderTable();
}

function loadSnapshotFromStorage() {
  try {
    const raw = localStorage.getItem(BUYLIST_SNAPSHOT_EVENT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.games)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function shouldPreferSnapshot(snapshot, apiGames) {
  if (!snapshot || !Array.isArray(snapshot.games)) return false;
  const snapshotTs = Number(snapshot.updatedAt || 0);
  if (!snapshotTs) return false;
  if (Date.now() - snapshotTs > SNAPSHOT_GRACE_MS) return false;
  return computeGamesSignature(snapshot.games) !== computeGamesSignature(apiGames);
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore write failures in private mode.
  }
}

function renderMessage(text, type = 'ok') {
  if (!text) {
    msg.innerHTML = '';
    return;
  }
  msg.innerHTML = `<div class="notice ${type}">${escapeHtml(text)}</div>`;
}

function normalizeShipmentItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const title = String(item?.title || '').trim() || 'Untitled Game';
      const quantity = Math.max(0, Number.parseInt(item?.quantity, 10) || 0);
      return { title, quantity };
    })
    .filter((item) => item.quantity > 0);
}

function buildPackingSlipPrintPayload(shipment, seller) {
  const items = normalizeShipmentItems(shipment?.items);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const currentPath = `${window.location.pathname || '/'}${window.location.search || ''}`;
  const returnTo = currentPath && currentPath !== PACKING_SLIP_PATH ? currentPath : '/seller.html';

  return {
    shipmentId: String(shipment?.id || '').trim() || '-',
    submissionId: String(shipment?.submissionId || '').trim() || '-',
    createdAt: shipment?.createdAt || new Date().toISOString(),
    sellerName: String(seller?.customerName || '').trim() || '-',
    sellerEmail: String(seller?.email || '').trim() || '-',
    sellerPhone: String(seller?.phone || '').trim() || '-',
    totalQuantity,
    itemCount: items.length,
    items,
    returnTo,
  };
}

function persistPackingSlipPayload(payload) {
  const serialized = JSON.stringify(payload);
  let stored = false;
  try {
    sessionStorage.setItem(PACKING_SLIP_SESSION_KEY, serialized);
    stored = true;
  } catch {
    // Ignore session storage failures.
  }
  try {
    localStorage.setItem(PACKING_SLIP_LOCAL_KEY, serialized);
    stored = true;
  } catch {
    // Ignore local storage failures.
  }
  return stored;
}

function printPackingSlip(shipment, seller) {
  const payload = buildPackingSlipPrintPayload(shipment, seller);
  if (!payload.items.length) {
    renderMessage('No games were found for this packing slip.', 'error');
    return;
  }
  if (!persistPackingSlipPayload(payload)) {
    renderMessage('Could not prepare your packing slip. Please try again.', 'error');
    return;
  }
  window.location.assign(PACKING_SLIP_PATH);
}

function renderShipment(shipment, seller) {
  if (!shipment) {
    shipmentPreview.innerHTML = '';
    return;
  }

  shipmentPreview.innerHTML = `
    <article class="card packing-slip" style="margin-top: 0.9rem">
      <h3 style="margin-top: 0">Packing Slip (Required): ${escapeHtml(shipment.id)}</h3>
      <p class="muted">Submission #${shipment.submissionId} | Created ${escapeHtml(
        new Date(shipment.createdAt).toLocaleString()
      )}</p>
      <div class="slip-meta">
        <div><strong>Seller:</strong> ${escapeHtml(seller.customerName || '-')}</div>
        <div><strong>Email:</strong> ${escapeHtml(seller.email || '-')}</div>
        <div><strong>Phone:</strong> ${escapeHtml(seller.phone || '-')}</div>
      </div>
      <table class="sheet-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Platform</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${shipment.items
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.title)}</td>
              <td>${escapeHtml(item.platform || '-')}</td>
              <td>${item.quantity}</td>
              <td>${asMoney(item.price)}</td>
              <td>${asMoney(item.lineTotal)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p><strong>Total Offer: ${asMoney(shipment.total)}</strong></p>
      <p class="muted"><strong>Include this printed slip in your package for faster receiving.</strong></p>
      <button id="printShipment" class="secondary" type="button">Print Packing Slip</button>
    </article>
  `;

  const printBtn = document.getElementById('printShipment');
  if (printBtn) {
    printBtn.addEventListener('click', () => printPackingSlip(shipment, seller));
  }
}

function renderFaqs(rows) {
  if (!faqListWrap) return;

  const nextRows = Array.isArray(rows) ? [...rows] : [];
  const hasPricingLock = nextRows.some(
    (row) => String(row?.question || '').trim().toLowerCase() === PRICING_LOCK_QUESTION.toLowerCase()
  );
  if (!hasPricingLock) {
    nextRows.push({ question: PRICING_LOCK_QUESTION, answer: PRICING_LOCK_ANSWER });
  }

  faqListWrap.innerHTML = nextRows
    .map(
      (f) => `
      <details>
        <summary>${escapeHtml(f.question)}</summary>
        <p>${escapeHtml(f.answer)}</p>
      </details>
    `
    )
    .join('');
}

function syncConditionStandardsSummary() {
  if (!conditionStandardsDetails || !conditionStandardsAction) return;
  const openLabel = conditionStandardsAction.getAttribute('data-open-label') || 'Tap to collapse';
  const closedLabel = conditionStandardsAction.getAttribute('data-closed-label') || 'Tap to expand';
  conditionStandardsAction.textContent = conditionStandardsDetails.open ? openLabel : closedLabel;
}

function initConditionStandardsAccordion() {
  if (!conditionStandardsDetails) return;
  const saved = readStorage(CONDITION_RULES_STORAGE_KEY);
  conditionStandardsDetails.open = saved === '1';
  syncConditionStandardsSummary();
  conditionStandardsDetails.addEventListener('toggle', () => {
    writeStorage(CONDITION_RULES_STORAGE_KEY, conditionStandardsDetails.open ? '1' : '0');
    syncConditionStandardsSummary();
  });
}

function normalizePlatformForTab(raw) {
  const original = String(raw || '').trim();
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

function matchesPlatformTab(game, tab) {
  if (!tab || tab === ALL_PLATFORMS_VALUE) return true;
  return normalizePlatformForTab(game.platform) === tab;
}

function getGamesForPlatform(tab) {
  if (tab === ALL_PLATFORMS_VALUE) return games.slice();
  return games.filter((g) => matchesPlatformTab(g, tab));
}

function ensureActivePlatformSelection() {
  if (!activePlatformTab) {
    activePlatformTab = platformTabs[0] || '';
    return;
  }
  if (!isMobilePlatformUi && activePlatformTab === ALL_PLATFORMS_VALUE) {
    activePlatformTab = platformTabs[0] || '';
  }
}

function renderTabs() {
  ensureActivePlatformSelection();
  const countsByTab = new Map(platformTabs.map((tab) => [tab, getGamesForPlatform(tab).length]));
  const totalCount = games.length;
  platformTabsWrap.classList.toggle('is-mobile-select', isMobilePlatformUi);

  if (isMobilePlatformUi) {
    platformTabsWrap.innerHTML = `
      <label class="platform-select-label" for="platformSelectMobile">Platform</label>
      <select id="platformSelectMobile" class="platform-select">
        <option value="${ALL_PLATFORMS_VALUE}" ${
      activePlatformTab === ALL_PLATFORMS_VALUE ? 'selected' : ''
    }>All Platforms (${totalCount})</option>
        ${platformTabs
          .map((tab) => {
            const count = countsByTab.get(tab) || 0;
            return `<option value="${escapeHtml(tab)}" ${tab === activePlatformTab ? 'selected' : ''}>${escapeHtml(
              `${tab} (${count})`
            )}</option>`;
          })
          .join('')}
      </select>
    `;

    const select = document.getElementById('platformSelectMobile');
    if (select) {
      select.addEventListener('change', () => {
        activePlatformTab = select.value || ALL_PLATFORMS_VALUE;
        sellerTableState.page = 1;
        renderTabs();
        renderTable();
        if (searchInput) searchInput.focus();
      });
    }
    return;
  }

  platformTabsWrap.innerHTML = platformTabs
    .map(
      (tab) => `
        <button
          type="button"
          class="tab-btn ${tab === activePlatformTab ? 'active' : ''}"
          data-platform-tab="${escapeHtml(tab)}"
          title="${escapeHtml(`${tab} (${countsByTab.get(tab) || 0})`)}"
        >
          ${escapeHtml(tab)} (${countsByTab.get(tab) || 0})
        </button>
      `
    )
    .join('');

  platformTabsWrap.querySelectorAll('button[data-platform-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePlatformTab = btn.getAttribute('data-platform-tab');
      sellerTableState.page = 1;
      renderTabs();
      renderTable();
      if (searchInput) searchInput.focus();
    });
  });
}

function selectedItems() {
  return games
    .map((g) => ({
      gameId: g.id,
      quantity: Number(qtyMap.get(g.id) || 0),
      price: Number(g.price),
    }))
    .filter((x) => Number.isInteger(x.quantity) && x.quantity > 0);
}

function setProgress(step) {
  if (!stepProgress) return;
  stepProgress.querySelectorAll('.step-pill').forEach((el) => {
    const itemStep = Number(el.getAttribute('data-step'));
    el.classList.toggle('is-active', itemStep === step);
    el.classList.toggle('is-complete', itemStep < step);
  });
}

function updateProgress(total) {
  if (hasSubmittedShipment) {
    setProgress(3);
    return;
  }
  setProgress(total > 0 ? 2 : 1);
}

function updateStickyPayout(total) {
  if (!stickyPayout) return;
  stickyPayout.textContent = `Estimated Payout: ${asMoney(total)}`;
  stickyPayout.hidden = total <= 0;
  stickyPayout.classList.toggle('is-visible', total > 0);
}

function showMobileSubmitToast(text) {
  if (!text) return;

  let toast = document.getElementById('mobileSubmitToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mobileSubmitToast';
    toast.className = 'mobile-submit-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(mobileSubmitToastTimer);
  mobileSubmitToastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 1800);
}

function syncTableViewportHeight() {
  if (!buylistWrap) return;
  const rect = buylistWrap.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const bottomOffset = isMobile ? 116 : 30;
  const minHeight = isMobile ? 260 : MIN_TABLE_HEIGHT;
  const maxHeight = Math.max(minHeight, Math.floor(viewportHeight * 0.82));
  const rawHeight = Math.floor(viewportHeight - rect.top - bottomOffset);
  const calculated = Math.max(minHeight, Math.min(maxHeight, rawHeight));
  buylistWrap.style.maxHeight = `${calculated}px`;
}

function updateMobileSubmitBar(total, rows) {
  if (!mobileSubmitAmount) return;
  mobileSubmitAmount.textContent = asMoney(total);
  if (!mobileSubmitCount) return;
  const itemCount = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  mobileSubmitCount.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
}

function updateShipmentVisibility(total) {
  if (!shipmentSection) return;
  const shouldShow = total > 0 || hasSubmittedShipment;
  shipmentSection.classList.toggle('is-hidden', !shouldShow);
}

function clearCompletedShipmentState() {
  if (!hasSubmittedShipment) return;
  hasSubmittedShipment = false;
  renderShipment(null);
  renderMessage('');
}

function setQty(gameId, qty, { rerenderTable = false } = {}) {
  clearCompletedShipmentState();
  const nextQty = Math.max(0, Math.floor(Number(qty || 0)));
  qtyMap.set(gameId, nextQty);
  if (rerenderTable) {
    renderTable();
    return;
  }
  updateTotal();
  renderSelectedItems();
}

function addQty(gameId, amount = 1) {
  const current = Number(qtyMap.get(gameId) || 0);
  const increment = Math.max(1, Math.floor(Number(amount || 1)));
  setQty(gameId, current + increment, { rerenderTable: true });
}

function getFilteredGames() {
  const q = searchInput.value.trim().toLowerCase();
  const platformRows = getGamesForPlatform(activePlatformTab);
  if (!q) return platformRows;
  return platformRows.filter((g) => String(g.title || '').toLowerCase().includes(q));
}

function renderSellerPagination(totalRows, pageRows, startIndex, totalPages) {
  if (!sellerPaginationWrap || !isSellerPageView) return;
  sellerPaginationWrap.innerHTML = '';
  if (totalRows <= 0) {
    return;
  }

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'secondary';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = sellerTableState.page <= 1;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = sellerTableState.page >= totalPages;

  const start = startIndex + 1;
  const end = startIndex + pageRows.length;
  const count = document.createElement('span');
  count.className = 'muted';
  count.textContent = `Showing ${start}\u2013${end} of ${totalRows}`;

  const page = document.createElement('span');
  page.className = 'muted';
  page.textContent = `Page ${sellerTableState.page} of ${totalPages}`;

  prevBtn.addEventListener('click', () => {
    sellerTableState.page = Math.max(1, sellerTableState.page - 1);
    renderTable();
  });
  nextBtn.addEventListener('click', () => {
    sellerTableState.page = Math.min(totalPages, sellerTableState.page + 1);
    renderTable();
  });

  sellerPaginationWrap.append(prevBtn, nextBtn, page, count);
}

function getSelectionSummary() {
  const rows = selectedItems();
  const total = rows.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return { rows, total };
}

function updateTotal() {
  const summary = getSelectionSummary();
  const total = summary.total;
  totalPreview.value = `Estimated total: ${asMoney(total)}`;
  updateStickyPayout(total);
  updateMobileSubmitBar(total, summary.rows);
  updateShipmentVisibility(total);
  updateProgress(total);
  return total;
}

function renderSelectedItems() {
  const rows = selectedItems();
  if (rows.length === 0) {
    selectedItemsWrap.innerHTML = '<p class="muted">No games in shipment yet. Set qty in a console table.</p>';
    return;
  }

  const byId = new Map(games.map((g) => [g.id, g]));
  selectedItemsWrap.innerHTML = `
    <table class="sheet-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Console</th>
          <th>Paying</th>
          <th>Qty</th>
          <th>Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const game = byId.get(row.gameId);
            const lineTotal = row.price * row.quantity;
            return `
              <tr>
                <td>${escapeHtml(game?.title || '')}</td>
                <td>${escapeHtml(game?.platform || '')}</td>
                <td>${asMoney(row.price)}</td>
                <td><input type="number" min="0" step="1" value="${row.quantity}" data-summary-game-id="${
                  row.gameId
                }" style="width: 88px" /></td>
                <td>${asMoney(lineTotal)}</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  selectedItemsWrap.querySelectorAll('input[data-summary-game-id]').forEach((el) => {
    el.addEventListener('input', () => {
      const gameId = Number(el.getAttribute('data-summary-game-id'));
      setQty(gameId, el.value, { rerenderTable: true });
    });
  });
}

function renderTable() {
  if (!activePlatformTab && platformTabs.length > 0) {
    activePlatformTab = isMobilePlatformUi ? ALL_PLATFORMS_VALUE : platformTabs[0];
    renderTabs();
  }

  if (!activePlatformTab) {
    tableMeta.textContent = 'Buylist';
    buylistWrap.innerHTML = '<p class="muted">No console tabs are configured.</p>';
    if (sellerPaginationWrap) sellerPaginationWrap.innerHTML = '';
    return;
  }

  const selectedPlatformLabel = activePlatformTab === ALL_PLATFORMS_VALUE ? 'All Platforms' : activePlatformTab;
  const platformRows = getGamesForPlatform(activePlatformTab);
  const filtered = getFilteredGames();
  let pagedRows = filtered;
  let startIndex = 0;
  let totalPages = 1;

  if (isSellerPageView) {
    const pageSize = normalizeSellerRowsPerPage(sellerTableState.pageSize);
    sellerTableState.pageSize = pageSize;
    totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    sellerTableState.page = Math.min(Math.max(1, sellerTableState.page), totalPages);
    startIndex = filtered.length > 0 ? (sellerTableState.page - 1) * pageSize : 0;
    pagedRows = filtered.slice(startIndex, startIndex + pageSize);
    syncSellerRowsPerPageControl();
    if (filtered.length > 0) {
      tableMeta.textContent = `Showing ${startIndex + 1}\u2013${startIndex + pagedRows.length} of ${filtered.length} in ${selectedPlatformLabel}`;
    } else {
      tableMeta.textContent = `Showing 0 of 0 in ${selectedPlatformLabel}`;
    }
    renderSellerPagination(filtered.length, pagedRows, startIndex, totalPages);
  } else {
    tableMeta.textContent = `Showing ${filtered.length} of ${platformRows.length} in ${selectedPlatformLabel}`;
    if (sellerPaginationWrap) sellerPaginationWrap.innerHTML = '';
  }

  if (filtered.length === 0) {
    buylistWrap.innerHTML = `<p class="muted">No matching games found for ${escapeHtml(selectedPlatformLabel)}.</p>`;
    syncTableViewportHeight();
    updateTotal();
    renderSelectedItems();
    return;
  }

  const rowsToRender = isSellerPageView ? pagedRows : filtered;

  buylistWrap.innerHTML = `
    <table class="sheet-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Condition</th>
          <th>You Get Paid</th>
          <th>Qty</th>
          <th>Add</th>
        </tr>
      </thead>
      <tbody>
        ${rowsToRender
          .map((g) => {
            const deltaMeta = priceDeltaMeta(g);
            const rowClass = deltaMeta.className ? `delta-${deltaMeta.className}` : '';
            return `
          <tr class="${rowClass}">
            <td class="game-title-cell" title="${escapeHtml(g.title)}">${renderTitleWithDelta(g, deltaMeta)}</td>
            <td>CIB</td>
            <td>${renderPriceWithDelta(g, deltaMeta)}</td>
            <td>
              <div class="qty-cell">
                <input
                  class="qty-input"
                  type="number"
                  min="0"
                  step="1"
                  value="${qtyMap.get(g.id) || 0}"
                  data-game-id="${g.id}"
                />
              </div>
            </td>
            <td><button type="button" class="secondary add-btn" data-add-game-id="${g.id}">Add</button></td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  buylistWrap.querySelectorAll('input[data-game-id]').forEach((el) => {
    el.addEventListener('input', () => {
      const gameId = Number(el.getAttribute('data-game-id'));
      setQty(gameId, el.value);
    });
  });

  buylistWrap.querySelectorAll('button[data-add-game-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gameId = Number(btn.getAttribute('data-add-game-id'));
      addQty(gameId);
    });
  });

  syncTableViewportHeight();
  updateTotal();
  renderSelectedItems();
}

async function loadGames() {
  renderTabs();
  renderTable();
  try {
    const r = await fetch(`/api/games?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Games fetch failed (${r.status})`);
    const nextGames = await r.json();
    // Server is source of truth so admin price edits reflect immediately on seller pages.
    applyGames(nextGames);
  } catch {
    const snapshot = loadSnapshotFromStorage();
    if (!snapshot || !Array.isArray(snapshot.games)) throw new Error('Could not load games');
    const ts = Number(snapshot.updatedAt || 0);
    if (ts > localSnapshotUpdatedAt) {
      localSnapshotUpdatedAt = ts;
    }
    applyGames(snapshot.games);
  }
}

async function loadFaqs() {
  if (!faqListWrap) return;
  const r = await fetch(`/api/faqs?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load FAQs');
  const rows = await r.json();
  renderFaqs(rows);
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    if (isSellerPageView) sellerTableState.page = 1;
    renderTable();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const firstMatch = getFilteredGames()[0];
    if (!firstMatch) return;
    addQty(firstMatch.id);
  });
}

if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    if (isSellerPageView) sellerTableState.page = 1;
    renderTable();
  });
}

if (sellerRowsPerPageInput) {
  syncSellerRowsPerPageControl();
  sellerRowsPerPageInput.addEventListener('change', () => {
    const next = normalizeSellerRowsPerPage(sellerRowsPerPageInput.value);
    sellerTableState.pageSize = next;
    sellerTableState.page = 1;
    saveSellerRowsPerPagePreference(next);
    renderTable();
  });
}

shipmentJumpLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    const buylistSection = document.getElementById('buylist-tool');
    const customerNameInput = document.getElementById('customerName');
    if (!shipmentSection && !buylistSection) return;

    e.preventDefault();

    const shipmentVisible = shipmentSection && !shipmentSection.classList.contains('is-hidden');
    if (shipmentVisible) {
      shipmentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (customerNameInput) customerNameInput.focus();
      return;
    }

    if (buylistSection) {
      buylistSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (searchInput) searchInput.focus();
    }
  });
});

if (mobileGoToSubmitBtn) {
  mobileGoToSubmitBtn.addEventListener('click', () => {
    const summary = getSelectionSummary();
    if (summary.total <= 0) {
      showMobileSubmitToast('Add at least 1 game to continue.');
      if (searchInput) searchInput.focus();
      return;
    }

    if (shipmentSection && shipmentSection.classList.contains('is-hidden')) {
      shipmentSection.classList.remove('is-hidden');
    }
    if (shipmentSection) {
      shipmentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const customerNameInput = document.getElementById('customerName');
    if (customerNameInput) customerNameInput.focus();
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  renderMessage('');

  const items = selectedItems();
  if (items.length === 0) {
    renderMessage('Select at least one game with quantity above 0.', 'error');
    return;
  }

  const payload = {
    customerName: document.getElementById('customerName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    notes: document.getElementById('notes').value,
    items: items.map((i) => ({ gameId: i.gameId, quantity: i.quantity })),
  };

  try {
    const r = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await r.text();
    let body = {};
    try {
      body = responseText ? JSON.parse(responseText) : {};
    } catch {
      body = {};
    }

    if (!r.ok) {
      const fallbackError = responseText && !body.error ? responseText : '';
      renderMessage(body.error || fallbackError || 'Could not submit. Try again.', 'error');
      return;
    }

    renderShipment(body.shipment, payload);
    hasSubmittedShipment = true;
    form.reset();
    qtyMap.clear();
    renderTable();
    renderSelectedItems();
    renderMessage(`Shipment ${body.shipment.id} submitted. Print and include the packing slip in your box.`);
  } catch {
    renderMessage('Could not submit right now. Check your connection and try again.', 'error');
  }
});

initConditionStandardsAccordion();
setupMobileTitlePreview();
updateTotal();
renderSelectedItems();
syncTableViewportHeight();

loadGames()
  .then(() => {
    renderTable();
    syncTableViewportHeight();
  })
  .catch(() => {
    renderTabs();
    updateTotal();
    renderSelectedItems();
    syncTableViewportHeight();
    buylistWrap.innerHTML = '<p class="notice error">Could not load the buylist.</p>';
  });

loadFaqs().catch(() => {
  if (faqListWrap) faqListWrap.innerHTML = '<p class="muted">Could not load FAQs right now.</p>';
});

window.addEventListener('storage', (e) => {
  if (e.key === BUYLIST_UPDATED_EVENT) {
    const snapshot = loadSnapshotFromStorage();
    if (snapshot) {
      const ts = Number(snapshot.updatedAt || 0);
      if (ts > localSnapshotUpdatedAt) {
        localSnapshotUpdatedAt = ts;
        applyGames(snapshot.games);
      }
    }
    loadGames().catch(() => {});
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    Promise.all([loadGames(), loadFaqs()]).catch(() => {});
    syncTableViewportHeight();
  }
});

window.addEventListener('resize', syncTableViewportHeight);

function handleMobilePlatformModeChange() {
  const nextMode = mobilePlatformMedia.matches;
  if (nextMode === isMobilePlatformUi) return;
  isMobilePlatformUi = nextMode;
  if (isSellerPageView) sellerTableState.page = 1;
  if (!isMobilePlatformUi && activePlatformTab === ALL_PLATFORMS_VALUE) {
    activePlatformTab = platformTabs[0] || '';
  }
  renderTabs();
  renderTable();
}

if (mobilePlatformMedia.addEventListener) {
  mobilePlatformMedia.addEventListener('change', handleMobilePlatformModeChange);
} else if (mobilePlatformMedia.addListener) {
  mobilePlatformMedia.addListener(handleMobilePlatformModeChange);
}

setInterval(() => {
  Promise.all([loadGames(), loadFaqs()]).catch(() => {});
}, AUTO_REFRESH_MS);
