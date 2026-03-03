const homeSearchInput = document.getElementById('homeSearchInput');
const homeSearchSubmit = document.getElementById('homeSearchSubmit');
const homeSearchClear = document.getElementById('homeSearchClear');
const homeSearchSuggestions = document.getElementById('homeSearchSuggestions');
const homeScanButton = document.getElementById('homeScanButton');
const homeFaqList = document.getElementById('homeFaqList');
const homepagePaidOutValue = document.getElementById('homepagePaidOutValue');

let suggestionRows = [];
let activeSuggestionIndex = -1;
let suggestTimer = 0;
let scannerState = null;

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function debounceSuggest() {
  clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(loadSuggestions, 240);
}

function hideSuggestions() {
  suggestionRows = [];
  activeSuggestionIndex = -1;
  if (homeSearchSuggestions) {
    homeSearchSuggestions.innerHTML = '';
    homeSearchSuggestions.classList.add('is-hidden');
  }
}

function navigateToSeller({ q = '', upc = '' } = {}) {
  const params = new URLSearchParams();
  const query = String(q || '').trim();
  const upcValue = String(upc || '').trim();
  if (upcValue) params.set('upc', upcValue);
  if (query) params.set('q', query);
  const suffix = params.toString();
  window.location.assign(`/seller.html${suffix ? `?${suffix}` : ''}`);
}

function renderSuggestions(items, rawQuery) {
  if (!homeSearchSuggestions) return;
  const query = String(rawQuery || '').trim();
  if (!query) {
    hideSuggestions();
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    suggestionRows = [];
    activeSuggestionIndex = -1;
    homeSearchSuggestions.innerHTML = `
      <div class="suggestion-empty-row">
        <p>No matches found.</p>
        <button type="button" id="homeRequestTitleBtn" class="secondary small">Request title</button>
      </div>
    `;
    homeSearchSuggestions.classList.remove('is-hidden');
    const requestBtn = document.getElementById('homeRequestTitleBtn');
    if (requestBtn) {
      requestBtn.addEventListener('click', () => openRequestTitleModal({ title: query }));
    }
    return;
  }

  suggestionRows = items.slice();
  activeSuggestionIndex = -1;
  homeSearchSuggestions.innerHTML = `
    <div class="suggestion-list">
      ${items
        .map(
          (item, index) => `
            <button type="button" class="suggestion-row" data-suggestion-index="${index}">
              <span class="suggestion-main-text">${escapeHtml(item.title)}</span>
              <span class="suggestion-meta-row">
                <span class="suggestion-platform">${escapeHtml(item.platform || 'Unknown')}</span>
                ${item.is_hot ? '<span class="suggestion-hot">Hot</span>' : ''}
              </span>
            </button>
          `
        )
        .join('')}
    </div>
    <button type="button" id="viewAllResultsBtn" class="suggestion-view-all">View All Results</button>
  `;
  homeSearchSuggestions.classList.remove('is-hidden');

  homeSearchSuggestions.querySelectorAll('[data-suggestion-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.getAttribute('data-suggestion-index'));
      const match = suggestionRows[index];
      if (!match) return;
      navigateToSeller({ q: match.title });
    });
  });

  const viewAllResultsBtn = document.getElementById('viewAllResultsBtn');
  if (viewAllResultsBtn) {
    viewAllResultsBtn.addEventListener('click', () => navigateToSeller({ q: query }));
  }
}

async function loadSuggestions() {
  const query = String(homeSearchInput?.value || '').trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  try {
    const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}&limit=8`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Suggestion request failed');
    const rows = await response.json();
    renderSuggestions(Array.isArray(rows) ? rows : [], query);
  } catch {
    if (!homeSearchSuggestions) return;
    homeSearchSuggestions.innerHTML = '<div class="suggestion-empty-row"><p>Could not load results right now.</p></div>';
    homeSearchSuggestions.classList.remove('is-hidden');
  }
}

function updateActiveSuggestion(nextIndex) {
  const buttons = Array.from(homeSearchSuggestions?.querySelectorAll('[data-suggestion-index]') || []);
  if (!buttons.length) return;
  activeSuggestionIndex = Math.max(0, Math.min(nextIndex, buttons.length - 1));
  buttons.forEach((button, index) => {
    button.classList.toggle('is-active', index === activeSuggestionIndex);
  });
}

async function loadFaqs() {
  if (!homeFaqList) return;
  try {
    const response = await fetch(`/api/faqs?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('FAQ request failed');
    const rows = await response.json();
    const safeRows = Array.isArray(rows) ? rows : [];
    homeFaqList.innerHTML = safeRows
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
    homeFaqList.innerHTML = '<p class="muted">Could not load FAQs right now.</p>';
  }
}

