-- Watchlist sync: one row holding the whole state as JSON.
CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated INTEGER NOT NULL
);
