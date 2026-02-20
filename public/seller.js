const buylistWrap = document.getElementById('buylistTableWrap');
const platformTabsWrap = document.getElementById('platformTabs');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clearSearch');
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

let games = [];
const qtyMap = new Map();
const platformTabs = ['Wii', 'PS3', 'PS2', 'OG Xbox', 'Xbox 360', 'Wii U', '3DS', 'DS'];
let activePlatformTab = platformTabs[0] || '';
let gamesSignature = '';
let localSnapshotUpdatedAt = 0;
let hasSubmittedShipment = false;
let mobileSubmitToastTimer = 0;

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

function computeGamesSignature(items) {
  return items.map((g) => `${g.id}|${g.title}|${g.platform || ''}|${g.price}|${g.active ? 1 : 0}`).join('~');
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

function matchesPlatformTab(game, tab) {
  if (!tab) return false;

  const platform = String(game.platform || '').toLowerCase();
  if (tab === 'Wii U') return platform.includes('wii u');
  if (tab === 'Wii') return platform.includes('wii') && !platform.includes('wii u');
  if (tab === 'PS3') return platform.includes('ps3') || platform.includes('playstation 3');
  if (tab === 'PS2') return platform.includes('ps2') || platform.includes('playstation 2');
  if (tab === 'OG Xbox') {
    return platform === 'xbox' || platform.includes('og xbox') || platform.includes('original xbox');
  }
  if (tab === 'Xbox 360') return platform.includes('xbox 360') || platform.includes('360');
  if (tab === '3DS') return platform.includes('3ds');
  if (tab === 'DS') return platform.includes('ds') && !platform.includes('3ds');
  return false;
}

function getGamesForPlatform(tab) {
  return games.filter((g) => matchesPlatformTab(g, tab));
}

function renderTabs() {
  const countsByTab = new Map(platformTabs.map((tab) => [tab, getGamesForPlatform(tab).length]));
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
    activePlatformTab = platformTabs[0];
    renderTabs();
  }

  if (!activePlatformTab) {
    tableMeta.textContent = 'Buylist';
    buylistWrap.innerHTML = '<p class="muted">No console tabs are configured.</p>';
    return;
  }

  const platformRows = getGamesForPlatform(activePlatformTab);
  const filtered = getFilteredGames();
  tableMeta.textContent = `Showing ${filtered.length} of ${platformRows.length} in ${activePlatformTab}`;

  if (filtered.length === 0) {
    buylistWrap.innerHTML = `<p class="muted">No matching games found for ${escapeHtml(activePlatformTab)}.</p>`;
    syncTableViewportHeight();
    updateTotal();
    renderSelectedItems();
    return;
  }

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
        ${filtered
          .map(
            (g) => `
          <tr>
            <td class="game-title-cell" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</td>
            <td>CIB</td>
            <td>${asMoney(g.price)}</td>
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
          </tr>`
          )
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

  const snapshot = loadSnapshotFromStorage();
  if (snapshot) {
    const ts = Number(snapshot.updatedAt || 0);
    if (ts > localSnapshotUpdatedAt) {
      localSnapshotUpdatedAt = ts;
      applyGames(snapshot.games);
    }
  }

  const r = await fetch(`/api/games?t=${Date.now()}`, { cache: 'no-store' });
  const nextGames = await r.json();
  if (shouldPreferSnapshot(snapshot, nextGames)) return;
  applyGames(nextGames);
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
  hasSubmittedShipment = true;
  form.reset();
  qtyMap.clear();
  renderTable();
  renderSelectedItems();
  renderMessage(`Shipment ${body.shipment.id} submitted. Print and include the packing slip in your box.`);
});

initConditionStandardsAccordion();
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

setInterval(() => {
  Promise.all([loadGames(), loadFaqs()]).catch(() => {});
}, AUTO_REFRESH_MS);