async function loadPublicSiteConfig() {
  if (!homepagePaidOutValue) return;
  try {
    const response = await fetch('/api/public-site-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Config request failed');
    const payload = await response.json();
    homepagePaidOutValue.textContent = String(payload?.homepagePaidOutText || '$25,000+');
  } catch {
    homepagePaidOutValue.textContent = '$25,000+';
  }
}

function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.remove();
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

function supportsBarcodeScanning() {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
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
    closeOverlay('scannerUnsupportedOverlay');
    const overlay = document.createElement('div');
    overlay.id = 'scannerUnsupportedOverlay';
    overlay.className = 'ui-overlay';
    overlay.innerHTML = `
      <div class="ui-modal-card">
        <div class="ui-modal-head">
          <h3>Barcode Scan</h3>
          <button type="button" id="closeUnsupportedScanner">Close</button>
        </div>
        <p>Camera barcode scanning is available on supported mobile browsers. You can still search by title.</p>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('closeUnsupportedScanner')?.addEventListener('click', () =>
      closeOverlay('scannerUnsupportedOverlay')
    );
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeOverlay('scannerUnsupportedOverlay');
    });
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
        const code = codes.find((item) => String(item.rawValue || '').trim());
        if (code) {
          const rawValue = String(code.rawValue || '').trim();
          if (message) message.textContent = 'Barcode found. Redirecting...';
          await stopScanner();
          closeOverlay('scannerOverlay');
          try {
            const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(rawValue)}&limit=5`, {
              cache: 'no-store',
            });
            if (!response.ok) throw new Error('Search failed');
            const rows = await response.json();
            if (Array.isArray(rows) && rows.length === 0) {
              openRequestTitleModal({ upc: rawValue });
              return;
            }
          } catch {
            // Fall through to seller search page.
          }
          navigateToSeller({ upc: rawValue, q: rawValue });
          return;
        }
      } catch {
        if (message) message.textContent = 'Trying again...';
      }
      if (scannerState?.active) {
        scannerState.rafId = requestAnimationFrame(scanFrame);
      }
    };

    scannerState.rafId = requestAnimationFrame(scanFrame);
  } catch {
    if (message) {
      message.innerHTML = 'Camera barcode scanning is available on supported mobile browsers. You can still search by title.';
    }
  }
}

if (homeSearchInput) {
  homeSearchInput.addEventListener('input', () => {
    if (homeSearchClear) {
      homeSearchClear.classList.toggle('is-visible', homeSearchInput.value.trim().length > 0);
    }
    debounceSuggest();
  });

  homeSearchInput.addEventListener('keydown', (event) => {
    const suggestionButtons = Array.from(homeSearchSuggestions?.querySelectorAll('[data-suggestion-index]') || []);
    if (event.key === 'ArrowDown' && suggestionButtons.length) {
      event.preventDefault();
      updateActiveSuggestion(activeSuggestionIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp' && suggestionButtons.length) {
      event.preventDefault();
      updateActiveSuggestion(activeSuggestionIndex <= 0 ? suggestionButtons.length - 1 : activeSuggestionIndex - 1);
      return;
    }
    if (event.key === 'Escape') {
      hideSuggestions();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeSuggestionIndex >= 0 && suggestionRows[activeSuggestionIndex]) {
        navigateToSeller({ q: suggestionRows[activeSuggestionIndex].title });
        return;
      }
      const query = homeSearchInput.value.trim();
      if (query) navigateToSeller({ q: query });
    }
  });
}

if (homeSearchSubmit) {
  homeSearchSubmit.addEventListener('click', () => {
    const query = String(homeSearchInput?.value || '').trim();
    if (!query) return;
    navigateToSeller({ q: query });
  });
}

if (homeSearchClear) {
  homeSearchClear.addEventListener('click', () => {
    if (!homeSearchInput) return;
    homeSearchInput.value = '';
    homeSearchClear.classList.remove('is-visible');
    hideSuggestions();
    homeSearchInput.focus();
  });
}

if (homeScanButton) {
  homeScanButton.addEventListener('click', () => {
    openScanner();
  });
}

document.addEventListener('click', (event) => {
  if (!homeSearchSuggestions || !homeSearchInput) return;
  if (homeSearchSuggestions.contains(event.target) || homeSearchInput.contains(event.target)) return;
  if (homeSearchSubmit?.contains(event.target) || homeSearchClear?.contains(event.target)) return;
  hideSuggestions();
});

loadPublicSiteConfig();
loadFaqs();
