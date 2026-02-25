const PACKING_SLIP_SESSION_KEY = 'ibgPackingSlipPayload';
const PACKING_SLIP_LOCAL_KEY = 'ibgPackingSlipPayloadBackup';
const PACKING_SLIP_CONFIG_URL = '/api/packing-slip-config';
const AUTO_PRINT_DELAY_MS = 220;
const DEFAULT_NEXT_STEPS_TEXT = [
  '- We have received your submission. Thank you for submitting.',
  '- Please allow 24-48 hours for payout via PayPal after shipment processing.',
  '- Shipments submitted on Friday are expected to be paid by Tuesday evening at the latest.',
  '- We do not process payouts on weekends (business days only).',
].join('\n');

const slipContent = document.getElementById('packingSlipContent');
const slipError = document.getElementById('packingSlipError');
const itemsBody = document.getElementById('packingSlipItems');
const printBtn = document.getElementById('printSlipBtn');
const backToBuylistLink = document.getElementById('backToBuylist');
const shipToBlock = document.getElementById('shipToBlock');
const nextStepsBlock = document.getElementById('nextStepsBlock');
const postPrintStatus = document.getElementById('postPrintStatus');

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

function safeText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

function safeReturnPath(raw) {
  const value = safeText(raw);
  if (!value || !value.startsWith('/') || value.includes('://') || value.startsWith('/packing-slip.html')) {
    return '/seller.html';
  }
  return value;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => ({
      title: safeText(item?.title) || 'Untitled Game',
      quantity: Math.max(0, Number.parseInt(item?.quantity, 10) || 0),
    }))
    .filter((item) => item.quantity > 0);
}

function normalizeShipTo(raw = {}) {
  return {
    businessName: safeText(raw.businessName) || 'I_BuyGames Buylist',
    contactName: safeText(raw.contactName),
    addressLine1: safeText(raw.addressLine1),
    addressLine2: safeText(raw.addressLine2),
    city: safeText(raw.city),
    state: safeText(raw.state),
    postalCode: safeText(raw.postalCode),
    country: safeText(raw.country) || 'USA',
  };
}

function normalizeSlipConfig(raw = {}) {
  const shipTo = normalizeShipTo(raw.shipTo || {});
  const nextStepsText = safeText(raw.nextStepsText) || DEFAULT_NEXT_STEPS_TEXT;
  return { shipTo, nextStepsText };
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
      shipmentId: safeText(parsed?.shipmentId) || '-',
      submissionId: safeText(parsed?.submissionId) || '-',
      createdAt: safeText(parsed?.createdAt),
      sellerName: safeText(parsed?.sellerName) || '-',
      sellerEmail: safeText(parsed?.sellerEmail) || '-',
      sellerPhone: safeText(parsed?.sellerPhone) || '-',
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

function cityStatePostalLine(shipTo) {
  const parts = [];
  if (shipTo.city) parts.push(shipTo.city);
  const statePostal = [shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
  if (statePostal) parts.push(statePostal);
  return parts.join(', ');
}

function renderShipTo(shipTo) {
  if (!shipToBlock) return;
  const lines = [
    shipTo.businessName,
    shipTo.contactName,
    shipTo.addressLine1,
    shipTo.addressLine2,
    cityStatePostalLine(shipTo),
    shipTo.country,
  ].filter(Boolean);

  shipToBlock.innerHTML = lines.length
    ? lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')
    : '<div>-</div>';
}

function normalizeNextStepLine(line) {
  return safeText(line).replace(/^[-*•]\s*/, '');
}

function renderNextSteps(text) {
  if (!nextStepsBlock) return;
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeNextStepLine(line))
    .filter(Boolean);
  if (!rows.length) {
    nextStepsBlock.innerHTML = '<p class="muted">No additional instructions.</p>';
    return;
  }
  nextStepsBlock.innerHTML = `<ul>${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>`;
}

function markPrintedNotice() {
  if (!postPrintStatus) return;
  postPrintStatus.textContent = 'Packing slip printed. Next steps below.';
  postPrintStatus.classList.remove('warn');
  postPrintStatus.classList.add('ok', 'is-printed');
}

async function loadSlipConfig() {
  try {
    const response = await fetch(`${PACKING_SLIP_CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Config fetch failed (${response.status})`);
    const body = await response.json();
    return normalizeSlipConfig(body);
  } catch {
    return normalizeSlipConfig({});
  }
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

async function init() {
  const payload = readPayload();

  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }
  window.onafterprint = markPrintedNotice;

  if (!payload || payload.items.length === 0) {
    showError('No packing slip data found. Submit your shipment again to generate a new slip.', '/seller.html');
    return;
  }

  renderSlip(payload);
  const config = await loadSlipConfig();
  renderShipTo(config.shipTo);
  renderNextSteps(config.nextStepsText);
  autoPrint();
}

init();
