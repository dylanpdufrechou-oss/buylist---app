const legalContainer = document.getElementById('legalContent');
const legalSection = document.querySelector('[data-legal-page]');
const legalPageType = String(legalSection?.getAttribute('data-legal-page') || '').trim().toLowerCase();

const DEFAULT_TERMS_TEXT = [
  '- Buylist prices apply to qualifying CIB titles that meet listed standards.',
  '- Pricing is locked when a shipment is submitted.',
  '- Items that fail condition standards may be rejected or returned.',
  '- Sellers are responsible for secure packing and shipment tracking unless otherwise specified.',
  '- Buylist pricing may change with monthly updates.',
].join('\n');

const DEFAULT_PRIVACY_TEXT = [
  '- Seller information submitted through this site is used only for shipment processing, communication, and payment-related support.',
  '- We use submitted contact information to process and communicate about your shipment.',
  '- Shipment details are stored for operational and recordkeeping purposes.',
  '- We do not sell personal data to third parties.',
].join('\n');

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean);
}

function fallbackText() {
  if (legalPageType === 'privacy') return DEFAULT_PRIVACY_TEXT;
  return DEFAULT_TERMS_TEXT;
}

function renderLegalText(text) {
  if (!legalContainer) return;
  const lines = normalizeLines(text);
  if (!lines.length) {
    legalContainer.innerHTML = '<p class="muted">Content unavailable right now.</p>';
    return;
  }
  legalContainer.innerHTML = `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}

async function loadLegalContent() {
  if (!legalContainer) return;
  try {
    const res = await fetch(`/api/public-legal-content?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load legal content (${res.status})`);
    const body = await res.json();
    const text = legalPageType === 'privacy' ? body.privacyPolicyText : body.termsConditionsText;
    renderLegalText(text || fallbackText());
  } catch {
    renderLegalText(fallbackText());
  }
}

loadLegalContent();
