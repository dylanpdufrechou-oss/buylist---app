const adminKeyInput = document.getElementById('adminKey');
const connectBtn = document.getElementById('connect');
const adminApp = document.getElementById('adminApp');
const adminMessage = document.getElementById('adminMessage');

const currentBuylistVersionInput = document.getElementById('currentBuylistVersion');
const saveBuylistVersionBtn = document.getElementById('saveBuylistVersion');

const addGameForm = document.getElementById('addGameForm');
const gamesWrap = document.getElementById('gamesWrap');
const refreshGamesBtn = document.getElementById('refreshGames');
const saveAllGamesBtn = document.getElementById('saveAllGames');
const exportCsvBtn = document.getElementById('exportCsv');
const importCsvInput = document.getElementById('importCsv');

const addFaqForm = document.getElementById('addFaqForm');
const faqWrap = document.getElementById('faqWrap');

const submissionsStatusFilterInput = document.getElementById('submissionsStatusFilter');
const submissionsSearchInput = document.getElementById('submissionsSearch');
const submissionsSortInput = document.getElementById('submissionsSort');
const applySubmissionFiltersBtn = document.getElementById('applySubmissionFilters');
const clearSubmissionFiltersBtn = document.getElementById('clearSubmissionFilters');
const exportFilteredSubmissionsCsvBtn = document.getElementById('exportFilteredSubmissionsCsv');
const submissionsTableWrap = document.getElementById('submissionsTableWrap');
const submissionsPaginationWrap = document.getElementById('submissionsPagination');

const submissionDetailModal = document.getElementById('submissionDetailModal');
const closeSubmissionDetailBtn = document.getElementById('closeSubmissionDetail');
const submissionDetailBody = document.getElementById('submissionDetailBody');

const toastContainer = document.getElementById('toastContainer');

let adminKey = '';
let games = [];
let faqs = [];
const platformOptions = ['Wii', 'PS3', 'PS2', 'OG Xbox', 'Xbox 360', 'Wii U', '3DS', 'DS'];
const BUYLIST_UPDATED_EVENT = 'buylistUpdatedAt';
const BUYLIST_SNAPSHOT_EVENT = 'buylistSnapshot';

let submissionsState = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
  status: 'All',
  q: '',
  sort: 'newest',
};

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderNotice(text, type = 'ok') {
  if (!text) {
    adminMessage.innerHTML = '';
    return;
  }
  adminMessage.innerHTML = `<div class="notice ${type}">${escapeHtml(text)}</div>`;
}

function showToast(text, type = 'ok') {
  if (!toastContainer || !text) return;
  const node = document.createElement('div');
  node.className = `toast-item ${type}`;
  node.textContent = text;
  toastContainer.appendChild(node);

  setTimeout(() => {
    node.classList.add('fade-out');
    setTimeout(() => node.remove(), 220);
  }, 1800);
}

function money(price) {
  return `$${Number(price).toFixed(2)}`;
}

function renderPlatformSelect(id, selectedValue) {
  const normalizedSelected = selectedValue || '';
  const hasSelected = normalizedSelected && platformOptions.includes(normalizedSelected);
  return `
    <select data-field="platform" data-id="${id}">
      <option value="">Select Platform</option>
      ${
        !hasSelected && normalizedSelected
          ? `<option value="${escapeHtml(normalizedSelected)}" selected>${escapeHtml(normalizedSelected)}</option>`
          : ''
      }
      ${platformOptions
        .map(
          (platform) =>
            `<option value="${escapeHtml(platform)}" ${normalizedSelected === platform ? 'selected' : ''}>${escapeHtml(
              platform
            )}</option>`
        )
        .join('')}
    </select>
  `;
}

function getGameById(id) {
  return games.find((g) => g.id === id);
}

function getRowPayload(id) {
  return {
    title: gamesWrap.querySelector(`input[data-field="title"][data-id="${id}"]`).value.trim(),
    platform: gamesWrap.querySelector(`select[data-field="platform"][data-id="${id}"]`).value.trim(),
    price: Number(gamesWrap.querySelector(`input[data-field="price"][data-id="${id}"]`).value),
    active: gamesWrap.querySelector(`select[data-field="active"][data-id="${id}"]`).value === '1',
  };
}

