import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const dhFolder = path.join(repoRoot, 'batch upload', 'D.H orders');
const allDhPdfs = fs
  .readdirSync(dhFolder)
  .filter((n) => n.endsWith('.pdf'))
  .sort()
  .map((n) => path.join(dhFolder, n));

const VENDOR_MAP: Record<string, string> = {
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js':
    path.join(repoRoot, 'node_modules/pdfjs-dist/build/pdf.min.js'),
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js':
    path.join(repoRoot, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'),
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js':
    path.join(repoRoot, 'node_modules/xlsx/dist/xlsx.full.min.js'),
};

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const local = VENDOR_MAP[url];
    if (!local) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: fs.readFileSync(local, 'utf8'),
    });
  });
});

test.describe('FedEx Batch Builder', () => {
  test('uploads D.H. PDFs and downloads an xlsx with one row per PDF, no console errors', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/index.html');
    await expect(page.locator('#drop-zone')).toBeVisible();
    await page.waitForFunction(() => typeof (window as any).AppModule !== 'undefined');

    await page.setInputFiles('#file-picker', allDhPdfs);

    await expect.poll(
      async () => page.locator('#table-body tr').count(),
      { timeout: 30_000 }
    ).toBe(allDhPdfs.length);

    await expect(page.locator('#summary')).toContainText(`${allDhPdfs.length} shipment`);

    const downloadBtn = page.locator('#btn-download');
    await expect(downloadBtn).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadBtn.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`FedEx_Batch_\\d{4}-\\d{2}-\\d{2}_${allDhPdfs.length}shipments\\.xlsx`)
    );
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const stat = fs.statSync(savedPath!);
    expect(stat.size).toBeGreaterThan(2000);

    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    testInfo.attachments.push({
      name: 'downloaded-xlsx',
      path: savedPath!,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  test('downloaded xlsx contains correct headers + recipient names', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof (window as any).AppModule !== 'undefined');
    await page.setInputFiles('#file-picker', allDhPdfs);
    await expect.poll(
      async () => page.locator('#table-body tr').count(),
      { timeout: 30_000 }
    ).toBe(allDhPdfs.length);
    const downloadBtn = page.locator('#btn-download');
    await expect(downloadBtn).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadBtn.click(),
    ]);
    const savedPath = await download.path();

    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.readFile(savedPath!);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    expect(rows[0][0]).toBe('serviceType');
    expect(rows[0][rows[0].length - 1]).toBe('serviceType');
    expect(rows).toHaveLength(allDhPdfs.length + 1);
    const recipientNames = rows.slice(1).map((r) => r[12]);
    expect(recipientNames).toEqual(
      expect.arrayContaining([
        'Paula Cunningham',
        'Jessica Wagner-Jeffrey',
        'Joanne Habe',
        'Elise Freda',
        'Jennifer Lev',
      ])
    );
    const senders = rows.slice(1).map((r) => r[2]);
    expect(senders[0]).toBe('Robert Aquilina');
    expect(senders[1]).toBe('Sandra Borg');
  });

  test('disables download until product is picked for unrecognised PDFs', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof (window as any).AppModule !== 'undefined');
    const secilPdf = path.join(repoRoot, 'batch upload', 'Secil Orders', 'Orders 230.pdf');
    await page.setInputFiles('#file-picker', secilPdf);
    await expect.poll(
      async () => page.locator('#table-body tr').count(),
      { timeout: 30_000 }
    ).toBe(1);
    const downloadBtn = page.locator('#btn-download');
    await expect(downloadBtn).toBeDisabled();
    await page.locator('#table-body select').selectOption('ozempic');
    await expect(downloadBtn).toBeEnabled();
  });
});
