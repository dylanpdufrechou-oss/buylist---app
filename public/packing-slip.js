const PACKING_SLIP_SESSION_KEY = 'ibgPackingSlipPayload';
const PACKING_SLIP_LOCAL_KEY = 'ibgPackingSlipPayloadBackup';
const AUTO_PRINT_DELAY_MS = 220;

const slipContent = document.getElementById('packingSlipContent');
const slipError = document.getElementById('packingSlipError');
const itemsBody = document.getElementById('packingSlipItems');
const printBtn = document.getElementById('printSlipBtn');
const backToBuylistLink = document.getElementById('backToBuylist');

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function safeReturnPath(raw) {
  const value = String(raw || '').trim();
  if (!value || !value.startsWith('/') || value.includes('://') || value.startsWith('/packing-slip.html')) {
    return '/seller.html';
  }
  return value;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => ({
      title: String(item?.title || '').trim() || 'Untitled Game',
      quantity: Math.max(0, Number.parseInt(item?.quantity, 10) || 0),
    }))
    .filter((item) => item.quantity > 0);
}

function readPayload() {
  let raw = null;
  try {
    raw = sessionStorage.getItem(PACKING_SLIP_SESSION_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    try {
      raw = localStorage.getItem(PACKING_SLIP_LOCAL_KEY);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const items = normalizeItems(parsed?.items);
    const totalQuantity = Number.isFinite(Number(parsed?.totalQuantity))
      ? Number(parsed.totalQuantity)
      : items.reduce((sum, item) => sum + item.quantity, 0);
    const itemCount = Number.isFinite(Number(parsed?.itemCount)) ? Number(parsed.itemCount) : items.length;
    return {
      shipmentId: String(parsed?.shipmentId || '').trim() || '-',
      submissionId: String(parsed?.submissionId || '').trim() || '-',
      createdAt: String(parsed?.createdAt || '').trim(),
      sellerName: String(parsed?.sellerName || '').trim() || '-',
      sellerEmail: String(parsed?.sellerEmail || '').trim() || '-',
      sellerPhone: String(parsed?.sellerPhone || '').trim() || '-',
      totalQuantity,
      itemCount,
      items,
      returnTo: safeReturnPath(parsed?.returnTo),
    };
  } catch {
    return null;
  }
}

function formatDate(raw) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function showError(message, returnTo) {
  if (slipError) {
    slipError.textContent = message;
    slipError.classList.remove('is-hidden');
  }
  if (slipContent) slipContent.classList.add('is-hidden');
  if (printBtn) printBtn.disabled = true;
  if (backToBuylistLink) backToBuylistLink.href = safeReturnPath(returnTo);
}

function renderSlip(payload) {
  setText('slipId', payload.shipmentId);
  setText('submissionId', payload.submissionId);
  setText('createdAt', formatDate(payload.createdAt));
  setText('sellerName', payload.sellerName);
  setText('sellerEmail', payload.sellerEmail);
  setText('sellerPhone', payload.sellerPhone);
  setText('totalQty', String(payload.totalQuantity));
  setText('totalTitles', String(payload.itemCount));

  if (itemsBody) {
    itemsBody.innerHTML = payload.items
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.title)}</td>
            <td class="qty">${item.quantity}</td>
          </tr>
        `
      )
      .join('');
  }

  if (slipError) slipError.classList.add('is-hidden');
  if (slipContent) slipContent.classList.remove('is-hidden');
  if (printBtn) printBtn.disabled = false;
  if (backToBuylistLink) backToBuylistLink.href = payload.returnTo;
}

function autoPrint() {
  window.setTimeout(() => {
    try {
      window.print();
    } catch {
      // Manual print button remains available.
    }
  }, AUTO_PRINT_DELAY_MS);
}

function init() {
  const payload = readPayload();

  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  if (!payload || payload.items.length === 0) {
    showError('No packing slip data found. Submit your shipment again to generate a new slip.', '/seller.html');
    return;
  }

  renderSlip(payload);
  autoPrint();
}

init();