function isRowChanged(existing, payload) {
  if (!existing) return false;
  const existingPrice = Number(existing.price);
  const nextPrice = Number(payload.price);

  return (
    payload.title !== String(existing.title || '') ||
    payload.platform !== String(existing.platform || '') ||
    payload.active !== Boolean(existing.active) ||
    Number.isNaN(nextPrice) ||
    Math.abs(existingPrice - nextPrice) >= 0.001
  );
}

async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new Error('Unauthorized. Check your admin key.');
  }

  return res;
}

function markBuylistUpdated() {
  const now = String(Date.now());
  localStorage.setItem(BUYLIST_UPDATED_EVENT, now);
  localStorage.setItem(BUYLIST_SNAPSHOT_EVENT, JSON.stringify({ updatedAt: now, games }));
}

async function saveGame(id, payload, quiet = false) {
  const res = await adminFetch(`/api/admin/games/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not update');

  if (body.game) {
    const idx = games.findIndex((g) => g.id === body.game.id);
    if (idx !== -1) games[idx] = body.game;
  }

  markBuylistUpdated();
  if (!quiet) {
    renderNotice('Game updated.');
    showToast('Saved');
  }
}

async function loadAdminSettings() {
  const res = await adminFetch('/api/admin/settings');
  const settings = await res.json();
  if (!res.ok) throw new Error(settings.error || 'Could not load settings');

  currentBuylistVersionInput.value = settings.current_buylist_version || '';
}

async function saveAdminSettings() {
  const payload = {
    current_buylist_version: currentBuylistVersionInput.value.trim(),
  };

  const res = await adminFetch('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not save settings');

  const settings = body.settings || {};
  currentBuylistVersionInput.value = settings.current_buylist_version || currentBuylistVersionInput.value;
}

async function loadGames() {
  const res = await adminFetch(`/api/admin/games?t=${Date.now()}`, {
    cache: 'no-store',
  });
  games = await res.json();

  gamesWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Platform</th>
          <th>Condition</th>
          <th>Price</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${games
          .map(
            (g) => `
          <tr data-game-id="${g.id}">
            <td><input data-field="title" data-id="${g.id}" value="${escapeHtml(g.title)}" /></td>
            <td>${renderPlatformSelect(g.id, g.platform || '')}</td>
            <td>CIB</td>
            <td><input data-field="price" data-id="${g.id}" value="${escapeHtml(
              g.price
            )}" type="number" min="0" step="0.01" style="width: 100px" /></td>
            <td>
              <select data-field="active" data-id="${g.id}">
                <option value="1" ${g.active ? 'selected' : ''}>Yes</option>
                <option value="0" ${!g.active ? 'selected' : ''}>No</option>
              </select>
            </td>
            <td class="row-actions">
              <button class="secondary" data-action="save" data-id="${g.id}">Save</button>
              <button class="danger" data-action="delete" data-id="${g.id}">Delete</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  gamesWrap.querySelectorAll('button[data-action="save"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      const payload = getRowPayload(id);

      try {
        await saveGame(id, payload);
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  gamesWrap.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      if (!confirm('Delete this game from the buylist?')) return;
      try {
        const res = await adminFetch(`/api/admin/games/${id}`, { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not delete');
        games = games.filter((g) => g.id !== id);
        renderNotice('Game deleted.');
        showToast('Saved');
        markBuylistUpdated();
        await loadGames();
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

}

function copyText(text, label) {
  navigator.clipboard
    .writeText(String(text || ''))
    .then(() => showToast(`${label} copied`))
    .catch(() => showToast('Copy failed', 'error'));
}

async function downloadAdminCsv(url, filename) {
  const res = await fetch(url, {
    headers: { 'x-admin-key': adminKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not export CSV');
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

function submissionStatusClass(status) {
  return String(status || 'pending').toLowerCase().replaceAll(' ', '-');
}

function submissionFiltersQueryString(includePage = true) {
  const params = new URLSearchParams();
  if (submissionsState.status && submissionsState.status !== 'All') params.set('status', submissionsState.status);
  if (submissionsState.q) params.set('q', submissionsState.q);
  if (submissionsState.sort) params.set('sort', submissionsState.sort);
  if (includePage) {
    params.set('page', String(submissionsState.page));
    params.set('pageSize', String(submissionsState.pageSize));
  }
  return params.toString();
}

function selectedSubmissionSort() {
  return submissionsSortInput && submissionsSortInput.value === 'oldest' ? 'oldest' : 'newest';
}

function renderSubmissionsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    submissionsTableWrap.innerHTML = '<p class="muted">No submissions match your filters.</p>';
    return;
  }

  submissionsTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Submission ID</th>
          <th>Seller Name</th>
          <th>Email</th>
          <th>Item Count</th>
          <th>Estimated Total</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
          <tr>
            <td>${escapeHtml(row.created_at || '')}</td>
            <td>#${row.id}</td>
            <td>${escapeHtml(row.seller_name || '')}</td>
            <td>${escapeHtml(row.email || '-')}</td>
            <td>${Number(row.total_qty || row.item_count || 0)}</td>
            <td>${money(row.estimated_total || 0)}</td>
            <td><span class="submission-status ${submissionStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
            <td class="row-actions">
              <button class="secondary" data-action="view-submission" data-id="${row.id}">View</button>
              <button class="secondary" data-action="export-submission" data-id="${row.id}">Export CSV</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  submissionsTableWrap.querySelectorAll('button[data-action="view-submission"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      try {
        await openSubmissionDetail(id);
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  submissionsTableWrap.querySelectorAll('button[data-action="export-submission"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      try {
        await downloadAdminCsv(`/api/admin/submissions/${id}/export-csv`, `submission-${id}.csv`);
        showToast('Exported');
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });
}

function renderSubmissionPagination() {
  submissionsPaginationWrap.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'secondary';
  prevBtn.textContent = 'Previous';
  prevBtn.disabled = submissionsState.page <= 1;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'secondary';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = submissionsState.page >= submissionsState.totalPages;

  const info = document.createElement('span');
  info.className = 'muted';
  info.textContent = `Page ${submissionsState.page} of ${submissionsState.totalPages} (${submissionsState.total} total)`;

  prevBtn.addEventListener('click', () => loadSubmissions(submissionsState.page - 1));
  nextBtn.addEventListener('click', () => loadSubmissions(submissionsState.page + 1));

  submissionsPaginationWrap.appendChild(prevBtn);
  submissionsPaginationWrap.appendChild(nextBtn);
  submissionsPaginationWrap.appendChild(info);
}

async function loadSubmissions(page = 1) {
  submissionsState.page = page;
  const query = submissionFiltersQueryString(true);

  const res = await adminFetch(`/api/admin/submissions?${query}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not load submissions');

  const pagination = body.pagination || {};
  const filters = body.filters || {};
  submissionsState.page = Number(pagination.page || 1);
  submissionsState.pageSize = Number(pagination.pageSize || 25);
  submissionsState.total = Number(pagination.total || 0);
  submissionsState.totalPages = Number(pagination.totalPages || 1);
  submissionsState.status = filters.status || submissionsState.status;
  submissionsState.q = filters.q || submissionsState.q;
  submissionsState.sort = filters.sort || submissionsState.sort;

  submissionsStatusFilterInput.value = submissionsState.status;
  submissionsSearchInput.value = submissionsState.q;
  if (submissionsSortInput) submissionsSortInput.value = submissionsState.sort;

  renderSubmissionsTable(body.rows || []);
  renderSubmissionPagination();
}

function closeSubmissionDetailModal() {
  submissionDetailModal.classList.add('is-hidden');
  document.body.classList.remove('modal-open');
}

async function saveSubmissionDetail(id, status, internalNotes) {
  if (status === 'Rejected' && String(internalNotes || '').trim().length < 10) {
    throw new Error('Rejected submissions require internal notes of at least 10 characters.');
  }

  const res = await adminFetch(`/api/admin/submissions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, internalNotes }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not save submission changes');
  return body.submission;
}

function renderSubmissionDetail(detail) {
  submissionDetailBody.innerHTML = `
    <div class="grid" style="gap: 0.7rem">
      <div class="grid two">
        <div><strong>Submission ID:</strong> #${detail.id}</div>
        <div><strong>Created:</strong> ${escapeHtml(detail.created_at || '')}</div>
        <div><strong>Price Version:</strong> ${escapeHtml(detail.price_version || '-')}</div>
        <div>
          <label class="muted" for="detailStatus">Status</label>
          <select id="detailStatus">
            <option value="Pending" ${detail.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Received" ${detail.status === 'Received' ? 'selected' : ''}>Received</option>
            <option value="Paid" ${detail.status === 'Paid' ? 'selected' : ''}>Paid</option>
            <option value="Rejected" ${detail.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </div>
      </div>

      <section class="card" style="margin: 0">
        <h3 style="margin-top: 0">Seller</h3>
        <div class="grid two">
          <div><strong>Name:</strong> ${escapeHtml(detail.seller_name || '-')}</div>
          <div class="row-actions">
            <strong>Email:</strong> ${escapeHtml(detail.email || '-')}
            <button type="button" class="secondary" data-copy="email">Copy</button>
          </div>
          <div class="row-actions">
            <strong>Phone:</strong> ${escapeHtml(detail.phone || '-')}
            <button type="button" class="secondary" data-copy="phone">Copy</button>
          </div>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Platform</th>
            <th>Qty</th>
            <th>Unit Price (Locked)</th>
            <th>Line Total (Locked)</th>
          </tr>
        </thead>
        <tbody>
          ${detail.items
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.title || '')}</td>
              <td>${escapeHtml(item.platform || '')}</td>
              <td>${Number(item.qty || 0)}</td>
              <td>${money(item.unit_price_at_submit || 0)}</td>
              <td>${money(item.line_total_at_submit || 0)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>

      <div><strong>Estimated Total (Locked):</strong> ${money(detail.estimated_total || 0)}</div>

      <div class="grid">
        <label for="detailInternalNotes" class="muted">Internal Notes</label>
        <textarea id="detailInternalNotes" rows="4" placeholder="Internal processing notes">${escapeHtml(
          detail.internal_notes || ''
        )}</textarea>
      </div>

      <div class="row-actions">
        <button type="button" id="saveSubmissionDetail">Save</button>
        <button type="button" class="secondary" data-status-action="Received">Mark Received</button>
        <button type="button" class="secondary" data-status-action="Paid">Mark Paid</button>
        <button type="button" class="secondary" data-status-action="Rejected">Mark Rejected</button>
        <button type="button" class="secondary" id="exportSubmissionCsvFromDetail">Export CSV</button>
      </div>
    </div>
  `;

  submissionDetailBody.querySelectorAll('button[data-copy="email"]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(detail.email || '', 'Email'));
  });
  submissionDetailBody.querySelectorAll('button[data-copy="phone"]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(detail.phone || '', 'Phone'));
  });

  const statusSelect = document.getElementById('detailStatus');
  const notesInput = document.getElementById('detailInternalNotes');
  const saveBtn = document.getElementById('saveSubmissionDetail');
  const exportBtn = document.getElementById('exportSubmissionCsvFromDetail');

  saveBtn.addEventListener('click', async () => {
    try {
      const updated = await saveSubmissionDetail(detail.id, statusSelect.value, notesInput.value);
      showToast('Saved');
      await loadSubmissions(submissionsState.page);
      renderSubmissionDetail(updated);
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });

  submissionDetailBody.querySelectorAll('button[data-status-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextStatus = btn.getAttribute('data-status-action');
      statusSelect.value = nextStatus;

      try {
        const updated = await saveSubmissionDetail(detail.id, nextStatus, notesInput.value);
        showToast('Status updated');
        await loadSubmissions(submissionsState.page);
        renderSubmissionDetail(updated);
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  exportBtn.addEventListener('click', async () => {
    try {
      await downloadAdminCsv(`/api/admin/submissions/${detail.id}/export-csv`, `submission-${detail.id}.csv`);
      showToast('Exported');
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

async function openSubmissionDetail(id) {
  const res = await adminFetch(`/api/admin/submissions/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Could not load submission detail');

  submissionDetailModal.classList.remove('is-hidden');
  document.body.classList.add('modal-open');
  renderSubmissionDetail(body);
}

async function loadFaqs() {
  const res = await adminFetch('/api/admin/faqs');
  faqs = await res.json();

  if (faqs.length === 0) {
    faqWrap.innerHTML = '<p class="muted">No FAQs yet.</p>';
    return;
  }

  faqWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Question</th>
          <th>Answer</th>
          <th>Sort</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${faqs
          .map(
            (f) => `
          <tr data-faq-id="${f.id}">
            <td><input data-field="question" data-id="${f.id}" value="${escapeHtml(f.question)}" /></td>
            <td><textarea data-field="answer" data-id="${f.id}" rows="2">${escapeHtml(f.answer)}</textarea></td>
            <td><input data-field="sort_order" data-id="${f.id}" type="number" value="${Number(
              f.sort_order || 0
            )}" style="width: 88px" /></td>
            <td>
              <select data-field="active" data-id="${f.id}">
                <option value="1" ${f.active ? 'selected' : ''}>Yes</option>
                <option value="0" ${!f.active ? 'selected' : ''}>No</option>
              </select>
            </td>
            <td class="row-actions">
              <button class="secondary" data-action="save-faq" data-id="${f.id}">Save</button>
              <button class="danger" data-action="delete-faq" data-id="${f.id}">Delete</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  faqWrap.querySelectorAll('button[data-action="save-faq"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      const payload = {
        question: faqWrap.querySelector(`input[data-field="question"][data-id="${id}"]`).value.trim(),
        answer: faqWrap.querySelector(`textarea[data-field="answer"][data-id="${id}"]`).value.trim(),
        sortOrder: Number(faqWrap.querySelector(`input[data-field="sort_order"][data-id="${id}"]`).value || 0),
        active: faqWrap.querySelector(`select[data-field="active"][data-id="${id}"]`).value === '1',
      };

      try {
        const res = await adminFetch(`/api/admin/faqs/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not update FAQ');
        renderNotice('FAQ updated.');
        showToast('Saved');
        await loadFaqs();
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });

  faqWrap.querySelectorAll('button[data-action="delete-faq"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.getAttribute('data-id'));
      if (!confirm('Delete this FAQ?')) return;
      try {
        const res = await adminFetch(`/api/admin/faqs/${id}`, { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not delete FAQ');
        renderNotice('FAQ deleted.');
        showToast('Saved');
        await loadFaqs();
      } catch (err) {
        renderNotice(err.message, 'error');
      }
    });
  });
}

saveAllGamesBtn.addEventListener('click', async () => {
  try {
    const rowEls = gamesWrap.querySelectorAll('tr[data-game-id]');
    let changed = 0;
    for (const row of rowEls) {
      const id = Number(row.getAttribute('data-game-id'));
      if (!Number.isInteger(id)) continue;
      const existing = getGameById(id);
      const payload = getRowPayload(id);
      if (!isRowChanged(existing, payload)) continue;
      await saveGame(id, payload, true);
      changed += 1;
    }

    if (changed === 0) {
      renderNotice('No pending edits to save.');
      return;
    }
    renderNotice(`Saved ${changed} game${changed === 1 ? '' : 's'}.`);
    showToast('Saved');
    await loadGames();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

async function bootstrapAdmin() {
  try {
    await loadGames();
    await loadSubmissions(1);
    await loadFaqs();
    await loadAdminSettings();
    adminApp.style.display = 'block';
    renderNotice('Connected.');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
}

connectBtn.addEventListener('click', () => {
  adminKey = adminKeyInput.value.trim();
  if (!adminKey) {
    renderNotice('Enter your admin key.', 'error');
    return;
  }
  bootstrapAdmin();
});

saveBuylistVersionBtn.addEventListener('click', async () => {
  try {
    await saveAdminSettings();
    renderNotice('Buylist version saved.');
    showToast('Saved');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

addGameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      title: document.getElementById('title').value,
      platform: document.getElementById('platform').value,
      price: Number(document.getElementById('price').value),
      active: document.getElementById('active').value === '1',
    };

    const res = await adminFetch('/api/admin/games', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add game');

    addGameForm.reset();
    renderNotice('Game added.');
    showToast('Saved');
    await loadGames();
    markBuylistUpdated();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

refreshGamesBtn.addEventListener('click', async () => {
  try {
    await loadGames();
    await loadSubmissions(submissionsState.page);
    await loadFaqs();
    await loadAdminSettings();
    renderNotice('Data refreshed.');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

exportCsvBtn.addEventListener('click', async () => {
  try {
    await downloadAdminCsv('/api/admin/games/export-csv', 'buylist.csv');
    showToast('Exported');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

importCsvInput.addEventListener('change', async () => {
  const file = importCsvInput.files && importCsvInput.files[0];
  if (!file) return;
  try {
    const csv = await file.text();
    const res = await adminFetch('/api/admin/games/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'CSV import failed');
    renderNotice(`Imported ${body.imported} rows.`);
    showToast('Saved');
    await loadGames();
    markBuylistUpdated();
  } catch (err) {
    renderNotice(err.message, 'error');
  } finally {
    importCsvInput.value = '';
  }
});

addFaqForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      question: document.getElementById('faqQuestion').value.trim(),
      answer: document.getElementById('faqAnswer').value.trim(),
      sortOrder: Number(document.getElementById('faqSortOrder').value || 0),
      active: document.getElementById('faqActive').value === '1',
    };

    const res = await adminFetch('/api/admin/faqs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add FAQ');

    addFaqForm.reset();
    document.getElementById('faqSortOrder').value = '0';
    document.getElementById('faqActive').value = '1';
    renderNotice('FAQ added.');
    showToast('Saved');
    await loadFaqs();
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

applySubmissionFiltersBtn.addEventListener('click', async () => {
  submissionsState.status = submissionsStatusFilterInput.value || 'All';
  submissionsState.q = submissionsSearchInput.value.trim();
  submissionsState.sort = selectedSubmissionSort();
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

clearSubmissionFiltersBtn.addEventListener('click', async () => {
  submissionsStatusFilterInput.value = 'All';
  submissionsSearchInput.value = '';
  if (submissionsSortInput) submissionsSortInput.value = 'newest';
  submissionsState.status = 'All';
  submissionsState.q = '';
  submissionsState.sort = 'newest';
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

submissionsSearchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  submissionsState.status = submissionsStatusFilterInput.value || 'All';
  submissionsState.q = submissionsSearchInput.value.trim();
  submissionsState.sort = selectedSubmissionSort();
  try {
    await loadSubmissions(1);
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

if (submissionsSortInput) {
  submissionsSortInput.addEventListener('change', async () => {
    submissionsState.sort = selectedSubmissionSort();
    try {
      await loadSubmissions(1);
    } catch (err) {
      renderNotice(err.message, 'error');
    }
  });
}

exportFilteredSubmissionsCsvBtn.addEventListener('click', async () => {
  try {
    const query = submissionFiltersQueryString(false);
    const url = query ? `/api/admin/submissions/export-csv?${query}` : '/api/admin/submissions/export-csv';
    await downloadAdminCsv(url, 'submissions-filtered.csv');
    showToast('Exported');
  } catch (err) {
    renderNotice(err.message, 'error');
  }
});

closeSubmissionDetailBtn.addEventListener('click', closeSubmissionDetailModal);

submissionDetailModal.addEventListener('click', (e) => {
  if (e.target === submissionDetailModal) {
    closeSubmissionDetailModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSubmissionDetailModal();
});
