import { dispatch } from './parsers/index.js';
import { readPdfText } from './pdfReader.js';
import { PRODUCTS, detectProduct, findProductByKey } from './data/midCodes.js';
import { buildAOA, buildFileName } from './excelExporter.js';
import { HEADER_ROW, buildRow } from './buildRow.js';
import {
  TRACKING_HEADERS,
  ACCOUNTS,
  WEEKDAYS,
  buildTrackingRow,
  trackingRowToCells,
  parseProductLines,
  formatDateDDMMYY,
  weekdayName,
  orderNumberFor,
  setWeekdayWithinWeek,
  toISODate,
  fromISODate,
} from './trackingRow.js';
import { createStore } from './trackingStore.js';

export function createApp({ document, window, pdfjsLib, XLSX }) {
  const dropZone = document.getElementById('drop-zone');
  const filePicker = document.getElementById('file-picker');
  const folderPicker = document.getElementById('folder-picker');
  const clearBtn = document.getElementById('btn-clear');
  const downloadBtn = document.getElementById('btn-download');
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  const statusEl = document.getElementById('status');
  const summary = document.getElementById('summary');

  // Tracking section elements
  const trackApiUrl = document.getElementById('track-api-url');
  const trackSaveUrl = document.getElementById('btn-track-save-url');
  const trackLoadSaved = document.getElementById('btn-track-load');
  const trackBackend = document.getElementById('track-backend');
  const trackingHead = document.getElementById('tracking-head');
  const trackingBody = document.getElementById('tracking-body');
  const trackingStatus = document.getElementById('tracking-status');

  const API_BASE_KEY = 'pharmaconsulta_tracking_api_base';
  // Default Cloudflare Worker (D1) endpoint. Used unless the user overrides it
  // via the Sync API URL box (saving an explicit value — including blank).
  const DEFAULT_API_BASE = 'https://pharmaconsulta-tracking.labrint.workers.dev';

  const headers = HEADER_ROW();
  let orders = [];
  let trackingRows = [];

  renderHeader();
  renderRows();
  initTracking();

  dropZone.addEventListener('click', () => filePicker.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = await readDataTransfer(e.dataTransfer);
    await ingestFiles(files);
  });

  filePicker.addEventListener('change', async (e) => {
    await ingestFiles(Array.from(e.target.files));
    e.target.value = '';
  });
  folderPicker.addEventListener('change', async (e) => {
    await ingestFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  clearBtn.addEventListener('click', () => {
    orders = [];
    statusEl.textContent = '';
    renderRows();
    // Keep rows that were loaded from the database; drop order-derived ones.
    trackingRows = trackingRows.filter((r) => r._origin === 'db');
    renderTracking();
  });

  downloadBtn.addEventListener('click', () => {
    if (!orders.length) return;
    const aoa = buildAOA(orders.map((o) => ({ recipient: o.recipient, product: o.product })));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map(() => ({ wch: 28.875 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFileName(orders.length);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 200);
    setStatus(`Downloaded ${a.download}`, 'ok');
  });

  function setStatus(msg, level = '') {
    const line = document.createElement('div');
    line.className = `status-line ${level}`;
    line.textContent = msg;
    statusEl.appendChild(line);
    while (statusEl.children.length > 12) statusEl.removeChild(statusEl.firstChild);
  }

  async function ingestFiles(fileList) {
    const pdfs = fileList.filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) {
      setStatus('No PDF files found in selection.', 'warn');
      renderRows();
      return;
    }
    setStatus(`Reading ${pdfs.length} PDF(s)…`);
    for (const file of pdfs) {
      try {
        const text = await readPdfText(file, pdfjsLib);
        const parsed = dispatch(text);
        if (!parsed.length) {
          setStatus(`${file.name}: format not recognised.`, 'err');
          continue;
        }
        for (const order of parsed) {
          const product = detectProduct(order.productText) || detectProduct(text);
          orders.push({
            fileName: file.name,
            source: order.source,
            recipient: order.recipient,
            productText: order.productText,
            product: product || null,
            orderId: order.orderId || '',
          });
        }
        setStatus(`${file.name}: parsed (${parsed.length} order${parsed.length > 1 ? 's' : ''}).`, 'ok');
      } catch (err) {
        setStatus(`${file.name}: ${err.message}`, 'err');
      }
    }
    renderRows();
    buildTrackingFromOrders();
    renderTracking();
  }

  function renderHeader() {
    tableHead.innerHTML = '';
    const tr = document.createElement('tr');
    const headerSeq = ['File', 'Source', 'Product (MID)'].concat(headers);
    for (const h of headerSeq) {
      const th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    }
    tableHead.appendChild(tr);
  }

  function renderRows() {
    tableBody.innerHTML = '';
    orders.forEach((o, idx) => {
      const tr = document.createElement('tr');
      const cells = buildRow({ recipient: o.recipient, product: o.product }, idx);
      const hasResolvedProduct = !!o.product && !!o.product.mid;
      if (!hasResolvedProduct) tr.classList.add('invalid');

      const fileTd = document.createElement('td');
      fileTd.className = 'col-file';
      fileTd.textContent = o.fileName;
      tr.appendChild(fileTd);

      const srcTd = document.createElement('td');
      srcTd.textContent = o.source || '';
      tr.appendChild(srcTd);

      const prodTd = document.createElement('td');
      prodTd.className = 'col-product';
      const sel = document.createElement('select');
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '— pick product —';
      sel.appendChild(empty);
      for (const p of PRODUCTS) {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = `${p.label}${p.mid ? ` (${p.mid})` : ''}`;
        if (o.product && o.product.key === p.key) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const product = findProductByKey(sel.value);
        orders[idx].product = product || null;
        renderRows();
      });
      prodTd.appendChild(sel);
      tr.appendChild(prodTd);

      cells.forEach((value, colIdx) => {
        const td = document.createElement('td');
        td.textContent = value;
        td.setAttribute('contenteditable', 'true');
        td.dataset.colIdx = colIdx;
        td.addEventListener('input', () => {
          orders[idx].overrides = orders[idx].overrides || {};
          orders[idx].overrides[colIdx] = td.textContent;
        });
        tr.appendChild(td);
      });

      tableBody.appendChild(tr);
    });
    const unresolved = orders.filter((o) => !o.product || !o.product.mid).length;
    downloadBtn.disabled = !orders.length || unresolved > 0;
    summary.innerHTML = orders.length
      ? `<strong>${orders.length}</strong> shipment${orders.length > 1 ? 's' : ''} loaded${
          unresolved
            ? `, <span style="color:var(--err)"><strong>${unresolved}</strong> need a product assigned</span>`
            : ''
        }.`
      : 'Drop PDFs above to begin.';
  }

  // ---- Tracking section ----

  function getApiBase() {
    try {
      const stored = window.localStorage.getItem(API_BASE_KEY);
      if (stored !== null) return stored.trim();
    } catch {}
    return DEFAULT_API_BASE;
  }

  function makeStore() {
    const baseUrl = getApiBase();
    const fetchImpl = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    return createStore({ baseUrl, fetchImpl, storage: window.localStorage });
  }

  function updateBackendBadge() {
    if (!trackBackend) return;
    const base = getApiBase();
    trackBackend.textContent = base ? 'D1 (Cloudflare)' : 'this browser (localStorage)';
    trackBackend.className = `backend-badge ${base ? 'd1' : 'local'}`;
  }

  function setTrackStatus(msg, level = '') {
    if (!trackingStatus) return;
    const line = document.createElement('div');
    line.className = `status-line ${level}`;
    line.textContent = msg;
    trackingStatus.appendChild(line);
    while (trackingStatus.children.length > 8) trackingStatus.removeChild(trackingStatus.firstChild);
  }

  function resolveProducts(order) {
    const lines = order.productLines && order.productLines.length
      ? order.productLines
      : (order.productText ? [order.productText] : []);
    return parseProductLines(lines).map((p) => {
      const detected = detectProduct(p.text);
      return { qty: p.qty, label: detected ? detected.label : p.text, text: p.text };
    });
  }

  function buildTrackingFromOrders() {
    const dbRows = trackingRows.filter((r) => r._origin === 'db');
    const today = new Date();
    const orderRows = orders.map((o, idx) => {
      const row = buildTrackingRow(
        { recipient: o.recipient, products: resolveProducts(o) },
        idx,
        today
      );
      row._origin = 'order';
      return row;
    });
    trackingRows = orderRows.concat(dbRows);
  }

  function initTracking() {
    if (!trackingHead) return;
    renderTrackingHeader();
    if (trackApiUrl) trackApiUrl.value = getApiBase();
    updateBackendBadge();
    if (trackSaveUrl) {
      trackSaveUrl.addEventListener('click', () => {
        const v = (trackApiUrl.value || '').trim().replace(/\/+$/, '');
        try { window.localStorage.setItem(API_BASE_KEY, v); } catch {}
        if (trackApiUrl) trackApiUrl.value = v;
        updateBackendBadge();
        setTrackStatus(
          v ? `Sync URL saved — saves now go to D1 at ${v}` : 'Sync URL cleared — saves go to this browser.',
          'ok'
        );
      });
    }
    if (trackLoadSaved) trackLoadSaved.addEventListener('click', loadSavedRows);
    renderTracking();
  }

  function renderTrackingHeader() {
    trackingHead.innerHTML = '';
    const tr = document.createElement('tr');
    for (const h of TRACKING_HEADERS.concat(['Actions'])) {
      const th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    }
    trackingHead.appendChild(tr);
  }

  function input(value, cls, onInput) {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = cls;
    el.value = value ?? '';
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }

  function dateInput(isoValue, onChange) {
    const el = document.createElement('input');
    el.type = 'date';
    el.className = 'w-md';
    if (isoValue) el.value = isoValue;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function renderTracking() {
    if (!trackingBody) return;
    trackingBody.innerHTML = '';
    trackingRows.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.id) tr.classList.add('saved');

      const tdMap = {};
      const cell = (key, node) => {
        const td = document.createElement('td');
        td.appendChild(node);
        tr.appendChild(td);
        tdMap[key] = node;
      };

      // day (dropdown) — linked to date + order number
      const daySel = document.createElement('select');
      for (const wd of WEEKDAYS) {
        const opt = document.createElement('option');
        opt.value = wd;
        opt.textContent = wd;
        if (wd === row.day) opt.selected = true;
        daySel.appendChild(opt);
      }
      daySel.addEventListener('change', () => {
        const base = fromISODate(row.isoDate) || new Date();
        const moved = setWeekdayWithinWeek(base, WEEKDAYS.indexOf(daySel.value));
        applyDate(row, moved, tdMap, false);
      });
      cell('day', daySel);

      // Date (calendar) — linked to day + order number
      cell('date', dateInput(row.isoDate, (iso) => {
        const d = fromISODate(iso);
        if (d) applyDate(row, d, tdMap, true);
      }));

      cell('orderNumber', input(row.orderNumber, 'w-md', (v) => { row.orderNumber = v; }));
      cell('trackingNumber', input(row.trackingNumber, 'w-md', (v) => { row.trackingNumber = v; }));
      cell('product', input(row.product, 'w-xl', (v) => { row.product = v; }));
      cell('quantity', input(row.quantity, 'w-sm', (v) => { row.quantity = v; }));
      cell('productDescription', input(row.productDescription, 'w-xl', (v) => { row.productDescription = v; }));
      cell('destCity', input(row.destCity, 'w-md', (v) => { row.destCity = v; }));
      cell('destState', input(row.destState, 'w-md', (v) => { row.destState = v; }));

      // Account dropdown
      const accSel = document.createElement('select');
      for (const a of ACCOUNTS) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === row.account) opt.selected = true;
        accSel.appendChild(opt);
      }
      accSel.addEventListener('change', () => { row.account = accSel.value; });
      cell('account', accSel);

      cell('client', input(row.client, 'w-md', (v) => { row.client = v; }));

      // Delivered on (calendar, empty by default)
      cell('deliveredOn', dateInput(row.deliveredOnIso || '', (iso) => {
        row.deliveredOnIso = iso;
        row.deliveredOn = iso ? formatDateDDMMYY(fromISODate(iso)) : '';
      }));

      cell('comments', input(row.comments, 'w-lg', (v) => { row.comments = v; }));
      cell('directionRemarks', input(row.directionRemarks, 'w-lg', (v) => { row.directionRemarks = v; }));

      // Actions
      const actTd = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = row.id ? 'Overwrite' : 'Save';
      saveBtn.addEventListener('click', () => saveRow(row));
      actions.appendChild(saveBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyRow(row));
      actions.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => removeRow(row));
      actions.appendChild(delBtn);

      actTd.appendChild(actions);
      tr.appendChild(actTd);

      trackingBody.appendChild(tr);
    });
  }

  // Apply a new Date to a row, syncing day / date / order-number controls.
  function applyDate(row, date, tdMap, fromCalendar) {
    row.isoDate = toISODate(date);
    row.date = formatDateDDMMYY(date);
    row.day = weekdayName(date);
    // Re-derive the order number only if the user hasn't manually overridden it.
    const seqMatch = String(row.orderNumber).match(/-(\d+)\s*$/);
    const seq = seqMatch ? seqMatch[1] : '1';
    row.orderNumber = orderNumberFor(date, seq);
    if (tdMap.day) tdMap.day.value = row.day;
    if (tdMap.date && !fromCalendar) tdMap.date.value = row.isoDate;
    if (tdMap.orderNumber) tdMap.orderNumber.value = row.orderNumber;
  }

  async function saveRow(row) {
    const store = makeStore();
    try {
      setTrackStatus(row.id ? `Overwriting id ${row.id}…` : 'Saving…');
      const saved = row.id ? await store.update(row.id, row) : await store.save(row);
      row.id = saved.id;
      setTrackStatus(
        `${row.id ? 'Saved' : 'Saved'} order ${row.orderNumber} (id ${saved.id}) to ${store.backend === 'd1' ? 'D1' : 'this browser'}.`,
        'ok'
      );
      renderTracking();
    } catch (err) {
      setTrackStatus(`Save failed: ${err.message}`, 'err');
    }
  }

  async function copyRow(row) {
    const text = trackingRowToCells(row).join('\t');
    try {
      await window.navigator.clipboard.writeText(text);
      setTrackStatus(`Copied order ${row.orderNumber} to clipboard (tab-separated).`, 'ok');
    } catch {
      setTrackStatus(`Copy unavailable here. Row:\n${text}`, 'warn');
    }
  }

  async function removeRow(row) {
    if (row.id) {
      const store = makeStore();
      try {
        await store.remove(row.id);
      } catch (err) {
        setTrackStatus(`Delete failed: ${err.message}`, 'err');
        return;
      }
    }
    trackingRows = trackingRows.filter((r) => r !== row);
    setTrackStatus('Row removed.', 'ok');
    renderTracking();
  }

  async function loadSavedRows() {
    const store = makeStore();
    try {
      setTrackStatus(`Loading saved rows from ${store.backend === 'd1' ? 'D1' : 'this browser'}…`);
      const saved = await store.list();
      const existingIds = new Set(trackingRows.filter((r) => r.id).map((r) => String(r.id)));
      let added = 0;
      for (const s of saved) {
        if (existingIds.has(String(s.id))) continue;
        const d = fromISODate(s.isoDate);
        trackingRows.push({
          ...s,
          isoDate: s.isoDate || '',
          deliveredOnIso: s.deliveredOnIso || '',
          _origin: 'db',
        });
        added += 1;
      }
      setTrackStatus(`Loaded ${saved.length} saved row(s); ${added} new added to the table.`, 'ok');
      renderTracking();
    } catch (err) {
      setTrackStatus(`Load failed: ${err.message}`, 'err');
    }
  }

  async function readDataTransfer(dt) {
    const items = dt.items ? Array.from(dt.items) : [];
    const out = [];
    if (items.length && typeof items[0].webkitGetAsEntry === 'function') {
      const entries = items.map((it) => it.webkitGetAsEntry()).filter(Boolean);
      await Promise.all(entries.map((e) => walkEntry(e, out)));
      return out;
    }
    return Array.from(dt.files);
  }

  async function walkEntry(entry, out) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      while (true) {
        const batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        if (!batch.length) break;
        all.push(...batch);
      }
      await Promise.all(all.map((e) => walkEntry(e, out)));
    }
  }

  return {
    get orders() { return orders; },
    ingestFiles,
  };
}
