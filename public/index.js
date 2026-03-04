const buylistWrap = document.getElementById('buylistTableWrap');
const platformTabsWrap = document.getElementById('platformTabs');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clearSearch');
const comfortModeInput = document.getElementById('comfortMode');
const homeRowsPerPageInput = document.getElementById('homeRowsPerPage');
const homeViewingPerPage = document.getElementById('homeViewingPerPage');
const homePaginationWrap = document.getElementById('homePagination');
const shipmentSection = document.getElementById('shipmentSection');
const mobileSubmitAmount = document.getElementById('mobileSubmitAmount');
const mobileSubmitCount = document.getElementById('mobileSubmitCount');
const mobileGoToSubmitBtn = document.getElementById('mobileGoToSubmit');
const form = document.getElementById('submissionForm');
const msg = document.getElementById('message');
const totalPreview = document.getElementById('totalPreview');
const shipmentPreview = document.getElementById('shipmentPreview');
const selectedItemsWrap = document.getElementById('selectedItemsWrap');
const tableMeta = document.getElementById('tableMeta');
const faqListWrap = document.getElementById('faqList');
const BUYLIST_UPDATED_EVENT = 'buylistUpdatedAt';
const BUYLIST_SNAPSHOT_EVENT = 'buylistSnapshot';
const AUTO_REFRESH_MS = 15000;
const SNAPSHOT_GRACE_MS = 5 * 60 * 1000;
const MOBILE_PLATFORM_BREAKPOINT_QUERY = '(max-width: 640px)';
const ALL_PLATFORMS_VALUE = '__all__';
const TITLE_PREVIEW_HOLD_MS = 220;
const HOME_ROWS_PER_PAGE_OPTIONS = [10, 20, 25, 50, 100];
const HOME_ROWS_PER_PAGE_DEFAULT = 25;
const HOME_ROWS_PER_PAGE_STORAGE_KEY = 'homeRowsPerPage';
const PUBLIC_COMFORT_MODE_STORAGE_KEY = 'publicComfortMode';

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
let activePlatformTab = '';
let gamesSignature = '';
let localSnapshotUpdatedAt = 0;
let mobileSubmitToastTimer = 0;
const mobilePlatformMedia = window.matchMedia(MOBILE_PLATFORM_BREAKPOINT_QUERY);
let isMobilePlatformUi = mobilePlatformMedia.matches;
let titlePreviewBubble = null;
let titlePreviewHoldTimer = 0;
let titlePreviewTrigger = null;
let titlePreviewHoldTriggered = false;
let homeTableState = {
  page: 1,
  pageSize: loadHomeRowsPerPagePreference(),
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

function normalizeHomeRowsPerPage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return HOME_ROWS_PER_PAGE_DEFAULT;
  return HOME_ROWS_PER_PAGE_OPTIONS.includes(parsed) ? parsed : HOME_ROWS_PER_PAGE_DEFAULT;
}

function loadHomeRowsPerPagePreference() {
  try {
    return normalizeHomeRowsPerPage(localStorage.getItem(HOME_ROWS_PER_PAGE_STORAGE_KEY));
  } catch {
    return HOME_ROWS_PER_PAGE_DEFAULT;
  }
}

function saveHomeRowsPerPagePreference(value) {
  try {
    localStorage.setItem(HOME_ROWS_PER_PAGE_STORAGE_KEY, String(normalizeHomeRowsPerPage(value)));
  } catch {
    // Ignore storage write failures.
  }
}

function applyComfortMode(enabled) {
  document.body.classList.toggle('comfort-mode-on', Boolean(enabled));
  if (comfortModeInput) comfortModeInput.value = enabled ? 'on' : 'off';
}

