const buylistWrap = document.getElementById('buylistTableWrap');
const platformTabsWrap = document.getElementById('platformTabs');
const searchInput = document.getElementById('search');
const clearSearchBtn = document.getElementById('clearSearch');
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
  const direction = String(game?.price_change_direction || '').toLowerCase();
  const baselineVersion = String(game?.comparison_baseline_version || '').trim();
  const previousCents = Number(game?.previous_price_cents);
  const hasPrevious = Number.isFinite(previousCents);
  const baselineSuffix = baselineVersion ? ` in ${baselineVersion}` : '';

  if (direction === 'up') {
    return {
      className: 'up',
      extra: '<span class="price-delta-arrow">▲</span>',
      tooltip: hasPrevious ? `Was ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
    };
  }
  if (direction === 'down') {
    return {
      className: 'down',
      extra: '<span class="price-delta-arrow">▼</span>',
      tooltip: hasPrevious ? `Was ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
    };
  }
  if (direction === 'new') {
    return {
      className: 'new',
      extra: '<span class="price-delta-tag">New</span>',
      tooltip: baselineVersion ? `New this version (vs ${baselineVersion})` : 'New this version',
    };
  }

  return {
    className: '',
    extra: '',
    tooltip: hasPrevious && baselineVersion ? `Same as ${asMoney(previousCents / 100)}${baselineSuffix}` : '',
  };
}

function renderPriceWithDelta(game) {
  const meta = priceDeltaMeta(game);
  const titleAttr = meta.tooltip ? ` title="${escapeHtml(meta.tooltip)}"` : '';
  const className = meta.className ? `price-cell-value ${meta.className}` : 'price-cell-value';
  return `<span class="${className}"${titleAttr}>${asMoney(game.price)}${meta.extra}</span>`;
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

function renderTable() {
  if (!activePlatformTab) {
    activePlatformTab = isMobilePlatformUi ? ALL_PLATFORMS_VALUE : platformTabs[0] || '';
    renderTabs();
  }

  const q = searchInput.value.trim().toLowerCase();
  const selectedPlatformLabel = activePlatformTab === ALL_PLATFORMS_VALUE ? 'All Platforms' : activePlatformTab;
  const filtered = games.filter((g) => {
    if (!matchesPlatformTab(g, activePlatformTab)) return false;
    return `${g.title} ${g.platform || ''}`.toLowerCase().includes(q);
  });
  tableMeta.textContent = `${selectedPlatformLabel} Buylist`;

  if (filtered.length === 0) {
    buylistWrap.innerHTML = `<p class="muted">No matching games found for ${escapeHtml(selectedPlatformLabel)}.</p>`;
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
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map(
            (g) => `
          <tr>
            <td>${escapeHtml(g.title)}</td>
            <td>CIB</td>
            <td>${renderPriceWithDelta(g)}</td>
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
          </tr>`
          )
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

searchInput.addEventListener('input', renderTable);
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  renderTable();
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
  form.reset();
  qtyMap.clear();
  renderTable();
  renderSelectedItems();
  renderMessage(`Shipment ${body.shipment.id} submitted. Print and include the packing slip in your box.`);
});

loadGames().catch(() => {
  renderTabs();
  renderSelectedItems();
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
    loadGames().catch(() => {});
    loadFaqs().catch(() => {});
  }
});

function handleMobilePlatformModeChange() {
  const nextMode = mobilePlatformMedia.matches;
  if (nextMode === isMobilePlatformUi) return;
  isMobilePlatformUi = nextMode;
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
