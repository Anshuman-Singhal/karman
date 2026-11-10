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
-- "did this device fly flight n?" (the dashboard's retention and finish-rate
-- checks) is one index lookup instead of reading that whole flight.
CREATE INDEX IF NOT EXISTS results_by_device ON results (device, n);

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

-- When each unlock link was first and last checked by a browser (so the
-- owner can see a pass was used). No device ids, just the times.
CREATE TABLE IF NOT EXISTS unlock_uses (
  code     TEXT PRIMARY KEY,
  first    TEXT NOT NULL DEFAULT (datetime('now')),
  last     TEXT NOT NULL DEFAULT (datetime('now')),
  checks   INTEGER NOT NULL DEFAULT 1
);

-- Free passes (PASS-…) work on ONE device: the first browser to open the
-- link claims it. device is that browser's random stats id, nothing more.
CREATE TABLE IF NOT EXISTS unlock_claims (
  code     TEXT PRIMARY KEY,
  device   TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Every Stripe Checkout session opened for an account. If the webhook is ever
-- late or lost, the Worker asks Stripe about these directly, so a payment can
-- never go unrecognised.
CREATE TABLE IF NOT EXISTS checkouts (
  id       TEXT PRIMARY KEY,           -- Stripe Checkout session id (cs_...)
  sub      TEXT NOT NULL,
  created  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checkouts_by_sub ON checkouts (sub, created);

-- Accounts whose payment was refunded. The only thing that ever takes a
-- purchase away from a device.
CREATE TABLE IF NOT EXISTS refunds (
  sub      TEXT PRIMARY KEY,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cloud copy of a signed-in pilot's progress (web/js/sync.js). The browser
-- merges before it writes; ver refuses a write based on a stale copy.
CREATE TABLE IF NOT EXISTS saves (
  sub      TEXT PRIMARY KEY,
  data     TEXT NOT NULL,
  ver      INTEGER NOT NULL DEFAULT 1,
  updated  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per device per day it opened the game (first open that day only),
-- for the owner's dashboard: how many people came, from where, and how many
-- of them finished. Coarse on purpose: the referring site, the country
-- Cloudflare already knows, phone or not. No IP, no cookies.
CREATE TABLE IF NOT EXISTS visits (
  day      INTEGER NOT NULL,           -- flight number of that day
  device   TEXT    NOT NULL,
  src      TEXT    NOT NULL DEFAULT 'direct',
  country  TEXT,
  mobile   INTEGER NOT NULL DEFAULT 0,
  created  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, device)
);
CREATE INDEX IF NOT EXISTS visits_by_device ON visits (device, day);
