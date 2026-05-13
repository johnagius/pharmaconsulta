# CLAUDE.md

## What this repo is

A browser‑only tool that turns PDF shipping orders into a FedEx batch‑import
xlsx. Drop one PDF or a whole folder, pick a product when auto‑detection
fails, then click **Download xlsx**. No backend, nothing is uploaded.

The reference output is `batch upload/FedEx_Batch_2026-05-05_8shipments.xlsx`,
which sets the exact 52‑column layout, default constants, the 8 rotating
Maltese senders and the rotating cosmetic descriptions/HS codes the user
applies even when the underlying product is pharmaceutical.

## Where things live

```
index.html                  ← self‑contained shipped artefact (built by scripts/bundle.mjs)
src/
  app.js                    UI wiring, drag/drop, table preview, download
  pdfReader.js              pdf.js → text with sensible spacing
  buildRow.js               order + product → 52‑cell row
  excelExporter.js          rows → SheetJS workbook + filename helper
  styles.css                styles inlined into index.html
  data/
    columns.js              52 FedEx column keys + per‑row constants
    senders.js              8 Malta senders rotated by row index
    hsCodes.js              12 cosmetic descriptions + HS codes rotated by row index
    midCodes.js             product detection (regex) + MID + country
  parsers/
    activa.js dh.js k2.js pdms.js secil.js   five PDF layouts
    index.js                detect + dispatch + multi‑order support (k2)
scripts/bundle.mjs          inlines src/* + pdf.js + xlsx into index.html
tests/                      vitest unit tests + .txt fixtures per parser
e2e/                        Playwright e2e (Chromium for Testing)
```

## Commands

```
npm install
npm run bundle              # rebuild index.html from src/
npm test                    # vitest unit tests
npm run e2e                 # playwright e2e
npm run serve               # http-server on :5173
```

Anytime `src/`, the inline CSS or the bundle script changes, run
`npm run bundle` so the shipped `index.html` is up to date.

## Conventions

- All paths through `src/` use ESM `import`/`export`. The bundle script
  rewrites them into IIFE namespaces and inlines pdf.js + xlsx so the
  shipped HTML works offline with no extra files.
- Parsers return either `{ source, orderId, recipient, productText, rawText }`
  or `{ multi: true, orders: [...] }` (currently only K2 emits multi).
- `buildRow(order, rowIndex)` rotates `SENDERS[rowIndex % 8]` and
  `HS_CODES[rowIndex % HS_CODES.length]` and reads MID + country from the
  resolved product. A row with no MID (unknown product) is flagged red
  and the **Download** button stays disabled.
- The download filename follows `FedEx_Batch_YYYY-MM-DD_Nshipments.xlsx`,
  computed from today + the row count.

## Adding a new parser

1. Add `src/parsers/<name>.js` exporting `detect(text)` and `parse(text)`.
   For multi‑order PDFs, return `{ multi: true, orders: [...] }`.
2. Register it in `src/parsers/index.js`.
3. Add a fixture in `tests/fixtures/<name>.txt` and a test in
   `tests/parsers.test.js`.
4. Run `npm test`, then `npm run bundle`, then `npm run e2e`.

## Adding a new product

Append an entry to `PRODUCTS` in `src/data/midCodes.js`:

```js
{ key: 'newdrug', label: 'NewDrug 10mg', mid: 'XXNEWDRUG1XX', country: 'XX', patterns: [/newdrug/i] }
```

Rebuild with `npm run bundle`.

## Tests

- `npm test` exercises:
  - every parser against a saved text fixture (no PDF binary needed);
  - `buildRow` against row 1 of the sample xlsx (must match cell‑for‑cell);
  - sender and HS rotation by row index;
  - `excelExporter` round‑trip through SheetJS.
- `npm run e2e` boots `http-server` on :5173 and drives Chromium for
  Testing (`/opt/chrome-linux64/chrome` if installed locally, else
  `$CHROME_PATH`). It uploads the five D.H. PDFs, asserts the
  preview rows + filename + xlsx contents, and fails on any
  `console.error` or `pageerror`.

## Git workflow

The user asked for direct commits to `main`. Every meaningful unit of
work (parsers, exporter, UI, tests, docs) gets its own commit on `main`
and is pushed with `git push -u origin main`. After any change touching
`src/` or the bundler, regenerate `index.html` so the raw‑URL download
link always serves the latest build.
