# pharmaconsulta — FedEx Batch Upload

A browser‑only tool that turns PDF shipping orders (Activa, D.H., K2, PDMS,
Secil layouts) into a FedEx batch‑import xlsx that matches the user's
`FedEx_Batch_*` template byte‑for‑byte.

## Download / run

Grab the single self‑contained file:

> **<https://raw.githubusercontent.com/johnagius/pharmaconsulta/main/index.html>**

Save it anywhere and open it in any modern browser (Chrome, Edge, Firefox,
Safari). Everything runs locally — no server, no upload.

Or, in this repo:

```sh
npm install
npm run serve        # http://127.0.0.1:5173/index.html
```

## How it works

1. Drop PDFs (single files, multi‑select, or whole folders) onto the
   drop zone.
2. The app detects the order layout, extracts the recipient, and matches
   the product against the MID code list (Ozempic, Botox, Crysvita,
   Hemlibra, Alecensa, Orencia, etc.).
3. Each row is built with a Malta sender (rotated through 8 names), a
   cosmetic description + HS code (rotated through the user's 12‑entry
   reference list), and the matched product's MID + manufacturing country.
4. Review/edit any cell inline. Pick a product for any unrecognised rows
   (Download stays disabled until every row has an MID).
5. Click **Download xlsx** → `FedEx_Batch_YYYY-MM-DD_Nshipments.xlsx`.

## Development

```sh
npm install
npm test             # vitest unit tests
npm run e2e          # playwright e2e (needs Chromium at /opt/chrome-linux64/chrome or $CHROME_PATH)
npm run bundle       # rebuild index.html from src/
```

See `CLAUDE.md` for architecture, parser conventions, and how to add a
new layout or product.
