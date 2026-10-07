-- KÁRMÁN · comparison stats
-- One row per device per flight. Points and per-leg hits only: no names,
-- no accounts, no answers. The device id is a random UUID made on the phone.

CREATE TABLE IF NOT EXISTS results (
  n        INTEGER NOT NULL,           -- flight number
  device   TEXT    NOT NULL,           -- random id from the player's browser
  pts      INTEGER NOT NULL,           -- final points (0–700)
  legs     TEXT    NOT NULL,           -- hit pattern, e.g. "1101011"
  chips    TEXT    NOT NULL,           -- width per leg, e.g. "2341204"
  created  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (n, device)              -- one flight per device per day
);

CREATE INDEX IF NOT EXISTS results_by_flight ON results (n, pts);

-- "Report this answer": one row per question per device.
CREATE TABLE IF NOT EXISTS reports (
  qid      TEXT NOT NULL,
  device   TEXT NOT NULL,
  n        INTEGER,
  created  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (qid, device)
);

-- Unlock links you hand out: karman.day/?unlock=CODE. active = 0 revokes.
CREATE TABLE IF NOT EXISTS unlock_codes (
  code     TEXT PRIMARY KEY,
  active   INTEGER NOT NULL DEFAULT 1,
  note     TEXT,
  created  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Google accounts that signed in to buy. unlimited = 1 after Stripe confirms.
CREATE TABLE IF NOT EXISTS users (
  sub            TEXT PRIMARY KEY,     -- Google's stable account id
  email          TEXT,
  unlimited      INTEGER NOT NULL DEFAULT 0,
  paid_at        TEXT,
  stripe_session TEXT,
  created        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unlimited/archive flights started by paying players (the refund rule:
-- refundable only if there are no plays after paid_at).
CREATE TABLE IF NOT EXISTS plays (
  sub      TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
