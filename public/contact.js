const form = document.getElementById('contactForm');
const submitBtn = document.getElementById('contactSubmit');
const messageWrap = document.getElementById('contactMessage');

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMessage(text, type = 'ok') {
  if (!messageWrap) return;
  if (!text) {
    messageWrap.innerHTML = '';
    return;
  }
  messageWrap.innerHTML = `<div class="notice ${type}">${escapeHtml(text)}</div>`;
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: document.getElementById('contactName')?.value?.trim() || '',
      email: document.getElementById('contactEmail')?.value?.trim() || '',
      subject: document.getElementById('contactSubject')?.value?.trim() || '',
      message: document.getElementById('contactBody')?.value?.trim() || '',
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    renderMessage('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not submit message.');
      form.reset();
      renderMessage('Thanks. Your message was sent successfully.');
    } catch (error) {
      renderMessage(error.message || 'Could not submit message.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
    }
  });
}
