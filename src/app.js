import { dispatch } from './parsers/index.js';
import { readPdfText } from './pdfReader.js';
import { PRODUCTS, detectProduct, findProductByKey } from './data/midCodes.js';
import { buildAOA, buildFileName } from './excelExporter.js';
import { HEADER_ROW, buildRow } from './buildRow.js';

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

  const headers = HEADER_ROW();
  let orders = [];

  renderHeader();
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
    statusEl.textContent = '';
    renderRows();
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
