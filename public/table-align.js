(function () {
  const DESKTOP_TABLE_CLASS = 'desktop-centered-table';
  const TITLE_HEADER_COLUMN_CLASS = 'table-title-header-col';
  const TITLE_DATA_COLUMN_CLASS = 'table-title-data-col';
  const QTY_COLUMN_CLASS = 'table-qty-col';
  const LEGACY_TITLE_COLUMN_CLASS = 'table-title-col';
  let mutationDebounceTimer = 0;

  function getRowCells(row) {
    return Array.from(row?.children || []).filter((node) => node.tagName === 'TH' || node.tagName === 'TD');
  }

  function normalizeHeaderText(cell) {
    return String(cell?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function findTitleColumnIndex(table) {
    const headerRow = table.tHead?.rows?.[0] || table.querySelector('thead tr');
    if (!headerRow) return -1;
    const headerCells = getRowCells(headerRow);
    for (let i = 0; i < headerCells.length; i += 1) {
      const headerText = normalizeHeaderText(headerCells[i]);
      if (headerText.includes('title')) return i;
    }
    return -1;
  }

  function findQtyColumnIndex(table) {
    const headerRow = table.tHead?.rows?.[0] || table.querySelector('thead tr');
    if (!headerRow) return -1;
    const headerCells = getRowCells(headerRow);
    for (let i = 0; i < headerCells.length; i += 1) {
      const headerText = normalizeHeaderText(headerCells[i]);
      if (headerText.includes('qty') || headerText.includes('quantity')) return i;
    }
    return -1;
  }

  function applyAlignmentToTable(table) {
    if (!(table instanceof HTMLTableElement)) return;
    table.classList.add(DESKTOP_TABLE_CLASS);
    table
      .querySelectorAll(
        `.${TITLE_HEADER_COLUMN_CLASS}, .${TITLE_DATA_COLUMN_CLASS}, .${QTY_COLUMN_CLASS}, .${LEGACY_TITLE_COLUMN_CLASS}`
      )
      .forEach((node) => {
        node.classList.remove(TITLE_HEADER_COLUMN_CLASS);
        node.classList.remove(TITLE_DATA_COLUMN_CLASS);
        node.classList.remove(QTY_COLUMN_CLASS);
        node.classList.remove(LEGACY_TITLE_COLUMN_CLASS);
      });

    const titleColIndex = findTitleColumnIndex(table);
    const qtyColIndex = findQtyColumnIndex(table);

    Array.from(table.rows || []).forEach((row) => {
      const cells = getRowCells(row);
      const isHeaderRow = row.parentElement && row.parentElement.tagName === 'THEAD';
      if (titleColIndex >= 0 && cells[titleColIndex]) {
        cells[titleColIndex].classList.add(isHeaderRow ? TITLE_HEADER_COLUMN_CLASS : TITLE_DATA_COLUMN_CLASS);
      }
      if (qtyColIndex >= 0 && cells[qtyColIndex]) {
        cells[qtyColIndex].classList.add(QTY_COLUMN_CLASS);
      }
    });
  }

  function alignAllTables() {
    document.querySelectorAll('table').forEach(applyAlignmentToTable);
  }

  function scheduleAlignAllTables() {
    if (mutationDebounceTimer) return;
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = 0;
      alignAllTables();
    }, 60);
  }

  function initTableAlignmentObserver() {
    alignAllTables();
    if (!document.body) return;
    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];
        if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
          scheduleAlignAllTables();
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTableAlignmentObserver, { once: true });
  } else {
    initTableAlignmentObserver();
  }
})();
