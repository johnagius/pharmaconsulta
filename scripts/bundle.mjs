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
  'data/midCodes.js',
  'buildRow.js',
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
  'data/midCodes.js': 'ModMid',
  'buildRow.js': 'ModBuildRow',
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
  './data/midCodes.js': 'ModMid',
  './buildRow.js': 'ModBuildRow',
  './excelExporter.js': 'ModExporter',
  './pdfReader.js': 'ModPdfReader',
  './parsers/index.js': 'ParserIndex',
  '../data/columns.js': 'ModColumns',
  '../data/senders.js': 'ModSenders',
  '../data/hsCodes.js': 'ModHs',
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

  const PDFJS_VERSION = '3.11.174';
  const XLSX_VERSION = '0.18.5';
  const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
  const PDFJS_WORKER_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
  const XLSX_CDN = `https://cdn.jsdelivr.net/npm/xlsx@${XLSX_VERSION}/dist/xlsx.full.min.js`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PharmaConsulta Batch Upload</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%2338bdf8'/%3E%3Ctext x='8' y='12' text-anchor='middle' font-size='10' font-family='sans-serif' fill='%230b1224' font-weight='700'%3EPC%3C/text%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<header>
  <h1>PharmaConsulta &mdash; FedEx Batch Builder</h1>
  <p>Drop PDF orders (single files or whole folders). Review the table, pick products where needed, then download the FedEx batch xlsx.</p>
</header>
<main>
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
  </div>
  <div class="row-summary" id="summary">Drop PDFs above to begin.</div>
  <div id="status" aria-live="polite"></div>
  <div id="preview-wrapper">
    <table aria-label="Shipments preview">
      <thead id="table-head"></thead>
      <tbody id="table-body"></tbody>
    </table>
  </div>
</main>
<footer>
  PharmaConsulta &middot; runs entirely in your browser. No data leaves your machine.
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
