import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import { buildAOA, buildWorkbook, buildFileName } from '../src/excelExporter.js';
import { findProductByKey } from '../src/data/midCodes.js';
import { COLUMN_KEYS } from '../src/data/columns.js';

const ozempic = findProductByKey('ozempic');

function sampleOrder(name) {
  return {
    recipient: {
      name,
      phone: '5551234567',
      email: `${name.split(' ')[0].toLowerCase()}@example.com`,
      line1: '123 Main St',
      postcode: '12345',
      state: 'NY',
      city: 'Anytown',
      country: 'US',
    },
    product: ozempic,
  };
}

describe('excelExporter', () => {
  it('buildAOA produces header + N rows', () => {
    const aoa = buildAOA([sampleOrder('Alice Smith'), sampleOrder('Bob Jones')]);
    expect(aoa).toHaveLength(3);
    expect(aoa[0].length).toBe(52);
    expect(aoa[1].length).toBe(52);
  });

  it('round-trips through SheetJS', () => {
    const orders = [
      sampleOrder('Alice Smith'),
      sampleOrder('Bob Jones'),
      sampleOrder('Carol Lee'),
    ];
    const wb = buildWorkbook(orders, XLSX);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const reopened = XLSX.read(out, { type: 'buffer' });
    const ws = reopened.Sheets[reopened.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    expect(rows[0]).toEqual(COLUMN_KEYS);
    expect(rows).toHaveLength(4);
    expect(rows[1][2]).toBe('Robert Aquilina');
    expect(rows[1][12]).toBe('Alice Smith');
  });

  it('buildFileName uses YYYY-MM-DD and shipment count', () => {
    const d = new Date(Date.UTC(2026, 4, 13));
    const name = buildFileName(8, d);
    expect(name).toBe('FedEx_Batch_2026-05-13_8shipments.xlsx');
  });
});
