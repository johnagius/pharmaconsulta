// Storage client for saved rows (tracking sheet + FedEx shipments).
//
// When a Cloudflare Worker URL is configured it talks to the D1-backed REST
// API (see worker/). With no URL it falls back to browser localStorage so the
// page keeps working fully offline. Both back-ends expose the same async API:
//   list()            -> [row, ...]
//   save(row)         -> row (with new id)
//   update(id, row)   -> row
//   remove(id)        -> { ok: true }

// Fields persisted per resource (id is assigned by the store).
export const TRACKING_FIELDS = [
  'day', 'date', 'isoDate', 'orderNumber', 'trackingNumber', 'product', 'quantity',
  'productDescription', 'destCity', 'destState', 'account', 'client',
  'deliveredOn', 'deliveredOnIso', 'comments', 'directionRemarks', 'dedupKey',
];

export const FEDEX_FIELDS = [
  'fileName', 'source', 'productKey', 'productMid', 'recipientName', 'cells', 'dedupKey',
];

export const MERCHANT_FIELDS = ['name'];
export const PATTERN_FIELDS = ['merchant', 'tokens', 'label'];
export const STOCKITEM_FIELDS = ['merchant', 'name', 'section', 'country', 'batch', 'expiry', 'opening', 'matchKey'];
export const STOCKMOVE_FIELDS = ['merchant', 'itemId', 'product', 'qty', 'date', 'country', 'batch', 'section', 'status', 'orderKey', 'note', 'dedupKey'];

const FIELDS_BY_RESOURCE = {
  rows: TRACKING_FIELDS,
  fedex: FEDEX_FIELDS,
  merchants: MERCHANT_FIELDS,
  patterns: PATTERN_FIELDS,
  stockitems: STOCKITEM_FIELDS,
  stockmoves: STOCKMOVE_FIELDS,
};

function pick(row, fields) {
  const out = {};
  for (const f of fields) out[f] = row[f] ?? '';
  return out;
}

function createLocalStore(lsKey, fields, storage) {
  const read = () => {
    try {
      return JSON.parse(storage.getItem(lsKey) || '[]');
    } catch {
      return [];
    }
  };
  const write = (rows) => storage.setItem(lsKey, JSON.stringify(rows));

  return {
    backend: 'local',
    async list() {
      return read();
    },
    async save(row) {
      const rows = read();
      // De-dup: update an existing row with the same dedupKey instead of adding.
      if (row.dedupKey) {
        const existing = rows.find((r) => r.dedupKey && r.dedupKey === row.dedupKey);
        if (existing) {
          Object.assign(existing, pick(row, fields), { id: existing.id });
          write(rows);
          return existing;
        }
      }
      const id = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
      const saved = { id, ...pick(row, fields) };
      rows.push(saved);
      write(rows);
      return saved;
    },
    async update(id, row) {
      const rows = read();
      const idx = rows.findIndex((r) => String(r.id) === String(id));
      if (idx === -1) throw new Error(`Row ${id} not found`);
      rows[idx] = { id: rows[idx].id, ...pick(row, fields) };
      write(rows);
      return rows[idx];
    },
    async remove(id) {
      const rows = read().filter((r) => String(r.id) !== String(id));
      write(rows);
      return { ok: true };
    },
  };
}

function createApiStore(baseUrl, resource, fields, fetchImpl) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/api/${resource}`;
  const json = async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
  };
  return {
    backend: 'd1',
    async list() {
      return json(await fetchImpl(url));
    },
    async save(row) {
      return json(await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pick(row, fields)),
      }));
    },
    async update(id, row) {
      return json(await fetchImpl(`${url}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pick(row, fields)),
      }));
    },
    async remove(id) {
      return json(await fetchImpl(`${url}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    },
  };
}

// resource: 'rows' (tracking) | 'fedex'. fields/lsKey default per resource.
export function createStore({ baseUrl = '', fetchImpl, storage, resource = 'rows', fields, lsKey } = {}) {
  const flds = fields || FIELDS_BY_RESOURCE[resource] || TRACKING_FIELDS;
  const key = lsKey || `pharmaconsulta_${resource}`;
  if (baseUrl && fetchImpl) return createApiStore(baseUrl, resource, flds, fetchImpl);
  if (storage) return createLocalStore(key, flds, storage);
  throw new Error('createStore needs either a baseUrl+fetchImpl or a storage');
}