function loadComfortModePreference() {
  try {
    return localStorage.getItem(PUBLIC_COMFORT_MODE_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function saveComfortModePreference(enabled) {
  try {
    localStorage.setItem(PUBLIC_COMFORT_MODE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Ignore storage write failures.
  }
}

function syncHomeRowsPerPageControl() {
  if (homeRowsPerPageInput) {
    homeRowsPerPageInput.value = String(normalizeHomeRowsPerPage(homeTableState.pageSize));
  }
  if (homeViewingPerPage) {
    homeViewingPerPage.textContent = `Viewing ${normalizeHomeRowsPerPage(homeTableState.pageSize)} per page`;
  }
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
  return `<span class="${className} js-title-preview-trigger" data-full-title="${fullTitle}" title="${fullTitle}">${fullTitle}${
    arrow ? `<span class="title-delta-arrow">${arrow}</span>` : ''
  }</span>`;
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

function renderMessage(text, type = 'ok') {
  if (!text) {
    msg.innerHTML = '';
    return;
  }
  msg.innerHTML = `<div class="notice ${type}">${escapeHtml(text)}</div>`;
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
    printBtn.addEventListener('click', () => window.print());
  }
}

function renderFaqs(rows) {
  if (!faqListWrap) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    faqListWrap.innerHTML = '<p class="muted">FAQs will be added soon.</p>';
    return;
  }

  faqListWrap.innerHTML = rows
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

function renderTabs() {
  const countsByTab = new Map(
    platformTabs.map((tab) => [tab, games.filter((g) => normalizePlatformForTab(g.platform) === tab).length])
  );
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
        homeTableState.page = 1;
        renderTabs();
        renderTable();
        if (searchInput) searchInput.focus();
      });
    }
    return;
  }

  if (!activePlatformTab || activePlatformTab === ALL_PLATFORMS_VALUE) {
    activePlatformTab = platformTabs[0] || '';
  }

  platformTabsWrap.innerHTML = platformTabs
    .map(
      (tab) => `
        <button
          type="button"
          class="tab-btn ${tab === activePlatformTab ? 'active' : ''}"
          data-platform-tab="${escapeHtml(tab)}"
        >
          ${escapeHtml(tab)} (${countsByTab.get(tab) || 0})
        </button>
      `
    )
    .join('');

  platformTabsWrap.querySelectorAll('button[data-platform-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePlatformTab = btn.getAttribute('data-platform-tab');
      homeTableState.page = 1;
      renderTabs();
      renderTable();
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

function getSelectionSummary() {
  const rows = selectedItems();
  const total = rows.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return { rows, total };
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

function updateMobileSubmitBar(total, rows) {
  if (!mobileSubmitAmount) return;
  mobileSubmitAmount.textContent = asMoney(total);
  if (!mobileSubmitCount) return;
  const itemCount = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  mobileSubmitCount.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
}

function updateTotal() {
  const summary = getSelectionSummary();
  const total = summary.total;
  totalPreview.value = `Estimated total: ${asMoney(total)}`;
  updateMobileSubmitBar(total, summary.rows);
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
                <td><input type="number" min="0" step="1" value="${row.quantity}" data-summary-game-id="${row.gameId}" style="width: 88px" /></td>
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
      const qNum = Math.max(0, Math.floor(Number(el.value || 0)));
      qtyMap.set(gameId, qNum);
      renderTable();
      updateTotal();
      renderSelectedItems();
    });
  });
}

function renderHomePagination(totalRows, visibleRows, startIndex, totalPages) {
  if (!homePaginationWrap) return;
  homePaginationWrap.innerHTML = '';
  if (totalRows <= 0) return;

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'secondary';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = homeTableState.page <= 1;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = homeTableState.page >= totalPages;

  const pageInfo = document.createElement('span');
  pageInfo.className = 'muted';
  pageInfo.textContent = `Page ${homeTableState.page} of ${totalPages}`;

  const rangeInfo = document.createElement('span');
  rangeInfo.className = 'muted';
  const start = startIndex + 1;
  const end = startIndex + visibleRows.length;
  rangeInfo.textContent = `Showing ${start}\u2013${end} of ${totalRows}`;

  prevBtn.addEventListener('click', () => {
    homeTableState.page = Math.max(1, homeTableState.page - 1);
    renderTable();
  });
  nextBtn.addEventListener('click', () => {
    homeTableState.page = Math.min(totalPages, homeTableState.page + 1);
    renderTable();
  });

  homePaginationWrap.append(prevBtn, nextBtn, pageInfo, rangeInfo);
}

