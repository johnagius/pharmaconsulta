import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

const MODULE_ORDER = [
  'data/columns.js',
  'data/senders.js',
  'data/hsCodes.js',
  'data/states.js',
  'data/merchants.js',
  'data/stock.js',
  'data/midCodes.js',
  'buildRow.js',
  'trackingRow.js',
  'trackingStore.js',
  'excelExporter.js',
  'pdfReader.js',
  'parsers/activa.js',
  'parsers/dh.js',
  'parsers/k2.js',
  'parsers/pdms.js',
  'parsers/secil.js',
  'parsers/index.js',
  'app.js',
];

const NAMESPACES = {
  'data/columns.js': 'ModColumns',
  'data/senders.js': 'ModSenders',
  'data/hsCodes.js': 'ModHs',
  'data/states.js': 'ModStates',
  'data/merchants.js': 'ModMerchants',
  'data/stock.js': 'ModStock',
  'data/midCodes.js': 'ModMid',
  'buildRow.js': 'ModBuildRow',
  'trackingRow.js': 'ModTrackingRow',
  'trackingStore.js': 'ModTrackingStore',
  'excelExporter.js': 'ModExporter',
  'pdfReader.js': 'ModPdfReader',
  'parsers/activa.js': 'ParserActiva',
  'parsers/dh.js': 'ParserDh',
  'parsers/k2.js': 'ParserK2',
  'parsers/pdms.js': 'ParserPdms',
  'parsers/secil.js': 'ParserSecil',
  'parsers/index.js': 'ParserIndex',
  'app.js': 'AppModule',
};

const IMPORT_TO_NS = {
  './data/columns.js': 'ModColumns',
  './data/senders.js': 'ModSenders',
  './data/hsCodes.js': 'ModHs',
  './data/states.js': 'ModStates',
  './data/merchants.js': 'ModMerchants',
  './data/stock.js': 'ModStock',
  './data/midCodes.js': 'ModMid',
  './buildRow.js': 'ModBuildRow',
  './trackingRow.js': 'ModTrackingRow',
  './trackingStore.js': 'ModTrackingStore',
  './excelExporter.js': 'ModExporter',
  './pdfReader.js': 'ModPdfReader',
  './parsers/index.js': 'ParserIndex',
  '../data/columns.js': 'ModColumns',
  '../data/senders.js': 'ModSenders',
  '../data/hsCodes.js': 'ModHs',
  '../data/states.js': 'ModStates',
  '../data/merchants.js': 'ModMerchants',
  '../data/stock.js': 'ModStock',
  '../data/midCodes.js': 'ModMid',
  '../buildRow.js': 'ModBuildRow',
  '../excelExporter.js': 'ModExporter',
  '../pdfReader.js': 'ModPdfReader',
  './activa.js': 'ParserActiva',
  './dh.js': 'ParserDh',
  './k2.js': 'ParserK2',
  './pdms.js': 'ParserPdms',
  './secil.js': 'ParserSecil',
};

function transform(source) {
  let out = source;

  out = out.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_m, name, spec) => {
      const ns = IMPORT_TO_NS[spec];
      if (!ns) throw new Error(`Unmapped namespace import: ${spec}`);
      return `const ${name} = ${ns};`;
    }
  );

  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_m, names, spec) => {
      const ns = IMPORT_TO_NS[spec];
      if (!ns) throw new Error(`Unmapped named import: ${spec}`);
      const cleaned = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const lines = cleaned.map((alias) => {
        const m = alias.match(/^(\w+)\s+as\s+(\w+)$/);
        if (m) return `const ${m[2]} = ${ns}.${m[1]};`;
        return `const ${alias} = ${ns}.${alias};`;
      });
      return lines.join('\n');
    }
  );

  out = out.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1');
  out = out.replace(/export\s+function\s+(\w+)/g, 'function $1');
  out = out.replace(/export\s+const\s+(\w+)/g, 'const $1');
  out = out.replace(/export\s+let\s+(\w+)/g, 'let $1');
  out = out.replace(/export\s+\{[^}]+\};?/g, '');
  out = out.replace(/export\s+default\s+/g, 'const __default__ = ');

  return out;
}

