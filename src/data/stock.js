// Pure stock helpers. The app keeps its own ledger: each item has an opening
// quantity, and confirmed movements (signed: negative = shipped out) adjust it.

export function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Running stock for an item = opening + sum of its CONFIRMED movement quantities.
export function currentStock(item, moves) {
  return moves
    .filter((m) => String(m.itemId) === String(item.id) && m.status === 'confirmed')
    .reduce((sum, m) => sum + toNum(m.qty), toNum(item.opening));
}

// Suggest which stock item an order's product maps to, using the item's
// learned matchKey (set the first time a user assigns that product).
export function suggestItemId(items, merchant, matchKey) {
  if (!matchKey) return '';
  const it = items.find((i) => i.merchant === merchant && i.matchKey && i.matchKey === matchKey);
  return it ? it.id : '';
}

// Stable key so re-saving the same order doesn't create duplicate movements.
export function movementDedupKey(orderKey, product) {
  return `${orderKey || ''}|${product || ''}`;
}

// Tab-separated export rows for confirmed movements (paste into a sheet).
export function movementsToRows(moves, items) {
  const byId = new Map(items.map((i) => [String(i.id), i]));
  return moves
    .filter((m) => m.status === 'confirmed')
    .map((m) => {
      const item = byId.get(String(m.itemId));
      return [
        m.date || '',
        item ? item.name : (m.product || ''),
        m.qty,
        m.country || (item ? item.country : ''),
        m.batch || (item ? item.batch : ''),
        m.section || (item ? item.section : ''),
      ];
    });
}
