const infoFaqList = document.getElementById('infoFaqList');

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderFaqs(rows) {
  if (!infoFaqList) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    infoFaqList.innerHTML = '<p class="muted">No FAQs available right now.</p>';
    return;
  }
  infoFaqList.innerHTML = rows
    .map(
      (row) => `
        <details>
          <summary>${escapeHtml(row.question || '')}</summary>
          <p>${escapeHtml(row.answer || '')}</p>
        </details>
      `
    )
    .join('');
}

async function loadFaqs() {
  if (!infoFaqList) return;
  try {
    const res = await fetch(`/api/faqs?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('faq fetch failed');
    const rows = await res.json();
    renderFaqs(rows);
  } catch {
    infoFaqList.innerHTML = '<p class="muted">Could not load FAQs right now.</p>';
  }
}

loadFaqs();
