import { dispatch } from './parsers/index.js';
import { readPdfText } from './pdfReader.js';
import { PRODUCTS, detectProduct, findProductByKey } from './data/midCodes.js';
import { buildFileName } from './excelExporter.js';
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
import { DEFAULT_MERCHANTS, SOURCE_TO_MERCHANT, detectMerchant, learnExample } from './data/merchants.js';
import { currentStock, suggestItemId, movementDedupKey, movementsToRows, toNum } from './data/stock.js';

export function createApp({ document, window, pdfjsLib, XLSX }) {
  const dropZone = document.getElementById('drop-zone');
  const filePicker = document.getElementById('file-picker');
  const folderPicker = document.getElementById('folder-picker');
  const clearBtn = document.getElementById('btn-clear');
  const downloadBtn = document.getElementById('btn-download');
  const cards = document.getElementById('cards');
  const statusEl = document.getElementById('status');
  const summary = document.getElementById('summary');

  // FedEx D1 controls
  const fedexAutosave = document.getElementById('chk-fedex-autosave');
  const fedexSaveAll = document.getElementById('btn-fedex-saveall');
  const fedexBackend = document.getElementById('fedex-backend');
  const fedexStatus = document.getElementById('fedex-status');

  // Saved tabs
  const savedFedexCards = document.getElementById('saved-fedex-cards');
  const savedFedexStatus = document.getElementById('saved-fedex-status');
  const savedFedexRefresh = document.getElementById('btn-saved-fedex-refresh');
  const savedFedexDownload = document.getElementById('btn-saved-fedex-download');
  const savedTrackHead = document.getElementById('saved-track-head');
  const savedTrackBody = document.getElementById('saved-track-body');
  const savedTrackStatus = document.getElementById('saved-track-status');
  const savedTrackRefresh = document.getElementById('btn-saved-track-refresh');

  // Merchants tab
  const merchantNew = document.getElementById('merchant-new');
  const merchantAdd = document.getElementById('btn-merchant-add');
  const merchantRefresh = document.getElementById('btn-merchant-refresh');
  const merchantStatus = document.getElementById('merchant-status');
  const merchantListEl = document.getElementById('merchant-list');

  // Stock tab
  const stockMerchantSel = document.getElementById('stock-merchant');
  const stockRefresh = document.getElementById('btn-stock-refresh');
  const stockFromTracking = document.getElementById('btn-stock-from-tracking');
  const stockAddManual = document.getElementById('btn-stock-add-manual');
  const stockPicker = document.getElementById('stock-tracking-picker');
  const stockPickerHead = document.getElementById('stock-picker-head');
  const stockPickerBody = document.getElementById('stock-picker-body');
  const stockPickerAdd = document.getElementById('btn-stock-picker-add');
  const stockPickerCancel = document.getElementById('btn-stock-picker-cancel');
  const stockStatus = document.getElementById('stock-status');
  const stockPendingHead = document.getElementById('stock-pending-head');
  const stockPendingBody = document.getElementById('stock-pending-body');
  const stockItemsHead = document.getElementById('stock-items-head');
  const stockItemsBody = document.getElementById('stock-items-body');
  const siName = document.getElementById('si-name');
  const siSection = document.getElementById('si-section');
  const siCountry = document.getElementById('si-country');
  const siBatch = document.getElementById('si-batch');
  const siExpiry = document.getElementById('si-expiry');
  const siOpening = document.getElementById('si-opening');
  const stockAddItem = document.getElementById('btn-stock-additem');

  // Tracking section elements
  const trackApiUrl = document.getElementById('track-api-url');
  const trackSaveUrl = document.getElementById('btn-track-save-url');
  const trackAutosave = document.getElementById('chk-track-autosave');
  const trackBackend = document.getElementById('track-backend');
  const trackingHead = document.getElementById('tracking-head');
  const trackingBody = document.getElementById('tracking-body');
  const trackingStatus = document.getElementById('tracking-status');

  const AUTOSAVE_KEYS = {
    fedex: 'pharmaconsulta_autosave_fedex',
    rows: 'pharmaconsulta_autosave_rows',
  };

  const API_BASE_KEY = 'pharmaconsulta_tracking_api_base';
  // Default Cloudflare Worker (D1) endpoint. Used unless the user overrides it
  // via the Sync API URL box (saving an explicit value — including blank).
  const DEFAULT_API_BASE = 'https://pharmaconsulta-tracking.labrint.workers.dev';
  // Proportional column widths (%) aligned with TRACKING_HEADERS + Actions.
  const TRACKING_COL_WIDTHS = [5, 6, 6, 6, 8, 4, 10, 7, 6, 7, 7, 6, 8, 8, 6];

  const headers = HEADER_ROW();
  let orders = [];
  let trackingRows = [];
  let savedTrackingRows = [];
  let savedFedexRows = [];
  let merchantsList = DEFAULT_MERCHANTS.map((name) => ({ name }));
  let learnedPatterns = [];
  let stockItems = [];
  let stockMoves = [];
  let stockMerchant = '';

  renderRows();

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
    trackingRows = [];
    statusEl.textContent = '';
    renderRows();
    renderAllTracking();
  });

  // Build + download an xlsx from rows of 52-cell arrays.
  function downloadCells(cellRows, filename, statusFn) {
    if (!cellRows.length) return;
    const aoa = [HEADER_ROW()].concat(cellRows);
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
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 200);
    if (statusFn) statusFn(`Downloaded ${filename}`, 'ok');
  }

  downloadBtn.addEventListener('click', () => {
    if (!orders.length) return;
    // Use each row's editable `cells` (kept in sync with inline edits and what
    // is saved to D1); fall back to a fresh buildRow for any row without them.
    const rows = orders.map((o, i) => o.cells || buildRow({ recipient: o.recipient, product: o.product }, i));
    downloadCells(rows, buildFileName(orders.length), setStatus);
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
    let skipped = 0;
    const beforeCount = orders.length;
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
          const md = detectMerchant(text, { source: order.source, learned: learnedPatterns });
          const dedupKey = `${hashText(text)}|${order.orderId || (order.recipient && order.recipient.name) || ''}`;
          // Skip an identical order already loaded this session (no dup cards).
          if (orders.some((o) => o.dedupKey === dedupKey)) { skipped += 1; continue; }
          orders.push({
            fileName: file.name,
            source: order.source,
            recipient: order.recipient,
            productText: order.productText,
            productLines: order.productLines || null,
            product: product || null,
            orderId: order.orderId || '',
            text,
            dedupKey,
            merchant: md ? md.merchant : '',
            merchantVia: md ? md.via : '',
          });
        }
        setStatus(`${file.name}: parsed (${parsed.length} order${parsed.length > 1 ? 's' : ''}).`, 'ok');
      } catch (err) {
        setStatus(`${file.name}: ${err.message}`, 'err');
      }
    }
    if (skipped) setStatus(`Skipped ${skipped} duplicate order(s) already loaded.`, 'warn');
    renderRows();
    buildTrackingFromOrders();
    renderAllTracking();
    // Autosave freshly ingested data if enabled.
    if (autosaveOn('fedex')) {
      orders.forEach((o, i) => {
        if (!o.fedexId && o.product && o.product.mid) saveFedexOrder(o, i, { silent: true });
      });
    }
    if (autosaveOn('rows')) {
      trackingRows.forEach((r) => { if (!r.id) saveRow(r, { silent: true }); });
    }
    // Offer to add the freshly parsed orders to the stock movement sheet.
    const added = orders.length - beforeCount;
    if (added > 0 && typeof window.confirm === 'function') {
      if (window.confirm(`Add ${added} parsed order(s) to the stock movement sheet as pending movements?`)) {
        await pullOrdersToPending();
        setStatus('Added to Stock as pending — review and confirm them in the Stock tab.', 'ok');
      }
    }
  }

  // Turn a camelCase column key into a readable, space-separated label so the
  // header wraps at word boundaries (e.g. "recipientContactName" -> "Recipient
  // Contact Name") instead of breaking letter-by-letter in narrow columns.
  function humanizeHeader(key) {
    if (/[\s(]/.test(key)) return key; // already friendly (File, Product (MID)...)
    const spaced = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // Render each shipment as a card. The 52 export fields flow in a responsive
  // grid that wraps onto as many lines as needed — every column is visible with
  // no horizontal scrolling, the values stay editable, and the export is
  // unaffected (the xlsx is rebuilt from `orders`, not the DOM).
  function renderRows() {
    cards.innerHTML = '';
    orders.forEach((o, idx) => {
      // Keep an editable copy of the row so inline edits persist into both the
      // export and what gets saved to D1. Recomputed when the product changes.
      if (!o.cells) o.cells = buildRow({ recipient: o.recipient, product: o.product }, idx);
      const cells = o.cells;
      const hasResolvedProduct = !!o.product && !!o.product.mid;

      const card = document.createElement('div');
      card.className = `card${hasResolvedProduct ? '' : ' invalid'}`;

      // Card header: index, file, source, product picker, save/copy/delete.
      const head = document.createElement('div');
      head.className = 'card-head';

      const num = document.createElement('span');
      num.className = 'card-num';
      num.textContent = `#${idx + 1}`;
      head.appendChild(num);

      const file = document.createElement('span');
      file.className = 'card-file';
      file.textContent = o.fileName || '';
      head.appendChild(file);

      const src = document.createElement('span');
      src.className = 'badge';
      src.textContent = o.source || '';
      head.appendChild(src);

      // Merchant dropdown (auto-detected, learns from corrections).
      const merchSel = document.createElement('select');
      merchSel.className = 'card-merchant';
      merchSel.title = o.merchantVia === 'format'
        ? 'Detected from the PDF format'
        : (o.merchantVia === 'learned' ? 'Detected from a learned pattern' : 'Pick the merchant to teach detection');
      const mEmpty = document.createElement('option');
      mEmpty.value = '';
      mEmpty.textContent = '— merchant —';
      merchSel.appendChild(mEmpty);
      for (const m of merchantsList) {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        if (o.merchant === m.name) opt.selected = true;
        merchSel.appendChild(opt);
      }
      merchSel.addEventListener('change', () => {
        o.merchant = merchSel.value;
        o.merchantVia = 'manual';
        if (o.merchant) learnMerchant(o);
      });
      head.appendChild(merchSel);

      const sel = document.createElement('select');
      sel.className = 'card-product';
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
        orders[idx].product = findProductByKey(sel.value) || null;
        orders[idx].cells = buildRow({ recipient: orders[idx].recipient, product: orders[idx].product }, idx);
        renderRows();
        if (autosaveOn('fedex') && orders[idx].product && orders[idx].product.mid) {
          scheduleAutosave(orders[idx], () => saveFedexOrder(orders[idx], idx, { silent: true }));
        }
      });
      head.appendChild(sel);

      if (!hasResolvedProduct) {
        const warn = document.createElement('span');
        warn.className = 'badge err';
        warn.textContent = 'no MID — pick a product';
        head.appendChild(warn);
      }

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = o.fedexId ? 'Overwrite' : 'Save';
      saveBtn.disabled = !hasResolvedProduct;
      saveBtn.title = hasResolvedProduct ? '' : 'Pick a product first';
      saveBtn.addEventListener('click', () => saveFedexOrder(o, idx));
      actions.appendChild(saveBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyFedexOrder(o));
      actions.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => removeFedexOrder(o));
      actions.appendChild(delBtn);

      head.appendChild(actions);
      card.appendChild(head);

      // Field grid.
      card.appendChild(buildFieldGrid(cells, (colIdx, text) => {
        o.cells[colIdx] = text;
        if (autosaveOn('fedex') && o.product && o.product.mid) {
          scheduleAutosave(o, () => saveFedexOrder(o, idx, { silent: true }));
        }
      }));

      cards.appendChild(card);
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

  // Small stable string hash (djb2) for content-based de-dup keys.
  function hashText(str) {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Editable label+value grid for the 52 cells. onEdit(colIdx, text) on input.
  function buildFieldGrid(cells, onEdit) {
    const grid = document.createElement('div');
    grid.className = 'fields';
    cells.forEach((value, colIdx) => {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('span');
      label.className = 'flabel';
      label.textContent = humanizeHeader(headers[colIdx]);
      field.appendChild(label);
      const val = document.createElement('div');
      val.className = 'fval';
      val.setAttribute('contenteditable', 'true');
      val.dataset.colIdx = colIdx;
      val.textContent = value;
      val.addEventListener('input', () => onEdit(colIdx, val.textContent));
      field.appendChild(val);
      grid.appendChild(field);
    });
    return grid;
  }

  // ---- FedEx D1 persistence ----

  function setFedexStatus(msg, level = '') {
    if (!fedexStatus) return;
    const line = document.createElement('div');
    line.className = `status-line ${level}`;
    line.textContent = msg;
    fedexStatus.appendChild(line);
    while (fedexStatus.children.length > 8) fedexStatus.removeChild(fedexStatus.firstChild);
  }

  function updateFedexBackend() {
    if (!fedexBackend) return;
    const base = getApiBase();
    fedexBackend.textContent = base ? 'D1 (Cloudflare)' : 'this browser (localStorage)';
    fedexBackend.className = `backend-badge ${base ? 'd1' : 'local'}`;
  }

  function recordForOrder(o, idx) {
    const cells = o.cells || buildRow({ recipient: o.recipient, product: o.product }, idx);
    return {
      fileName: o.fileName || '',
      source: o.source || '',
      productKey: o.product ? o.product.key : '',
      productMid: o.product ? o.product.mid : '',
      recipientName: o.recipient ? o.recipient.name || '' : '',
      cells,
      dedupKey: o.dedupKey || '',
    };
  }

  async function saveFedexOrder(o, idx, { silent = false } = {}) {
    if (!o.product || !o.product.mid) {
      if (!silent) setFedexStatus('Pick a product before saving this shipment.', 'warn');
      return;
    }
    const store = makeStore('fedex');
    try {
      if (!silent) setFedexStatus(o.fedexId ? `Overwriting id ${o.fedexId}…` : 'Saving…');
      const rec = recordForOrder(o, idx);
      const saved = o.fedexId ? await store.update(o.fedexId, rec) : await store.save(rec);
      o.fedexId = saved.id;
      setFedexStatus(
        `${silent ? 'Autosaved' : 'Saved'} ${o.recipient && o.recipient.name ? o.recipient.name : 'shipment'} (id ${saved.id}) to ${store.backend === 'd1' ? 'D1' : 'this browser'}.`,
        'ok'
      );
      // Don't re-render on a silent autosave — it would steal focus mid-typing.
      if (!silent) renderRows();
    } catch (err) {
      setFedexStatus(`Save failed: ${err.message}`, 'err');
    }
  }

  async function copyFedexOrder(o, idx) {
    const cells = o.cells || buildRow({ recipient: o.recipient, product: o.product }, idx);
    const text = cells.join('\t');
    try {
      await window.navigator.clipboard.writeText(text);
      setFedexStatus('Shipment row copied to clipboard (tab-separated).', 'ok');
    } catch {
      setFedexStatus(`Copy unavailable here. Row:\n${text}`, 'warn');
    }
  }

  async function removeFedexOrder(o) {
    if (o.fedexId) {
      const store = makeStore('fedex');
      try {
        await store.remove(o.fedexId);
      } catch (err) {
        setFedexStatus(`Delete failed: ${err.message}`, 'err');
        return;
      }
    }
    orders = orders.filter((x) => x !== o);
    setFedexStatus('Shipment removed.', 'ok');
    renderRows();
  }

  async function saveAllFedex() {
    const savable = orders.filter((o) => o.product && o.product.mid);
    if (!savable.length) {
      setFedexStatus('No shipments with a product to save.', 'warn');
      return;
    }
    setFedexStatus(`Saving ${savable.length} shipment(s)…`);
    for (let i = 0; i < orders.length; i++) {
      if (orders[i].product && orders[i].product.mid) {
        // eslint-disable-next-line no-await-in-loop
        await saveFedexOrder(orders[i], i, { silent: true });
      }
    }
    setFedexStatus(`Saved ${savable.length} shipment(s).`, 'ok');
  }

  function initFedex() {
    updateFedexBackend();
    if (fedexAutosave) {
      fedexAutosave.checked = autosaveOn('fedex');
      fedexAutosave.addEventListener('change', () => {
        setAutosave('fedex', fedexAutosave.checked);
        setFedexStatus(fedexAutosave.checked ? 'Autosave on — shipments save to D1 as you edit.' : 'Autosave off.', 'ok');
      });
    }
    if (fedexSaveAll) fedexSaveAll.addEventListener('click', saveAllFedex);
  }

  // ---- Generic status helper ----
  function setStatusInto(el, msg, level = '') {
    if (!el) return;
    const line = document.createElement('div');
    line.className = `status-line ${level}`;
    line.textContent = msg;
    el.appendChild(line);
    while (el.children.length > 8) el.removeChild(el.firstChild);
  }

  // ---- Tabs ----
  function initTabs() {
    const settingsBtn = document.getElementById('btn-settings');
    const settingsBar = document.getElementById('global-settings');
    if (settingsBtn && settingsBar) {
      settingsBtn.addEventListener('click', () => settingsBar.classList.toggle('hidden'));
    }
    const tabs = [
      ['tab-builder', 'panel-builder'],
      ['tab-fedex', 'panel-fedex'],
      ['tab-tracking', 'panel-tracking'],
      ['tab-stock', 'panel-stock'],
      ['tab-merchants', 'panel-merchants'],
    ];
    const els = tabs.map(([t, p]) => ({
      btn: document.getElementById(t),
      panel: document.getElementById(p),
    }));
    els.forEach(({ btn }, i) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        els.forEach(({ btn: b, panel }) => {
          if (b) b.classList.remove('active');
          if (panel) panel.classList.remove('active');
        });
        if (els[i].btn) els[i].btn.classList.add('active');
        if (els[i].panel) els[i].panel.classList.add('active');
        // Lazily refresh saved tabs the first time they're opened.
        if (tabs[i][1] === 'panel-fedex' && !savedFedexRows.length) loadSavedFedex();
        if (tabs[i][1] === 'panel-tracking' && !savedTrackingRows.length) loadSavedRows();
        if (tabs[i][1] === 'panel-stock' && !stockItems.length && !stockMoves.length) loadStock();
      });
    });
  }

  // ---- Saved FedEx tab ----
  async function loadSavedFedex() {
    const store = makeStore('fedex');
    const status = (m, l) => setStatusInto(savedFedexStatus, m, l);
    try {
      status(`Loading saved shipments from ${store.backend === 'd1' ? 'D1' : 'this browser'}…`);
      savedFedexRows = await store.list();
      status(`Loaded ${savedFedexRows.length} saved shipment(s).`, 'ok');
      renderSavedFedex();
    } catch (err) {
      status(`Load failed: ${err.message}`, 'err');
    }
  }

  function renderSavedFedex() {
    if (!savedFedexCards) return;
    savedFedexCards.innerHTML = '';
    if (!savedFedexRows.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-hint';
      empty.textContent = 'No saved shipments yet. Save some from the Builder tab, then Refresh.';
      savedFedexCards.appendChild(empty);
    }
    savedFedexRows.forEach((s) => {
      if (!Array.isArray(s.cells)) s.cells = [];
      const card = document.createElement('div');
      card.className = 'card collapsed';

      const head = document.createElement('div');
      head.className = 'card-head';

      const num = document.createElement('span');
      num.className = 'card-num';
      num.textContent = `#${s.id}`;
      head.appendChild(num);

      const who = document.createElement('span');
      who.textContent = `${s.recipientName || '—'} · ${s.productKey || '—'} (${s.productMid || '—'})`;
      head.appendChild(who);

      const fileBadge = document.createElement('span');
      fileBadge.className = 'card-file';
      fileBadge.textContent = s.fileName || '';
      head.appendChild(fileBadge);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'View / edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.toggle('collapsed');
      });
      actions.appendChild(editBtn);

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = 'Overwrite';
      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await makeStore('fedex').update(s.id, s);
          setStatusInto(savedFedexStatus, `Saved changes to id ${s.id}.`, 'ok');
        } catch (err) {
          setStatusInto(savedFedexStatus, `Save failed: ${err.message}`, 'err');
        }
      });
      actions.appendChild(saveBtn);

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadCells([s.cells], buildFileName(1), (m, l) => setStatusInto(savedFedexStatus, m, l));
      });
      actions.appendChild(dlBtn);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = s.cells.join('\t');
        try {
          await window.navigator.clipboard.writeText(text);
          setStatusInto(savedFedexStatus, 'Row copied (tab-separated).', 'ok');
        } catch {
          setStatusInto(savedFedexStatus, `Copy unavailable. Row:\n${text}`, 'warn');
        }
      });
      actions.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await makeStore('fedex').remove(s.id);
          savedFedexRows = savedFedexRows.filter((r) => r !== s);
          setStatusInto(savedFedexStatus, `Deleted id ${s.id}.`, 'ok');
          renderSavedFedex();
        } catch (err) {
          setStatusInto(savedFedexStatus, `Delete failed: ${err.message}`, 'err');
        }
      });
      actions.appendChild(delBtn);

      head.appendChild(actions);
      head.addEventListener('click', () => card.classList.toggle('collapsed'));
      card.appendChild(head);

      // Editable field grid (hidden while collapsed).
      card.appendChild(buildFieldGrid(s.cells, (colIdx, text) => { s.cells[colIdx] = text; }));

      savedFedexCards.appendChild(card);
    });
  }

  // ---- Merchants ----
  async function loadMerchants() {
    const store = makeStore('merchants');
    try {
      const list = await store.list();
      if (list && list.length) {
        merchantsList = list;
      } else {
        // Seed the defaults into the store on first run.
        merchantsList = [];
        for (const name of DEFAULT_MERCHANTS) {
          // eslint-disable-next-line no-await-in-loop
          const saved = await store.save({ name });
          merchantsList.push(saved);
        }
      }
    } catch {
      merchantsList = DEFAULT_MERCHANTS.map((name) => ({ name }));
    }
    renderMerchants();
    renderRows();
    renderStock();
  }

  async function loadLearnedPatterns() {
    try {
      learnedPatterns = await makeStore('patterns').list();
    } catch {
      learnedPatterns = [];
    }
  }

  function renderMerchants() {
    if (!merchantListEl) return;
    merchantListEl.innerHTML = '';
    merchantsList.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'merchant-row';
      const name = document.createElement('span');
      name.className = 'merchant-name';
      const count = learnedPatterns.filter((p) => p.merchant === m.name).length;
      name.textContent = count ? `${m.name}  (${count} learned)` : m.name;
      row.appendChild(name);
      if (m.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'danger';
        del.textContent = 'Delete';
        del.addEventListener('click', () => deleteMerchant(m));
        row.appendChild(del);
      }
      merchantListEl.appendChild(row);
    });
  }

  async function addMerchant() {
    const name = (merchantNew && merchantNew.value || '').trim();
    if (!name) return;
    if (merchantsList.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      setStatusInto(merchantStatus, `${name} already exists.`, 'warn');
      return;
    }
    try {
      const saved = await makeStore('merchants').save({ name });
      merchantsList.push(saved);
      if (merchantNew) merchantNew.value = '';
      setStatusInto(merchantStatus, `Added ${name}.`, 'ok');
      renderMerchants();
      renderRows();
    } catch (err) {
      setStatusInto(merchantStatus, `Add failed: ${err.message}`, 'err');
    }
  }

  async function deleteMerchant(m) {
    try {
      if (m.id) await makeStore('merchants').remove(m.id);
      merchantsList = merchantsList.filter((x) => x !== m);
      setStatusInto(merchantStatus, `Removed ${m.name}.`, 'ok');
      renderMerchants();
      renderRows();
    } catch (err) {
      setStatusInto(merchantStatus, `Delete failed: ${err.message}`, 'err');
    }
  }

  // Teach the detector: store this PDF's fingerprint -> merchant.
  async function learnMerchant(o) {
    if (!o.text || !o.merchant) return;
    const example = learnExample(o.text, o.merchant, o.fileName || '');
    learnedPatterns.push(example);
    try {
      await makeStore('patterns').save(example);
      setFedexStatus(`Learned ${o.merchant} from this format.`, 'ok');
    } catch (err) {
      setFedexStatus(`Couldn't save learned pattern: ${err.message}`, 'warn');
    }
  }

  function initMerchants() {
    if (merchantAdd) merchantAdd.addEventListener('click', addMerchant);
    if (merchantNew) {
      merchantNew.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMerchant(); });
    }
    if (merchantRefresh) {
      merchantRefresh.addEventListener('click', async () => {
        await loadLearnedPatterns();
        await loadMerchants();
      });
    }
    if (savedFedexRefresh) savedFedexRefresh.addEventListener('click', loadSavedFedex);
    if (savedFedexDownload) {
      savedFedexDownload.addEventListener('click', () => {
        const rows = savedFedexRows.map((s) => (Array.isArray(s.cells) ? s.cells : [])).filter((c) => c.length);
        if (!rows.length) {
          setStatusInto(savedFedexStatus, 'Nothing to download — Refresh first.', 'warn');
          return;
        }
        downloadCells(rows, buildFileName(rows.length), (m, l) => setStatusInto(savedFedexStatus, m, l));
      });
    }
    renderMerchants();
  }

  // ---- Stock ----
  function initStock() {
    if (stockRefresh) stockRefresh.addEventListener('click', loadStock);
    if (stockFromTracking) stockFromTracking.addEventListener('click', openTrackingPicker);
    if (stockAddManual) stockAddManual.addEventListener('click', addManualMove);
    if (stockPickerAdd) stockPickerAdd.addEventListener('click', addSelectedTracking);
    if (stockPickerCancel) {
      stockPickerCancel.addEventListener('click', () => { if (stockPicker) stockPicker.classList.add('hidden'); });
    }
    if (stockAddItem) stockAddItem.addEventListener('click', addStockItem);
    if (stockMerchantSel) {
      stockMerchantSel.addEventListener('change', () => {
        stockMerchant = stockMerchantSel.value;
        renderStock();
      });
    }
    renderStock();
  }

  async function loadStock() {
    try {
      setStatusInto(stockStatus, 'Loading stock…');
      [stockItems, stockMoves] = await Promise.all([
        makeStore('stockitems').list(),
        makeStore('stockmoves').list(),
      ]);
      setStatusInto(stockStatus, `Loaded ${stockItems.length} item(s), ${stockMoves.length} movement(s).`, 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Load failed: ${err.message}`, 'err');
    }
  }

  function merchantNames() {
    return merchantsList.map((m) => m.name).filter(Boolean);
  }

  function fillMerchantSelect(sel, value) {
    sel.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— all merchants —';
    sel.appendChild(blank);
    for (const name of merchantNames()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === value) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // Create pending movements from the orders currently loaded in the Builder.
  async function pullOrdersToPending() {
    if (!orders.length) {
      setStatusInto(stockStatus, 'No orders loaded in the Builder.', 'warn');
      return;
    }
    const store = makeStore('stockmoves');
    let made = 0;
    let skippedNoMerchant = 0;
    const today = toISODate(new Date());
    for (const o of orders) {
      if (!o.merchant) { skippedNoMerchant += 1; continue; }
      const products = resolveProducts(o);
      for (const p of products) {
        const dedupKey = movementDedupKey(o.dedupKey, p.label);
        if (stockMoves.some((m) => m.dedupKey === dedupKey)) continue;
        const move = {
          merchant: o.merchant,
          itemId: suggestItemId(stockItems, o.merchant, p.key) || '',
          product: p.label,
          qty: String(-Math.abs(toNum(p.qty) || 1)),
          date: today,
          country: '',
          batch: '',
          section: '',
          status: 'pending',
          orderKey: o.dedupKey || '',
          note: '',
          dedupKey,
        };
        try {
          // eslint-disable-next-line no-await-in-loop
          const saved = await store.save(move);
          saved._matchKey = p.key;
          // Replace if dedup returned an existing row, else add.
          const existingIdx = stockMoves.findIndex((m) => String(m.id) === String(saved.id));
          if (existingIdx >= 0) stockMoves[existingIdx] = saved; else stockMoves.push(saved);
          made += 1;
        } catch (err) {
          setStatusInto(stockStatus, `Save failed: ${err.message}`, 'err');
        }
      }
    }
    let msg = `Added ${made} pending movement(s).`;
    if (skippedNoMerchant) msg += ` Skipped ${skippedNoMerchant} order(s) with no merchant set.`;
    setStatusInto(stockStatus, msg, made ? 'ok' : 'warn');
    renderStock();
  }

  // --- Pull from the tracking sheet (select which rows) ---
  async function openTrackingPicker() {
    if (!stockMerchant) {
      setStatusInto(stockStatus, 'Pick a merchant above first — pulled rows are filed under it.', 'warn');
      return;
    }
    if (!savedTrackingRows.length) await loadSavedRows();
    renderTrackingPicker();
    if (stockPicker) stockPicker.classList.remove('hidden');
    if (!savedTrackingRows.length) {
      setStatusInto(stockStatus, 'No saved tracking rows yet — save some from the Builder first.', 'warn');
    }
  }

  function renderTrackingPicker() {
    if (!stockPickerHead || !stockPickerBody) return;
    stockPickerHead.innerHTML = '';
    const htr = document.createElement('tr');
    for (const h of ['Add', 'Date', 'Order #', 'Client', 'Product', 'Quantity']) {
      const th = document.createElement('th');
      th.textContent = h;
      htr.appendChild(th);
    }
    stockPickerHead.appendChild(htr);

    stockPickerBody.innerHTML = '';
    savedTrackingRows.forEach((row) => {
      const tr = document.createElement('tr');
      const td = (node) => { const c = document.createElement('td'); if (typeof node === 'string') c.textContent = node; else c.appendChild(node); tr.appendChild(c); };
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.id = row.id != null ? row.id : '';
      row._pick = cb;
      td(cb);
      td(row.date || '');
      td(row.orderNumber || '');
      td(row.client || '');
      td(row.product || '');
      td(row.quantity || '');
      stockPickerBody.appendChild(tr);
    });
  }

  async function addSelectedTracking() {
    const chosen = savedTrackingRows.filter((r) => r._pick && r._pick.checked);
    if (!chosen.length) { setStatusInto(stockStatus, 'Tick at least one tracking row.', 'warn'); return; }
    const store = makeStore('stockmoves');
    let made = 0;
    for (const row of chosen) {
      const products = String(row.product || '').split(',').map((s) => s.trim()).filter(Boolean);
      const qtys = String(row.quantity || '').split(',').map((s) => s.trim());
      for (let i = 0; i < products.length; i += 1) {
        const label = products[i];
        const qtyNum = Math.abs(toNum(qtys[i])) || 1;
        const orderKey = `track-${row.id || row.orderNumber}`;
        const dedupKey = movementDedupKey(orderKey, label);
        if (stockMoves.some((m) => m.dedupKey === dedupKey)) continue;
        const move = {
          merchant: stockMerchant,
          itemId: '',
          product: label,
          qty: String(-qtyNum),
          date: row.isoDate || row.date || toISODate(new Date()),
          country: row.destState || '',
          batch: '',
          section: '',
          status: 'pending',
          orderKey,
          note: 'from tracking',
          dedupKey,
        };
        try {
          // eslint-disable-next-line no-await-in-loop
          const saved = await store.save(move);
          const idx = stockMoves.findIndex((m) => String(m.id) === String(saved.id));
          if (idx >= 0) stockMoves[idx] = saved; else stockMoves.push(saved);
          made += 1;
        } catch (err) {
          setStatusInto(stockStatus, `Save failed: ${err.message}`, 'err');
        }
      }
    }
    if (stockPicker) stockPicker.classList.add('hidden');
    setStatusInto(stockStatus, `Added ${made} pending movement(s) from ${chosen.length} tracking row(s).`, made ? 'ok' : 'warn');
    renderStock();
  }

  // Add a blank pending movement to fill in by hand (back-entry).
  async function addManualMove() {
    const merchant = stockMerchant || (merchantNames()[0] || '');
    const move = {
      merchant,
      itemId: '',
      product: 'Manual entry',
      qty: '-1',
      date: toISODate(new Date()),
      country: '',
      batch: '',
      section: '',
      status: 'pending',
      orderKey: '',
      note: 'manual',
      dedupKey: `manual-${Date.now()}`,
    };
    try {
      const saved = await makeStore('stockmoves').save(move);
      stockMoves.push(saved);
      setStatusInto(stockStatus, 'Added a blank pending movement — map an item, set qty/date, then Confirm.', 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Add failed: ${err.message}`, 'err');
    }
  }

  function itemsForMerchant(merchant) {
    return stockItems.filter((i) => !merchant || i.merchant === merchant);
  }

  async function addStockItem() {
    const name = (siName && siName.value || '').trim();
    if (!name) { setStatusInto(stockStatus, 'Item needs a name.', 'warn'); return; }
    const merchant = stockMerchant || (merchantNames()[0] || '');
    const item = {
      merchant,
      name,
      section: (siSection && siSection.value || '').trim(),
      country: (siCountry && siCountry.value || '').trim(),
      batch: (siBatch && siBatch.value || '').trim(),
      expiry: (siExpiry && siExpiry.value || '').trim(),
      opening: String(toNum(siOpening && siOpening.value)),
      matchKey: '',
    };
    try {
      const saved = await makeStore('stockitems').save(item);
      stockItems.push(saved);
      [siName, siSection, siCountry, siBatch, siExpiry, siOpening].forEach((el) => { if (el) el.value = ''; });
      setStatusInto(stockStatus, `Added item "${name}"${merchant ? ` for ${merchant}` : ''}.`, 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Add item failed: ${err.message}`, 'err');
    }
  }

  async function saveStockItem(item) {
    try {
      await makeStore('stockitems').update(item.id, item);
      setStatusInto(stockStatus, `Saved item "${item.name}".`, 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Save failed: ${err.message}`, 'err');
    }
  }

  async function deleteStockItem(item) {
    try {
      await makeStore('stockitems').remove(item.id);
      stockItems = stockItems.filter((i) => i !== item);
      setStatusInto(stockStatus, `Deleted item "${item.name}".`, 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Delete failed: ${err.message}`, 'err');
    }
  }

  async function confirmMove(move) {
    if (!move.itemId) { setStatusInto(stockStatus, 'Assign a stock item before confirming.', 'warn'); return; }
    move.status = 'confirmed';
    try {
      await makeStore('stockmoves').update(move.id, move);
      setStatusInto(stockStatus, `Confirmed: ${move.qty} of ${move.product}.`, 'ok');
      renderStock();
    } catch (err) {
      move.status = 'pending';
      setStatusInto(stockStatus, `Confirm failed: ${err.message}`, 'err');
    }
  }

  async function deleteMove(move) {
    try {
      if (move.id) await makeStore('stockmoves').remove(move.id);
      stockMoves = stockMoves.filter((m) => m !== move);
      setStatusInto(stockStatus, 'Movement removed.', 'ok');
      renderStock();
    } catch (err) {
      setStatusInto(stockStatus, `Delete failed: ${err.message}`, 'err');
    }
  }

  // When a movement is assigned to an item, teach that item the product key.
  async function assignMoveItem(move, itemId) {
    move.itemId = itemId;
    const item = stockItems.find((i) => String(i.id) === String(itemId));
    if (item && !item.matchKey && move._matchKey) {
      item.matchKey = move._matchKey;
      try { await makeStore('stockitems').update(item.id, item); } catch {}
    }
    try { if (move.id) await makeStore('stockmoves').update(move.id, move); } catch {}
  }

  async function copyConfirmedMoves() {
    const moves = stockMoves.filter((m) => !stockMerchant || m.merchant === stockMerchant);
    const rows = movementsToRows(moves, stockItems);
    if (!rows.length) { setStatusInto(stockStatus, 'No confirmed movements to copy.', 'warn'); return; }
    const header = ['Date', 'Item', 'Qty', 'Country', 'Batch', 'Section'];
    const text = [header].concat(rows).map((r) => r.join('\t')).join('\n');
    try {
      await window.navigator.clipboard.writeText(text);
      setStatusInto(stockStatus, `Copied ${rows.length} confirmed movement(s).`, 'ok');
    } catch {
      setStatusInto(stockStatus, `Copy unavailable. Rows:\n${text}`, 'warn');
    }
  }

  function renderStock() {
    if (stockMerchantSel) fillMerchantSelect(stockMerchantSel, stockMerchant);
    renderStockPending();
    renderStockItems();
  }

  function makeStockInput(value, onInput, cls = 'w-md') {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = cls;
    el.value = value == null ? '' : String(value);
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }

  function renderStockPending() {
    if (!stockPendingHead || !stockPendingBody) return;
    stockPendingHead.innerHTML = '';
    const htr = document.createElement('tr');
    for (const h of ['Date', 'Merchant', 'Product', 'Stock item', 'Qty', 'Country', 'Batch', 'Section', 'Actions']) {
      const th = document.createElement('th');
      th.textContent = h;
      htr.appendChild(th);
    }
    stockPendingHead.appendChild(htr);

    stockPendingBody.innerHTML = '';
    const pending = stockMoves.filter((m) => m.status !== 'confirmed' && (!stockMerchant || m.merchant === stockMerchant));
    pending.forEach((move) => {
      const tr = document.createElement('tr');
      const cell = (node) => { const td = document.createElement('td'); td.appendChild(node); tr.appendChild(td); };
      const txt = (s) => { const sp = document.createElement('span'); sp.textContent = s == null ? '' : String(s); return sp; };

      cell(makeStockInput(move.date, (v) => { move.date = v; }, 'w-md'));
      cell(txt(move.merchant));
      cell(makeStockInput(move.product, (v) => { move.product = v; }, 'w-md'));

      // Stock item dropdown (only this merchant's items).
      const sel = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— map to item —';
      sel.appendChild(blank);
      for (const it of itemsForMerchant(move.merchant)) {
        const opt = document.createElement('option');
        opt.value = it.id;
        opt.textContent = `${it.name}${it.country ? ` [${it.country}]` : ''}${it.batch ? ` ·${it.batch}` : ''}`;
        if (String(move.itemId) === String(it.id)) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => assignMoveItem(move, sel.value));
      cell(sel);

      cell(makeStockInput(move.qty, (v) => { move.qty = v; }, 'w-sm'));
      cell(makeStockInput(move.country, (v) => { move.country = v; }, 'w-sm'));
      cell(makeStockInput(move.batch, (v) => { move.batch = v; }, 'w-sm'));
      cell(makeStockInput(move.section, (v) => { move.section = v; }, 'w-md'));

      const actTd = document.createElement('td');
      const act = document.createElement('div');
      act.className = 'row-actions';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'primary';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.addEventListener('click', () => confirmMove(move));
      act.appendChild(confirmBtn);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteMove(move));
      act.appendChild(delBtn);
      actTd.appendChild(act);
      tr.appendChild(actTd);

      stockPendingBody.appendChild(tr);
    });
    if (!pending.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.className = 'empty-cell';
      td.textContent = 'No pending movements. Use “Pull loaded orders → pending” from the Builder batch.';
      tr.appendChild(td);
      stockPendingBody.appendChild(tr);
    }
  }

  function renderStockItems() {
    if (!stockItemsHead || !stockItemsBody) return;
    stockItemsHead.innerHTML = '';
    const htr = document.createElement('tr');
    for (const h of ['Item', 'Section', 'Country', 'Batch', 'Expiry', 'Opening', 'Current', 'Actions']) {
      const th = document.createElement('th');
      th.textContent = h;
      htr.appendChild(th);
    }
    stockItemsHead.appendChild(htr);

    stockItemsBody.innerHTML = '';
    const items = itemsForMerchant(stockMerchant);
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const cell = (node) => { const td = document.createElement('td'); td.appendChild(node); tr.appendChild(td); };
      cell(makeStockInput(item.name, (v) => { item.name = v; }, 'w-lg'));
      cell(makeStockInput(item.section, (v) => { item.section = v; }, 'w-md'));
      cell(makeStockInput(item.country, (v) => { item.country = v; }, 'w-sm'));
      cell(makeStockInput(item.batch, (v) => { item.batch = v; }, 'w-sm'));
      cell(makeStockInput(item.expiry, (v) => { item.expiry = v; }, 'w-sm'));
      cell(makeStockInput(item.opening, (v) => { item.opening = v; }, 'w-sm'));

      const cur = document.createElement('td');
      const curN = currentStock(item, stockMoves);
      cur.innerHTML = `<strong>${curN}</strong>`;
      if (curN < 0) cur.style.color = 'var(--err)';
      tr.appendChild(cur);

      const actTd = document.createElement('td');
      const act = document.createElement('div');
      act.className = 'row-actions';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'primary';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => saveStockItem(item));
      act.appendChild(saveBtn);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteStockItem(item));
      act.appendChild(delBtn);
      actTd.appendChild(act);
      tr.appendChild(actTd);

      stockItemsBody.appendChild(tr);
    });
    if (!items.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'empty-cell';
      td.textContent = stockMerchant ? `No items for ${stockMerchant} yet — add some above.` : 'Pick a merchant and add items above.';
      tr.appendChild(td);
      stockItemsBody.appendChild(tr);
    }
  }

  // ---- Tracking section ----

  function getApiBase() {
    try {
      const stored = window.localStorage.getItem(API_BASE_KEY);
      if (stored !== null) return stored.trim();
    } catch {}
    return DEFAULT_API_BASE;
  }

  function makeStore(resource = 'rows') {
    const baseUrl = getApiBase();
    const fetchImpl = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    return createStore({ baseUrl, fetchImpl, storage: window.localStorage, resource });
  }

  // App settings: cached in memory, mirrored to localStorage, shared via D1.
  // Autosave defaults ON unless explicitly turned off.
  const settingsCache = {};
  function getSetting(key, dflt) {
    if (Object.prototype.hasOwnProperty.call(settingsCache, key)) return settingsCache[key];
    try {
      const v = window.localStorage.getItem(key);
      if (v !== null) return v;
    } catch {}
    return dflt;
  }
  function setSetting(key, value) {
    settingsCache[key] = value;
    try { window.localStorage.setItem(key, value); } catch {}
    // Mirror to D1 (fire-and-forget).
    makeStore('settings').save({ key, value, dedupKey: key }).catch(() => {});
  }
  async function loadSettings() {
    try {
      const list = await makeStore('settings').list();
      for (const s of list) {
        if (s && s.key) {
          settingsCache[s.key] = s.value;
          try { window.localStorage.setItem(s.key, s.value); } catch {}
        }
      }
    } catch {}
    refreshAutosaveChecks();
  }
  function autosaveOn(section) {
    return getSetting(AUTOSAVE_KEYS[section], '1') !== '0';
  }
  function setAutosave(section, on) {
    setSetting(AUTOSAVE_KEYS[section], on ? '1' : '0');
  }
  function refreshAutosaveChecks() {
    if (fedexAutosave) fedexAutosave.checked = autosaveOn('fedex');
    if (trackAutosave) trackAutosave.checked = autosaveOn('rows');
  }
  // Debounced autosave timers keyed by the row/order object.
  const autosaveTimers = new WeakMap();
  function scheduleAutosave(obj, fn) {
    const prev = autosaveTimers.get(obj);
    if (prev) window.clearTimeout(prev);
    autosaveTimers.set(obj, window.setTimeout(fn, 1000));
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
      return { qty: p.qty, label: detected ? detected.label : p.text, text: p.text, key: detected ? detected.key : '' };
    });
  }

  function buildTrackingFromOrders() {
    const today = new Date();
    trackingRows = orders.map((o, idx) => {
      const row = buildTrackingRow(
        { recipient: o.recipient, products: resolveProducts(o) },
        idx,
        today
      );
      row._origin = 'order';
      row.dedupKey = o.dedupKey || '';
      return row;
    });
  }

  function initTracking() {
    renderTrackingHeader(trackingHead);
    renderTrackingHeader(savedTrackHead);
    if (trackApiUrl) trackApiUrl.value = getApiBase();
    updateBackendBadge();
    if (trackSaveUrl) {
      trackSaveUrl.addEventListener('click', () => {
        const v = (trackApiUrl.value || '').trim().replace(/\/+$/, '');
        try { window.localStorage.setItem(API_BASE_KEY, v); } catch {}
        if (trackApiUrl) trackApiUrl.value = v;
        updateBackendBadge();
        updateFedexBackend();
        setTrackStatus(
          v ? `Sync URL saved — saves now go to D1 at ${v}` : 'Sync URL cleared — saves go to this browser.',
          'ok'
        );
      });
    }
    if (savedTrackRefresh) savedTrackRefresh.addEventListener('click', loadSavedRows);
    if (trackAutosave) {
      trackAutosave.checked = autosaveOn('rows');
      trackAutosave.addEventListener('change', () => {
        setAutosave('rows', trackAutosave.checked);
        setTrackStatus(trackAutosave.checked ? 'Autosave on — rows save as you edit.' : 'Autosave off.', 'ok');
      });
    }
    renderAllTracking();
  }

  function renderTrackingHeader(headEl) {
    if (!headEl) return;
    const table = headEl.parentElement;
    const oldCols = table.querySelector('colgroup');
    if (oldCols) oldCols.remove();
    const colgroup = document.createElement('colgroup');
    TRACKING_COL_WIDTHS.forEach((w) => {
      const col = document.createElement('col');
      col.style.width = `${w}%`;
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);

    headEl.innerHTML = '';
    const tr = document.createElement('tr');
    for (const h of TRACKING_HEADERS.concat(['Actions'])) {
      const th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    }
    headEl.appendChild(tr);
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
    // Open the native calendar as soon as the field is focused/clicked.
    const pop = () => { try { el.showPicker && el.showPicker(); } catch {} };
    el.addEventListener('focus', pop);
    el.addEventListener('click', pop);
    return el;
  }

  // "Delivered on": calendar field + a one-click Today button.
  function deliveredCell(row) {
    const wrap = document.createElement('div');
    wrap.className = 'delivered';
    const el = dateInput(row.deliveredOnIso || '', (iso) => {
      row.deliveredOnIso = iso;
      row.deliveredOn = iso ? formatDateDDMMYY(fromISODate(iso)) : '';
    });
    const today = document.createElement('button');
    today.type = 'button';
    today.className = 'today-btn';
    today.textContent = 'Today';
    today.addEventListener('click', () => {
      const iso = toISODate(new Date());
      el.value = iso;
      row.deliveredOnIso = iso;
      row.deliveredOn = formatDateDDMMYY(new Date());
      if (autosaveOn('rows')) scheduleAutosave(row, () => saveRow(row, { silent: true }));
    });
    wrap.appendChild(el);
    wrap.appendChild(today);
    return wrap;
  }

  function renderAllTracking() {
    renderTrackingRows(trackingBody, trackingRows);
    renderTrackingRows(savedTrackBody, savedTrackingRows);
  }

  function renderTrackingRows(tbody, rows) {
    if (!tbody) return;
    tbody.innerHTML = '';
    rows.forEach((row) => {
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

      // Delivered on (calendar + one-click Today, empty by default)
      cell('deliveredOn', deliveredCell(row));

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

      // Autosave: any edit (typing or dropdown/date change) within the row.
      const queueAutosave = () => {
        if (autosaveOn('rows')) scheduleAutosave(row, () => saveRow(row, { silent: true }));
      };
      tr.addEventListener('input', queueAutosave);
      tr.addEventListener('change', queueAutosave);

      tbody.appendChild(tr);
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

  async function saveRow(row, { silent = false } = {}) {
    const store = makeStore('rows');
    try {
      if (!silent) setTrackStatus(row.id ? `Overwriting id ${row.id}…` : 'Saving…');
      const saved = row.id ? await store.update(row.id, row) : await store.save(row);
      row.id = saved.id;
      setTrackStatus(
        `${silent ? 'Autosaved' : 'Saved'} order ${row.orderNumber} (id ${saved.id}) to ${store.backend === 'd1' ? 'D1' : 'this browser'}.`,
        'ok'
      );
      // Don't re-render on a silent autosave — it would steal focus mid-typing.
      // row.id is already set in memory, so the next save correctly updates.
      if (!silent) renderAllTracking();
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
      const store = makeStore('rows');
      try {
        await store.remove(row.id);
      } catch (err) {
        setTrackStatus(`Delete failed: ${err.message}`, 'err');
        return;
      }
    }
    trackingRows = trackingRows.filter((r) => r !== row);
    savedTrackingRows = savedTrackingRows.filter((r) => r !== row);
    setTrackStatus('Row removed.', 'ok');
    renderAllTracking();
  }

  // Loads saved tracking rows into the "Saved Tracking" tab.
  async function loadSavedRows() {
    const store = makeStore('rows');
    const status = (m, l) => setStatusInto(savedTrackStatus, m, l);
    try {
      status(`Loading saved rows from ${store.backend === 'd1' ? 'D1' : 'this browser'}…`);
      const saved = await store.list();
      savedTrackingRows = saved.map((s) => ({
        ...s,
        isoDate: s.isoDate || '',
        deliveredOnIso: s.deliveredOnIso || '',
        _origin: 'db',
      }));
      status(`Loaded ${savedTrackingRows.length} saved row(s).`, 'ok');
      renderAllTracking();
    } catch (err) {
      status(`Load failed: ${err.message}`, 'err');
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

  // Initialise the save/tracking sections last and defensively: a failure here
  // must never prevent the upload listeners above from being wired up.
  try {
    initTabs();
    initFedex();
    initTracking();
    initMerchants();
    initStock();
    // Load settings (autosave toggles) + merchants + learned patterns (async).
    loadSettings().catch(() => {});
    loadLearnedPatterns().then(loadMerchants).catch(() => {});
  } catch (err) {
    setTrackStatus(`Save sections failed to initialise: ${err.message}`, 'err');
    if (window.console) window.console.error(err);
  }

  return {
    get orders() { return orders; },
    ingestFiles,
  };
}
