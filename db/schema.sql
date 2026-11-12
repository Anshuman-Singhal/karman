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

-- One thank-you email per paying account (sent through Resend when
-- RESEND_API_KEY is set). The row is the "sent" mark, so it never repeats.
CREATE TABLE IF NOT EXISTS thanks (
  sub      TEXT PRIMARY KEY,
  email    TEXT,
  id       TEXT,                       -- the email provider's message id
  sent     TEXT NOT NULL DEFAULT (datetime('now'))
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

-- ---------------------------------------------------------------------------
-- Owner dashboard v2 ("flight deck", karman.day/dev). Everything below is
-- additive (CREATE ... IF NOT EXISTS, no ALTER): the Worker re-runs this file
-- on every cold start, so it must be safe to repeat forever.

-- One row per device, kept up to date by /api/hit and /api/result, so the
-- dashboard never has to scan all of history. first_seen = first flight
-- number this device opened or finished; first_flight / last_flight / flights
-- count DAILY flights only (archive replays and Unlimited runs excluded);
-- streak = consecutive daily flights ending at last_flight (Thermals ignored).
-- Rows for devices from before this table existed are filled in a few
-- thousand at a time by the dashboard itself (see meta 'pilots_bf').
CREATE TABLE IF NOT EXISTS pilots (
  device       TEXT PRIMARY KEY,
  first_seen   INTEGER NOT NULL,
  first_src    TEXT,
  country      TEXT,
  mobile       INTEGER,
  first_flight INTEGER,
  last_flight  INTEGER,
  flights      INTEGER NOT NULL DEFAULT 0,
  streak       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pilots_by_first ON pilots (first_flight);
CREATE INDEX IF NOT EXISTS pilots_by_seen ON pilots (first_seen);
CREATE INDEX IF NOT EXISTS pilots_by_last ON pilots (last_flight);

-- The numbers of each closed flight (n <= today - 2), frozen once by the
-- dashboard so later loads read one row instead of the whole day. data is JSON.
CREATE TABLE IF NOT EXISTS day_stats (
  n        INTEGER PRIMARY KEY,
  data     TEXT NOT NULL,
  updated  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Retention per daily cohort (pilots whose first daily flight was n): ret is
-- JSON { "1": back on day n+1, "7": …, "30": … }, each key written only once
-- its day has closed, so an unfinished window is never shown as final.
CREATE TABLE IF NOT EXISTS cohort_ret (
  n        INTEGER PRIMARY KEY,
  size     INTEGER NOT NULL,
  ret      TEXT NOT NULL DEFAULT '{}',
  updated  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anonymous product events (paywall seen, buy pressed, shared, pass redeemed,
-- an error; 'run' = flew a paid Unlimited run): at most one row per device per
-- kind per flight day. No cookies, nothing personal: the same random device id
-- as /api/hit. Purged after 60 days. WITHOUT ROWID: the key is the row, so
-- each event is one write, not two.
CREATE TABLE IF NOT EXISTS events (
  day      INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  device   TEXT    NOT NULL,
  PRIMARY KEY (day, kind, device)
) WITHOUT ROWID;
-- Per-day counts the dashboard reads: distinct devices per event kind, and
-- Unlimited runs finished ('runs_free' = the one free run, 'runs_paid').
CREATE TABLE IF NOT EXISTS counters (
  day      INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
) WITHOUT ROWID;

-- What Stripe actually charged (amount_total, in the smallest currency unit)
-- and refunded, one row per paid Checkout session. est = 1: filled in from
-- PRICE_CENTS because Stripe couldn't tell us (older purchases).
CREATE TABLE IF NOT EXISTS payments (
  session     TEXT PRIMARY KEY,
  sub         TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'usd',
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  refunded    INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  est         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS payments_by_sub ON payments (sub);

-- Where a checkout came from: the buyer's first flight, first source and
-- flights flown before buying, copied from pilots. Never the device id.
CREATE TABLE IF NOT EXISTS checkout_src (
  id           TEXT PRIMARY KEY,
  first_flight INTEGER,
  first_seen   INTEGER,
  src          TEXT,
  flights      INTEGER
);

-- The owner's own browsers and Google accounts, left out of every number.
CREATE TABLE IF NOT EXISTS ignore_devices (
  device   TEXT PRIMARY KEY,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ignore_subs (
  sub      TEXT PRIMARY KEY,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small bookkeeping for the dashboard (backfill progress and the like).
CREATE TABLE IF NOT EXISTS meta (
  k        TEXT PRIMARY KEY,
  v        TEXT
);
-- When this version first ran: Unlimited runs from then on are counted as they
-- land; older ones are counted once by the dashboard. Kept forever (OR IGNORE).
INSERT OR IGNORE INTO meta (k, v) VALUES ('live_from', datetime('now'));

-- "Paid flights started this week" without reading every play ever logged.
CREATE INDEX IF NOT EXISTS plays_by_at ON plays (at);