function exportsFromSource(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+const\s+(\w+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+let\s+(\w+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

async function buildModule(rel) {
  const file = path.join(srcDir, rel);
  const src = await fs.readFile(file, 'utf8');
  const exports = exportsFromSource(src);
  const ns = NAMESPACES[rel];
  const transformed = transform(src);
  const exportBlock = exports.length
    ? `  return { ${exports.map((n) => `${n}`).join(', ')} };`
    : '  return {};';
  return `// === ${rel} ===\nconst ${ns} = (function () {\n${transformed}\n${exportBlock}\n})();\n`;
}

async function main() {
  const css = await fs.readFile(path.join(srcDir, 'styles.css'), 'utf8');
  const moduleBlocks = [];
  for (const rel of MODULE_ORDER) {
    moduleBlocks.push(await buildModule(rel));
  }
  const bundleJs = moduleBlocks.join('\n') + `
window.AppModule = AppModule;
window.ModBuildRow = ModBuildRow;
window.ModExporter = ModExporter;
window.ModMid = ModMid;
window.ModPdfReader = ModPdfReader;
window.ParserIndex = ParserIndex;
`;

  const BUILD_STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const PDFJS_VERSION = '3.11.174';
  const XLSX_VERSION = '0.18.5';
  const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
  const PDFJS_WORKER_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
  const XLSX_CDN = `https://cdn.jsdelivr.net/npm/xlsx@${XLSX_VERSION}/dist/xlsx.full.min.js`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PharmaConsulta — Shipment & Order Management</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%2338bdf8'/%3E%3Ctext x='8' y='12' text-anchor='middle' font-size='10' font-family='sans-serif' fill='%230b1224' font-weight='700'%3EPC%3C/text%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="brand-mark" aria-hidden="true">PC</div>
    <div class="brand-text">
      <h1>PharmaConsulta</h1>
      <span class="brand-sub">Shipment &amp; Order Management</span>
    </div>
    <span class="brand-status">All processing runs in your browser</span>
  </div>
  <p class="brand-desc">Import PDF orders from any merchant, auto-build FedEx batch files, manage tracking sheets, and keep every shipment saved and searchable &mdash; one workspace, no spreadsheets to juggle.</p>
</header>
<main>
  <nav class="tabs" role="tablist">
    <button class="tab active" id="tab-builder" data-panel="panel-builder" type="button">Builder</button>
    <button class="tab" id="tab-fedex" data-panel="panel-fedex" type="button">Saved FedEx</button>
    <button class="tab" id="tab-tracking" data-panel="panel-tracking" type="button">Saved Tracking</button>
    <button class="tab" id="tab-stock" data-panel="panel-stock" type="button">Stock</button>
    <button class="tab" id="tab-merchants" data-panel="panel-merchants" type="button">Merchants</button>
    <button class="tab tab-gear" id="btn-settings" type="button" title="Sync settings" aria-label="Sync settings">&#9881;</button>
  </nav>

  <div class="global-settings hidden" id="global-settings">
    <label for="track-api-url">Sync API URL (Cloudflare Worker):</label>
    <input type="text" id="track-api-url" placeholder="https://your-worker.workers.dev (leave blank to use this browser)">
    <button id="btn-track-save-url" type="button">Save URL</button>
    <span>Saving to: <span id="track-backend" class="backend-badge local">this browser (localStorage)</span></span>
  </div>

  <section class="panel active" id="panel-builder">
    <div id="drop-zone" tabindex="0" role="button" aria-label="Upload PDF files">
      <strong>Drop PDFs or folders here</strong>
      <small>&hellip; or click to pick files</small>
      <input type="file" id="file-picker" accept="application/pdf" multiple class="hidden">
      <input type="file" id="folder-picker" webkitdirectory directory multiple class="hidden">
    </div>
    <div class="actions">
      <button id="btn-add-folder" type="button">Add folder</button>
      <button id="btn-clear" class="danger" type="button">Clear</button>
      <button id="btn-download" class="primary" type="button" disabled>Download xlsx</button>
      <button id="btn-fedex-saveall" type="button">Save all to D1</button>
      <label class="autosave"><input type="checkbox" id="chk-fedex-autosave"> Autosave to D1</label>
    </div>
    <div class="row-summary" id="summary">Drop PDFs above to begin.</div>
    <div id="status" aria-live="polite"></div>
    <div id="fedex-status" aria-live="polite"></div>
    <div class="scroll-box">
      <div id="cards" class="cards" aria-label="Shipments preview"></div>
    </div>

    <section class="section-divider">
      <h2>Tracking sheet</h2>
      <p>One row per order (all products listed together). Edit any cell, then save a line to the database or copy it for pasting into a spreadsheet.</p>
    </section>
    <div class="track-settings">
      <label class="autosave"><input type="checkbox" id="chk-track-autosave"> Autosave tracking rows</label>
    </div>
    <div id="tracking-status" aria-live="polite"></div>
    <div class="scroll-box">
      <table id="tracking-table" class="track-table" aria-label="Tracking sheet">
        <thead id="tracking-head"></thead>
        <tbody id="tracking-body"></tbody>
      </table>
    </div>
  </section>

  <section class="panel" id="panel-fedex">
    <h2>Saved FedEx shipments</h2>
    <p class="panel-hint">Shipments saved to the database. Click a card to view/edit all fields; Overwrite saves changes back. Download one or all as xlsx.</p>
    <div class="actions">
      <button id="btn-saved-fedex-refresh" class="primary" type="button">Refresh</button>
      <button id="btn-saved-fedex-download" type="button">Download all (xlsx)</button>
    </div>
    <div id="saved-fedex-status" aria-live="polite"></div>
    <div class="scroll-box">
      <div id="saved-fedex-cards" class="cards" aria-label="Saved FedEx shipments"></div>
    </div>
  </section>

  <section class="panel" id="panel-tracking">
    <h2>Saved tracking rows</h2>
    <p class="panel-hint">Tracking rows saved to the database. Edit a cell and Overwrite to update, or Refresh to reload.</p>
    <div class="actions">
      <button id="btn-saved-track-refresh" class="primary" type="button">Refresh</button>
    </div>
    <div id="saved-track-status" aria-live="polite"></div>
    <div class="scroll-box">
      <table id="saved-track-table" class="track-table" aria-label="Saved tracking rows">
        <thead id="saved-track-head"></thead>
        <tbody id="saved-track-body"></tbody>
      </table>
    </div>
  </section>

  <section class="panel" id="panel-merchants">
    <h2>Merchants</h2>
    <p class="panel-hint">Merchants are auto-detected from each PDF's format and improve as you correct them. Add new merchants here.</p>
    <div class="actions">
      <input type="text" id="merchant-new" placeholder="New merchant name">
      <button id="btn-merchant-add" class="primary" type="button">Add merchant</button>
      <button id="btn-merchant-refresh" type="button">Refresh</button>
    </div>
    <div id="merchant-status" aria-live="polite"></div>
    <div id="merchant-list" class="merchant-list"></div>
  </section>

  <section class="panel" id="panel-stock">
    <h2>Stock</h2>
    <p class="panel-hint">A controlled stock ledger per merchant. Pull movements from loaded orders as <strong>pending</strong>, map each to a stock item, then <strong>confirm</strong> to apply &mdash; nothing changes your numbers until you confirm. Manage items and export confirmed movements for your sheets.</p>
    <div class="actions">
      <label class="inline-field">Merchant
        <select id="stock-merchant"></select>
      </label>
      <button id="btn-stock-refresh" class="primary" type="button">Refresh</button>
      <button id="btn-stock-from-tracking" type="button">Pull from Tracking &rarr; pending</button>
      <button id="btn-stock-add-manual" type="button">+ Manual movement</button>
    </div>
    <div id="stock-status" aria-live="polite"></div>

    <div id="stock-tracking-picker" class="hidden">
      <h3 class="sub-head">Select tracking rows to add (for merchant chosen above)</h3>
      <div class="actions">
        <button id="btn-stock-picker-add" class="primary" type="button">Add selected &rarr; pending</button>
        <button id="btn-stock-picker-cancel" type="button">Cancel</button>
      </div>
      <div class="scroll-box">
        <table class="track-table" aria-label="Pick tracking rows">
          <thead id="stock-picker-head"></thead>
          <tbody id="stock-picker-body"></tbody>
        </table>
      </div>
    </div>

    <h3 class="sub-head">Pending movements</h3>
    <div class="scroll-box">
      <table id="stock-pending-table" class="track-table" aria-label="Pending stock movements">
        <thead id="stock-pending-head"></thead>
        <tbody id="stock-pending-body"></tbody>
      </table>
    </div>

    <h3 class="sub-head">Stock items &amp; current quantity</h3>
    <div class="actions stock-additem">
      <input type="text" id="si-name" placeholder="Item name">
      <input type="text" id="si-section" placeholder="Section (e.g. MP stock)">
      <input type="text" id="si-country" placeholder="Country">
      <input type="text" id="si-batch" placeholder="Batch">
      <input type="text" id="si-expiry" placeholder="Expiry">
      <input type="text" id="si-opening" placeholder="Opening qty" inputmode="numeric">
      <button id="btn-stock-additem" class="primary" type="button">Add item</button>
    </div>
    <div class="scroll-box">
      <table id="stock-items-table" class="track-table" aria-label="Stock items">
        <thead id="stock-items-head"></thead>
        <tbody id="stock-items-body"></tbody>
      </table>
    </div>
  </section>
</main>
<footer>
  PharmaConsulta &middot; runs entirely in your browser. Saved tracking rows go only to the database you configure. &middot; build ${BUILD_STAMP}
</footer>
<script src="${PDFJS_CDN}" crossorigin="anonymous"></script>
<script src="${XLSX_CDN}" crossorigin="anonymous"></script>
<script>
(function () {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_WORKER_CDN}';
  }
})();
</script>
<script>
${bundleJs}

(function bootstrap() {
  document.getElementById('btn-add-folder').addEventListener('click', function () {
    document.getElementById('folder-picker').click();
  });
  window.__appInstance__ = AppModule.createApp({
    document: document,
    window: window,
    pdfjsLib: window.pdfjsLib,
    XLSX: window.XLSX,
  });
})();
</script>
</body>
</html>
`;

  await fs.writeFile(path.join(root, 'index.html'), html, 'utf8');
  process.stdout.write(`Bundled index.html (${(html.length / 1024).toFixed(0)} KiB)\n`);
}

main().catch((err) => {
  process.stderr.write(`bundle failed: ${err.stack || err}\n`);
  process.exit(1);
});
