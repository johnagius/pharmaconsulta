-- Stock management: a per-merchant catalogue of stock items, plus a movement
-- ledger. Movements start as 'pending' and only affect running stock once
-- confirmed by the user.
CREATE TABLE IF NOT EXISTS stock_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant    TEXT DEFAULT '',
  name        TEXT DEFAULT '',
  section     TEXT DEFAULT '',
  country     TEXT DEFAULT '',
  batch       TEXT DEFAULT '',
  expiry      TEXT DEFAULT '',
  opening     TEXT DEFAULT '0',
  match_key   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant    TEXT DEFAULT '',
  item_id     TEXT DEFAULT '',
  product     TEXT DEFAULT '',
  qty         TEXT DEFAULT '0',
  date        TEXT DEFAULT '',
  country     TEXT DEFAULT '',
  batch       TEXT DEFAULT '',
  section     TEXT DEFAULT '',
  status      TEXT DEFAULT 'pending',
  order_key   TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  dedup_key   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stockmove_dedup ON stock_movements(dedup_key);
CREATE INDEX IF NOT EXISTS idx_stockmove_merchant ON stock_movements(merchant);
CREATE INDEX IF NOT EXISTS idx_stockitem_merchant ON stock_items(merchant);
