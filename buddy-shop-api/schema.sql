-- Products added, edited or deleted by staff. Applied on top of catalog.js.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
