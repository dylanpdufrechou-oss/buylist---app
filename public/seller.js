const sellerSearchInput = document.getElementById('sellerSearchInput');
const sellerSearchSubmit = document.getElementById('sellerSearchSubmit');
const sellerSearchClear = document.getElementById('sellerSearchClear');
const sellerScanButton = document.getElementById('sellerScanButton');
const sellerPlatformFilter = document.getElementById('sellerPlatformFilter');
const sellerResultsMeta = document.getElementById('sellerResultsMeta');
const sellerResultsList = document.getElementById('sellerResultsList');
const sellerEmptyState = document.getElementById('sellerEmptyState');
const selectedItemsWrap = document.getElementById('selectedItemsWrap');
const sellerShipmentTotal = document.getElementById('sellerShipmentTotal');
const shipmentSection = document.getElementById('shipmentSection');
const form = document.getElementById('submissionForm');
const msg = document.getElementById('message');
const totalPreview = document.getElementById('totalPreview');
const shipmentPreview = document.getElementById('shipmentPreview');
const sellerFaqList = document.getElementById('sellerFaqList');
const mobileCartBar = document.getElementById('mobileCartBar');
const mobileCartCount = document.getElementById('mobileCartCount');
const mobileCartTotal = document.getElementById('mobileCartTotal');
const mobileCartViewShipment = document.getElementById('mobileCartViewShipment');

const PACKING_SLIP_SESSION_KEY = 'ibgPackingSlipPayload';
const PACKING_SLIP_LOCAL_KEY = 'ibgPackingSlipPayloadBackup';
const PACKING_SLIP_PATH = '/packing-slip.html';
const MOBILE_QUERY = '(max-width: 640px)';
const mobileMedia = window.matchMedia(MOBILE_QUERY);

let games = [];
let qtyMap = new Map();
let hasSubmittedShipment = false;
let scannerState = null;
let searchState = {
  query: '',
  upc: '',
  platform: 'all',
};

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function asMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function normalizeUpc(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || '';
}

function renderMessage(text, type = 'ok') {
  if (!msg) return;
  msg.innerHTML = text ? `<div class="notice ${type}">${escapeHtml(text)}</div>` : '';
}