function renderTable() {
  if (!activePlatformTab) {
    activePlatformTab = isMobilePlatformUi ? ALL_PLATFORMS_VALUE : platformTabs[0] || '';
    renderTabs();
  }

  if (!activePlatformTab) {
    tableMeta.textContent = 'Buylist';
    if (homePaginationWrap) homePaginationWrap.innerHTML = '';
    buylistWrap.innerHTML = '<p class="muted">No console tabs are configured.</p>';
    return;
  }

  const q = searchInput.value.trim().toLowerCase();
  const selectedPlatformLabel = activePlatformTab === ALL_PLATFORMS_VALUE ? 'All Platforms' : activePlatformTab;
  const filtered = games.filter((g) => {
    if (!matchesPlatformTab(g, activePlatformTab)) return false;
    return `${g.title} ${g.platform || ''}`.toLowerCase().includes(q);
  });

  const pageSize = normalizeHomeRowsPerPage(homeTableState.pageSize);
  homeTableState.pageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  homeTableState.page = Math.min(Math.max(1, homeTableState.page), totalPages);
  const startIndex = filtered.length > 0 ? (homeTableState.page - 1) * pageSize : 0;
  const visibleRows = filtered.slice(startIndex, startIndex + pageSize);
  syncHomeRowsPerPageControl();

  if (filtered.length === 0) {
    tableMeta.textContent = `${selectedPlatformLabel} Buylist \u2022 Showing 0 of 0`;
    renderHomePagination(0, [], 0, 1);
    buylistWrap.innerHTML = `<p class="muted">No matching games found for ${escapeHtml(selectedPlatformLabel)}.</p>`;
    return;
  }

  tableMeta.textContent = `${selectedPlatformLabel} Buylist \u2022 Showing ${startIndex + 1}\u2013${
    startIndex + visibleRows.length
  } of ${filtered.length}`;
  renderHomePagination(filtered.length, visibleRows, startIndex, totalPages);

  buylistWrap.innerHTML = `
    <table class="sheet-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Condition</th>
          <th>You Get Paid</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        ${visibleRows
          .map((g) => {
            const deltaMeta = priceDeltaMeta(g);
            const rowClass = deltaMeta.className ? `delta-${deltaMeta.className}` : '';
            return `
          <tr class="${rowClass}">
            <td class="game-title-cell" title="${escapeHtml(g.title)}">${renderTitleWithDelta(g, deltaMeta)}</td>
            <td>CIB</td>
            <td>${renderPriceWithDelta(g, deltaMeta)}</td>
            <td>
              <input
                type="number"
                min="0"
                step="1"
                value="${qtyMap.get(g.id) || 0}"
                data-game-id="${g.id}"
                style="width: 88px"
              />
            </td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  buylistWrap.querySelectorAll('input[data-game-id]').forEach((el) => {
    el.addEventListener('input', () => {
      const gameId = Number(el.getAttribute('data-game-id'));
      const qNum = Math.max(0, Math.floor(Number(el.value || 0)));
      qtyMap.set(gameId, qNum);
      updateTotal();
      renderSelectedItems();
    });
  });

  updateTotal();
  renderSelectedItems();
}

async function loadGames() {
  renderTabs();
  try {
    const r = await fetch(`/api/games?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Games fetch failed (${r.status})`);
    const nextGames = await r.json();
    // Server is source of truth so admin price edits reflect immediately on homepage.
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

searchInput.addEventListener('input', () => {
  homeTableState.page = 1;
  renderTable();
});
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  homeTableState.page = 1;
  renderTable();
});

if (homeRowsPerPageInput) {
  syncHomeRowsPerPageControl();
  homeRowsPerPageInput.addEventListener('change', () => {
    const nextPageSize = normalizeHomeRowsPerPage(homeRowsPerPageInput.value);
    homeTableState.pageSize = nextPageSize;
    homeTableState.page = 1;
    saveHomeRowsPerPagePreference(nextPageSize);
    syncHomeRowsPerPageControl();
    renderTable();
  });
}

if (comfortModeInput) {
  comfortModeInput.addEventListener('change', () => {
    const enabled = comfortModeInput.value === 'on';
    applyComfortMode(enabled);
    saveComfortModePreference(enabled);
  });
}

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

  const r = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await r.json();

  if (!r.ok) {
    renderMessage(body.error || 'Could not submit. Try again.', 'error');
    return;
  }

  renderShipment(body.shipment, payload);
  form.reset();
  qtyMap.clear();
  renderTable();
  renderSelectedItems();
  renderMessage(`Shipment ${body.shipment.id} submitted. Print and include the packing slip in your box.`);
});

setupMobileTitlePreview();
applyComfortMode(loadComfortModePreference());
syncHomeRowsPerPageControl();

loadGames().catch(() => {
  renderTabs();
  renderSelectedItems();
  buylistWrap.innerHTML = '<p class="notice error">Could not load the buylist.</p>';
});

loadFaqs().catch(() => {
  if (faqListWrap) faqListWrap.innerHTML = '<p class="muted">Could not load FAQs right now.</p>';
});

window.addEventListener('storage', (e) => {
  if (e.key === PUBLIC_COMFORT_MODE_STORAGE_KEY) {
    applyComfortMode(loadComfortModePreference());
  }
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
    loadGames().catch(() => {});
    loadFaqs().catch(() => {});
  }
});

function handleMobilePlatformModeChange() {
  const nextMode = mobilePlatformMedia.matches;
  if (nextMode === isMobilePlatformUi) return;
  isMobilePlatformUi = nextMode;
  homeTableState.page = 1;
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
  loadGames().catch(() => {});
  loadFaqs().catch(() => {});
}, AUTO_REFRESH_MS);
