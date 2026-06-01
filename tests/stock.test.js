import { describe, it, expect } from 'vitest';
import {
  toNum, currentStock, suggestItemId, movementDedupKey, movementsToRows,
} from '../src/data/stock.js';
import { createStore } from '../src/trackingStore.js';

describe('stock helpers', () => {
  const item = { id: 1, merchant: 'David Hitchen', name: 'Ozempic 1mg', opening: '266', matchKey: 'ozempic', country: 'UK', batch: 'B1', section: 'MP' };

  it('toNum coerces safely', () => {
    expect(toNum('5')).toBe(5);
    expect(toNum('')).toBe(0);
    expect(toNum('abc')).toBe(0);
  });

  it('currentStock = opening + confirmed movements only', () => {
    const moves = [
      { itemId: 1, qty: '-6', status: 'confirmed' },
      { itemId: 1, qty: '-3', status: 'confirmed' },
      { itemId: 1, qty: '-10', status: 'pending' }, // ignored until confirmed
      { itemId: 2, qty: '-5', status: 'confirmed' }, // other item
    ];
    expect(currentStock(item, moves)).toBe(266 - 6 - 3);
  });

  it('suggestItemId matches by merchant + learned matchKey', () => {
    expect(suggestItemId([item], 'David Hitchen', 'ozempic')).toBe(1);
    expect(suggestItemId([item], 'David Hitchen', 'botox')).toBe('');
    expect(suggestItemId([item], 'Activa', 'ozempic')).toBe('');
  });

  it('movementDedupKey is stable per order+product', () => {
    expect(movementDedupKey('abc|1', 'Xeomin')).toBe('abc|1|Xeomin');
  });

  it('movementsToRows exports confirmed rows with item fallbacks', () => {
    const moves = [
      { itemId: 1, qty: '-6', status: 'confirmed', date: '2026-06-01' },
      { itemId: 1, qty: '-1', status: 'pending', date: '2026-06-02' },
    ];
    const rows = movementsToRows(moves, [item]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['2026-06-01', 'Ozempic 1mg', '-6', 'UK', 'B1', 'MP']);
  });
});

describe('createStore stock resources', () => {
  function fakeStorage() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  }
  it('stores stock items and dedups movements by dedupKey', async () => {
    const items = createStore({ storage: fakeStorage(), resource: 'stockitems' });
    const it = await items.save({ merchant: 'Activa', name: 'Botox', opening: '10' });
    expect(it).toMatchObject({ id: 1, name: 'Botox' });

    const moves = createStore({ storage: fakeStorage(), resource: 'stockmoves' });
    const a = await moves.save({ product: 'Botox', qty: '-1', dedupKey: 'o1|Botox' });
    const b = await moves.save({ product: 'Botox', qty: '-2', dedupKey: 'o1|Botox' });
    expect(b.id).toBe(a.id);
    expect(await moves.list()).toHaveLength(1);
  });
});