function supportsBarcodeScanning() {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function getPlatformOptions() {
  return Array.from(new Set(games.map((game) => String(game.platform || '').trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function syncPlatformFilter() {
  if (!sellerPlatformFilter) return;
  const options = getPlatformOptions();
  const current = searchState.platform;
  sellerPlatformFilter.innerHTML = [
    '<option value="all">All systems</option>',
    ...options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`),
  ].join('');
  sellerPlatformFilter.value = options.includes(current) ? current : 'all';
  searchState.platform = sellerPlatformFilter.value;
}

function updateUrlFromState() {
  const params = new URLSearchParams();
  const query = String(searchState.query || '').trim();
  const upc = String(searchState.upc || '').trim();
  if (query) params.set('q', query);
  if (upc) params.set('upc', upc);
  if (searchState.platform && searchState.platform !== 'all') params.set('platform', searchState.platform);
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
  window.history.replaceState({}, '', next);
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  searchState.query = String(params.get('q') || '').trim();
  searchState.upc = normalizeUpc(params.get('upc') || '');
  searchState.platform = String(params.get('platform') || 'all').trim() || 'all';
  if (sellerSearchInput) sellerSearchInput.value = searchState.query || searchState.upc;
}

function getVisibleResults() {
  const query = String(searchState.query || '').trim().toLowerCase();
  const upc = normalizeUpc(searchState.upc);
  const selectedPlatform = String(searchState.platform || 'all').trim();
  let rows = games.slice();

  if (selectedPlatform !== 'all') {
    rows = rows.filter((game) => String(game.platform || '').trim() === selectedPlatform);
  }

  if (upc) {
    const exact = rows.filter((game) => normalizeUpc(game.upc) === upc);
    if (exact.length) return exact;
    return rows.filter((game) => normalizeUpc(game.upc).includes(upc));
  }

  if (query) {
    return rows.filter((game) => String(game.title || '').toLowerCase().includes(query));
  }

  if (selectedPlatform !== 'all') {
    return rows;
  }

  return [];
}

function getSelectionRows() {
  const byId = new Map(games.map((game) => [Number(game.id), game]));
  return Array.from(qtyMap.entries())
    .map(([id, quantity]) => {
      const game = byId.get(Number(id));
      if (!game) return null;
      const qty = Math.max(0, Number.parseInt(quantity, 10) || 0);
      if (!qty) return null;
      return {
        gameId: Number(id),
        title: game.title,
        platform: game.platform,
        price: Number(game.price || 0),
        quantity: qty,
        lineTotal: qty * Number(game.price || 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function getSelectionSummary() {
  const rows = getSelectionRows();
  return {
    rows,
    itemCount: rows.reduce((sum, row) => sum + row.quantity, 0),
    total: rows.reduce((sum, row) => sum + row.lineTotal, 0),
  };
}

function updateCartUi() {
  const summary = getSelectionSummary();
  if (sellerShipmentTotal) sellerShipmentTotal.textContent = `Estimated Total: ${asMoney(summary.total)}`;
  if (totalPreview) totalPreview.value = `Estimated total: ${asMoney(summary.total)}`;
  if (mobileCartCount) mobileCartCount.textContent = `${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'}`;
  if (mobileCartTotal) mobileCartTotal.textContent = asMoney(summary.total);
  if (mobileCartBar) mobileCartBar.classList.toggle('is-hidden', summary.itemCount <= 0);
  if (shipmentSection) shipmentSection.classList.toggle('is-hidden', summary.itemCount <= 0 && !hasSubmittedShipment);
}

function clearCompletedShipmentState() {
  if (!hasSubmittedShipment) return;
  hasSubmittedShipment = false;
  shipmentPreview.innerHTML = '';
  renderMessage('');
}

function setQty(gameId, qty) {
  clearCompletedShipmentState();
  const nextQty = Math.max(0, Math.floor(Number(qty || 0)));
  if (nextQty <= 0) qtyMap.delete(Number(gameId));
  else qtyMap.set(Number(gameId), nextQty);
  renderResults();
  renderSelectedItems();
  updateCartUi();
}

function adjustQty(gameId, delta) {
  const current = Number(qtyMap.get(Number(gameId)) || 0);
  setQty(gameId, current + Number(delta || 0));
}

function renderSelectedItems() {
  const summary = getSelectionSummary();
  if (!selectedItemsWrap) return;
  if (!summary.rows.length) {
    selectedItemsWrap.innerHTML = '<p class="muted">No games added yet.</p>';
    return;
  }
  selectedItemsWrap.innerHTML = `
    <div class="shipment-items-list">
      ${summary.rows
        .map(
          (row) => `
            <div class="shipment-item-row">
              <div>
                <strong>${escapeHtml(row.title)}</strong>
                <span class="muted">${escapeHtml(row.platform || 'Unknown')} • ${asMoney(row.price)} each</span>
              </div>
              <div class="shipment-item-actions">
                <input type="number" min="0" step="1" value="${row.quantity}" data-shipment-qty="${row.gameId}" />
                <strong>${asMoney(row.lineTotal)}</strong>
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;

  selectedItemsWrap.querySelectorAll('[data-shipment-qty]').forEach((input) => {
    input.addEventListener('input', () => {
      const gameId = Number(input.getAttribute('data-shipment-qty'));
      setQty(gameId, input.value);
    });
  });
}

function getPromptState(results) {
  const hasQuery = Boolean(String(searchState.query || '').trim() || String(searchState.upc || '').trim());
  const browsingPlatform = searchState.platform !== 'all';
  if (!hasQuery && !browsingPlatform) {
    return {
      title: 'Search for a title to begin',
      body: 'Use the search bar above or choose a system filter to browse available titles.',
      showRequest: false,
    };
  }
  if (!results.length) {
    return {
      title: 'No matching titles found',
      body: 'Try another search, scan a barcode, or send us a title request.',
      showRequest: true,
    };
  }
  return null;
}

function renderResults() {
  const results = getVisibleResults();
  const isMobile = mobileMedia.matches;
  const prompt = getPromptState(results);

  if (sellerResultsMeta) {
    if (prompt && prompt.title === 'Search for a title to begin') {
      sellerResultsMeta.textContent = 'Search for a title to begin';
    } else {
      sellerResultsMeta.textContent = `Showing ${results.length} result${results.length === 1 ? '' : 's'}`;
    }
  }

  if (sellerEmptyState) {
    if (prompt) {
      sellerEmptyState.classList.remove('is-hidden');
      sellerEmptyState.innerHTML = `
        <h3>${escapeHtml(prompt.title)}</h3>
        <p>${escapeHtml(prompt.body)}</p>
        ${prompt.showRequest ? '<button id="sellerRequestTitleBtn" type="button" class="secondary">Request title</button>' : ''}
      `;
      const requestBtn = document.getElementById('sellerRequestTitleBtn');
      if (requestBtn) {
        requestBtn.addEventListener('click', () =>
          openRequestTitleModal({ title: searchState.query, upc: searchState.upc })
        );
      }
    } else {
      sellerEmptyState.classList.add('is-hidden');
      sellerEmptyState.innerHTML = '';
    }
  }

  if (!sellerResultsList) return;
  if (prompt) {
    sellerResultsList.innerHTML = '';
    return;
  }

  sellerResultsList.innerHTML = results
    .map((game) => {
      const qty = Number(qtyMap.get(Number(game.id)) || 0);
      return `
        <article class="result-item ${isMobile ? 'is-mobile' : 'is-desktop'}" data-game-id="${Number(game.id)}">
          <div class="result-core-grid">
            <div class="result-title-block">
              <strong class="result-title">${escapeHtml(game.title)}</strong>
              <span class="result-system">${escapeHtml(game.platform || 'Unknown System')}</span>
            </div>
            <div class="result-condition-block">
              <label>Condition</label>
              <select data-condition="${Number(game.id)}" disabled>
                <option>${escapeHtml(game.condition_note || 'CIB')}</option>
              </select>
            </div>
            <div class="result-price-block">
              <label>You get paid</label>
              <strong>${asMoney(game.price)}</strong>
            </div>
            <div class="result-qty-block">
              <label>Qty</label>
              <div class="qty-stepper">
                <button type="button" data-stepper-minus="${Number(game.id)}" aria-label="Decrease quantity">-</button>
                <input type="number" min="0" step="1" value="${qty}" data-qty-input="${Number(game.id)}" />
                <button type="button" data-stepper-plus="${Number(game.id)}" aria-label="Increase quantity">+</button>
              </div>
            </div>
            <div class="result-add-block">
              <button type="button" data-add-game="${Number(game.id)}">Add</button>
            </div>
          </div>
          <details class="result-details">
            <summary>Details</summary>
            <div class="result-details-body">
              <p><strong>UPC:</strong> ${escapeHtml(game.upc || 'Not listed')}</p>
              <p><strong>Notes:</strong> ${escapeHtml(game.notes || 'No extra notes.')}</p>
            </div>
          </details>
        </article>
      `;
    })
    .join('');

  sellerResultsList.querySelectorAll('[data-stepper-minus]').forEach((button) => {
    button.addEventListener('click', () => adjustQty(button.getAttribute('data-stepper-minus'), -1));
  });
  sellerResultsList.querySelectorAll('[data-stepper-plus]').forEach((button) => {
    button.addEventListener('click', () => adjustQty(button.getAttribute('data-stepper-plus'), 1));
  });
  sellerResultsList.querySelectorAll('[data-qty-input]').forEach((input) => {
    input.addEventListener('input', () => setQty(input.getAttribute('data-qty-input'), input.value));
  });
  sellerResultsList.querySelectorAll('[data-add-game]').forEach((button) => {
    button.addEventListener('click', () => adjustQty(button.getAttribute('data-add-game'), 1));
  });
}

function buildPackingSlipPrintPayload(shipment, seller) {
  const items = (Array.isArray(shipment?.items) ? shipment.items : [])
    .map((item) => ({
      title: String(item?.title || '').trim() || 'Untitled Game',
      quantity: Math.max(0, Number.parseInt(item?.quantity, 10) || 0),
    }))
    .filter((item) => item.quantity > 0);
  return {
    shipmentId: String(shipment?.id || '').trim() || '-',
    submissionId: String(shipment?.submissionId || '').trim() || '-',
    createdAt: shipment?.createdAt || new Date().toISOString(),
    sellerName: String(seller?.customerName || '').trim() || '-',
    sellerEmail: String(seller?.email || '').trim() || '-',
    sellerPhone: String(seller?.phone || '').trim() || '-',
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    itemCount: items.length,
    items,
    returnTo: `${window.location.pathname || '/seller.html'}${window.location.search || ''}`,
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

function renderShipmentPreview(shipment, seller) {
  if (!shipmentPreview) return;
  if (!shipment) {
    shipmentPreview.innerHTML = '';
    return;
  }
  shipmentPreview.innerHTML = `
    <article class="packing-slip-preview card">
      <h3>Packing Slip (Required): ${escapeHtml(shipment.id)}</h3>
      <p class="muted">Submission #${escapeHtml(shipment.submissionId)} • ${escapeHtml(
        new Date(shipment.createdAt).toLocaleString()
      )}</p>
      <p><strong>Seller:</strong> ${escapeHtml(seller.customerName || '-')}</p>
      <p><strong>Total Offer:</strong> ${asMoney(shipment.total)}</p>
      <button id="printShipment" class="secondary" type="button">Print Packing Slip</button>
    </article>
  `;
  document.getElementById('printShipment')?.addEventListener('click', () => printPackingSlip(shipment, seller));
}

async function loadFaqs() {
  if (!sellerFaqList) return;
  try {
    const response = await fetch(`/api/faqs?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('FAQ request failed');
    const rows = await response.json();
    sellerFaqList.innerHTML = (Array.isArray(rows) ? rows : [])
      .map(
        (row) => `
          <details>
            <summary>${escapeHtml(row.question)}</summary>
            <p>${escapeHtml(row.answer)}</p>
          </details>
        `
      )
      .join('');
  } catch {
    sellerFaqList.innerHTML = '<p class="muted">Could not load FAQs right now.</p>';
  }
}

function closeOverlay(id) {
  document.getElementById(id)?.remove();
}

function openRequestTitleModal(prefill = {}) {
  closeOverlay('requestTitleOverlay');
  const overlay = document.createElement('div');
  overlay.id = 'requestTitleOverlay';
  overlay.className = 'ui-overlay';
  overlay.innerHTML = `
    <div class="ui-modal-card request-title-modal">
      <div class="ui-modal-head">
        <h3>Request Title</h3>
        <button type="button" id="closeRequestTitle">Close</button>
      </div>
      <p class="muted">If your title is missing, send the details here and we can review it.</p>
      <form id="requestTitleForm" class="grid">
        <input id="requestTitleInput" placeholder="Game title" value="${escapeHtml(prefill.title || '')}" />
        <input id="requestUpcInput" placeholder="UPC / Barcode" value="${escapeHtml(prefill.upc || '')}" />
        <input id="requestEmailInput" type="email" placeholder="Email (optional)" value="${escapeHtml(prefill.email || '')}" />
        <button type="submit">Send Request</button>
      </form>
      <div id="requestTitleMessage"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('closeRequestTitle')?.addEventListener('click', () => closeOverlay('requestTitleOverlay'));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay('requestTitleOverlay');
  });
  document.getElementById('requestTitleForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = String(document.getElementById('requestTitleInput')?.value || '').trim();
    const upc = String(document.getElementById('requestUpcInput')?.value || '').trim();
    const email = String(document.getElementById('requestEmailInput')?.value || '').trim();
    const message = document.getElementById('requestTitleMessage');
    if (!title && !upc) {
      if (message) message.innerHTML = '<div class="notice error">Enter a title or UPC.</div>';
      return;
    }
    try {
      const response = await fetch('/api/title-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, upc, email, source: 'public_search' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Could not send request.');
      if (message) message.innerHTML = '<div class="notice ok">Thanks. We received your request.</div>';
    } catch (error) {
      if (message) message.innerHTML = `<div class="notice error">${escapeHtml(error.message || 'Could not send request.')}</div>`;
    }
  });
}

async function stopScanner() {
  if (!scannerState) return;
  scannerState.active = false;
  if (scannerState.rafId) cancelAnimationFrame(scannerState.rafId);
  if (scannerState.stream) scannerState.stream.getTracks().forEach((track) => track.stop());
  scannerState = null;
}

async function openScanner() {
  if (!supportsBarcodeScanning()) {
    renderMessage('Camera barcode scanning is available on supported mobile browsers. You can still search by title.', 'warn');
    return;
  }

  closeOverlay('scannerOverlay');
  const overlay = document.createElement('div');
  overlay.id = 'scannerOverlay';
  overlay.className = 'ui-overlay';
  overlay.innerHTML = `
    <div class="ui-modal-card scanner-modal">
      <div class="ui-modal-head">
        <h3>Scan Barcode</h3>
        <button type="button" id="closeScannerOverlay">Close</button>
      </div>
      <p class="muted">Point your camera at the barcode. We will search automatically.</p>
      <video id="scannerVideo" autoplay playsinline muted></video>
      <div id="scannerMessage" class="muted">Waiting for barcode...</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const video = document.getElementById('scannerVideo');
  const message = document.getElementById('scannerMessage');
  document.getElementById('closeScannerOverlay')?.addEventListener('click', async () => {
    await stopScanner();
    closeOverlay('scannerOverlay');
  });
  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay) {
      await stopScanner();
      closeOverlay('scannerOverlay');
    }
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    const detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8'] });
    scannerState = { active: true, stream, rafId: 0 };

    const scanFrame = async () => {
      if (!scannerState?.active) return;
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((entry) => String(entry.rawValue || '').trim());
        if (hit) {
          const raw = String(hit.rawValue || '').trim();
          if (message) message.textContent = 'Barcode found. Searching...';
          await stopScanner();
          closeOverlay('scannerOverlay');
          searchState.upc = normalizeUpc(raw);
          searchState.query = raw;
          if (sellerSearchInput) sellerSearchInput.value = raw;
          updateUrlFromState();
          renderResults();
          renderSelectedItems();
          updateCartUi();
          return;
        }
      } catch {
        if (message) message.textContent = 'Trying again...';
      }
      if (scannerState?.active) scannerState.rafId = requestAnimationFrame(scanFrame);
    };

    scannerState.rafId = requestAnimationFrame(scanFrame);
  } catch {
    if (message) {
      message.textContent = 'Camera barcode scanning is available on supported mobile browsers. You can still search by title.';
    }
  }
}

async function loadGames() {
  const response = await fetch(`/api/games?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load games');
  const rows = await response.json();
  games = Array.isArray(rows) ? rows : [];
  syncPlatformFilter();
  renderResults();
  renderSelectedItems();
  updateCartUi();
}

if (sellerSearchInput) {
  sellerSearchInput.addEventListener('input', () => {
    const next = String(sellerSearchInput.value || '').trim();
    const digitsOnly = normalizeUpc(next);
    searchState.query = next;
    searchState.upc = digitsOnly.length >= 8 && digitsOnly === next.replace(/\s+/g, '') ? digitsOnly : '';
    updateUrlFromState();
    renderResults();
  });
  sellerSearchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    searchState.query = String(sellerSearchInput.value || '').trim();
    searchState.upc = normalizeUpc(searchState.query);
    updateUrlFromState();
    renderResults();
  });
}

if (sellerSearchSubmit) {
  sellerSearchSubmit.addEventListener('click', () => {
    searchState.query = String(sellerSearchInput?.value || '').trim();
    searchState.upc = normalizeUpc(searchState.query);
    updateUrlFromState();
    renderResults();
  });
}

if (sellerSearchClear) {
  sellerSearchClear.addEventListener('click', () => {
    searchState.query = '';
    searchState.upc = '';
    if (sellerSearchInput) sellerSearchInput.value = '';
    updateUrlFromState();
    renderResults();
  });
}

if (sellerPlatformFilter) {
  sellerPlatformFilter.addEventListener('change', () => {
    searchState.platform = sellerPlatformFilter.value || 'all';
    updateUrlFromState();
    renderResults();
  });
}

if (sellerScanButton) {
  sellerScanButton.addEventListener('click', () => openScanner());
}

if (mobileCartViewShipment) {
  mobileCartViewShipment.addEventListener('click', () => {
    if (shipmentSection) shipmentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    renderMessage('');
    const items = getSelectionRows();
    if (!items.length) {
      renderMessage('Select at least one game with quantity above 0.', 'error');
      return;
    }

    const payload = {
      customerName: document.getElementById('customerName').value,
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
      notes: document.getElementById('notes').value,
      items: items.map((item) => ({ gameId: item.gameId, quantity: item.quantity })),
    };

    try {
      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      if (!response.ok) {
        renderMessage(body.error || text || 'Could not submit. Try again.', 'error');
        return;
      }
      renderShipmentPreview(body.shipment, payload);
      hasSubmittedShipment = true;
      form.reset();
      qtyMap.clear();
      renderResults();
      renderSelectedItems();
      updateCartUi();
      renderMessage(`Shipment ${body.shipment.id} submitted. Print and include the packing slip in your box.`);
    } catch {
      renderMessage('Could not submit right now. Check your connection and try again.', 'error');
    }
  });
}

window.addEventListener('resize', () => renderResults());

readStateFromUrl();
loadGames().catch(() => {
  renderMessage('Could not load the buylist right now.', 'error');
});
loadFaqs();
updateCartUi();
renderSelectedItems();
