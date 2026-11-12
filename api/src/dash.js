/* ==========================================================================
   KÁRMÁN · api/src/dash.js
   The owner dashboard's numbers: GET /api/admin/stats (v2), built here.

   Cost model (Cloudflare D1 free tier: 5M rows read a day). Nothing here
   scans all of history on a normal build:
     · live numbers come from today's and yesterday's rows (index ranges);
     · closed flights (n <= today - 2) are frozen once into day_stats;
     · retention per daily cohort is written into cohort_ret as each window
       closes (never shown before it has closed);
     · per-device firsts / lasts / streaks live in `pilots`, kept up to date
       by /api/hit and /api/result.
   Catch-up work (the one-time pilots backfill for devices from before the
   table existed, freezing older days, older cohorts, payments recorded before
   the payments table) runs a bounded slice per build, so even the first
   builds after deploy stay far below the daily quota.

   The owner's own devices (ignore_devices) and Google accounts (ignore_subs)
   are left out of every number, money included.
   ========================================================================== */

export const RUN_BASE = 1000000;
const LEGS = 7;
const MAX_PTS = LEGS * 100;
const NOTME = 'device NOT IN (SELECT device FROM ignore_devices)';
const NOTSUB = 'sub NOT IN (SELECT sub FROM ignore_subs)';
const BF_CHUNK = 1000;        // devices per pilots-backfill slice
const FREEZE_MAX = 5;         // closed days frozen per build
const COHORT_MAX = 8;         // cohorts whose retention is updated per build
const PAY_BF_MAX = 8;         // older purchases looked up on Stripe per build
export const RET_K = [1, 2, 3, 4, 5, 6, 7, 14, 21, 28, 30];
const KEEP_EVENTS = 60;       // days of per-device event rows kept
export const EVENT_KINDS = ['paywall_view', 'buy_click', 'share', 'pass_redeem', 'error', 'stats_down'];

/* ---------------------------------------------------------- Eastern time
   US rule since 2007: daylight time from the second Sunday of March 2:00 to
   the first Sunday of November 2:00, local. Arithmetic instead of Intl: the
   dashboard converts hundreds of hour buckets and Intl is slow on Workers. */
function nthSunday(y, m, nth) {      // day-of-month of the nth Sunday (m 0-based)
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (nth - 1) * 7;
}
export function etOffsetMs(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);     // 2:00 EST = 07:00 UTC
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);     // 2:00 EDT = 06:00 UTC
  return (ms >= start && ms < end ? -4 : -5) * 36e5;
}
/** { n: flight number, h: ET hour 0–23 } of a UTC instant. */
export function etFlightHour(ms, launch) {
  const local = ms + etOffsetMs(ms);
  return { n: Math.floor((local - launch) / 864e5) + 1, h: Math.floor((((local % 864e5) + 864e5) % 864e5) / 36e5) };
}
const msOf = (s) => Date.parse(`${String(s).replace(' ', 'T').slice(0, 13)}:00:00Z`);

const legCols = () => {
  const c = [];
  for (let i = 1; i <= LEGS; i++) {
    c.push(`SUM(substr(legs,${i},1)='1') AS h${i}`);
    for (let k = 0; k < 5; k++) c.push(`SUM(substr(chips,${i},1)='${k}') AS c${i}_${k}`);
  }
  for (let k = 0; k < 5; k++) c.push(`SUM(${Array.from({ length: LEGS }, (_, i) => `(substr(chips,${i + 1},1)='${k}' AND substr(legs,${i + 1},1)='1')`).join(' + ')}) AS l${k}`);
  return c.join(', ');
};
const LEG_COLS = legCols();

export async function buildDashboard(env, { T, launch, priceCents, health, stripeGet, d1Usage }) {
  const t0 = Date.now();
  const cost = { rowsRead: 0, rowsWritten: 0, queries: 0, frozen: [], cohorts: [], backfilled: 0, payments: 0 };
  const track = (r) => { cost.queries++; const m = r && r.meta; if (m) { cost.rowsRead += m.rows_read || 0; cost.rowsWritten += m.rows_written || 0; } return r; };
  const all = async (sql, ...a) => (track(await env.DB.prepare(sql).bind(...a).all()).results || []);
  const one = async (sql, ...a) => (await all(sql, ...a))[0] || {};
  const run = async (sql, ...a) => track(await env.DB.prepare(sql).bind(...a).run());
  const fh = (ms) => etFlightHour(ms, launch);

  /** Every number for one flight day d. mau: 'mau' | 'wau' | false. */
  async function dayNumbers(d, mau) {
    const lo = Math.max(1, d - 29), wlo = Math.max(1, d - 6);
    const [agg, hist, hrs, vis, nv, np, act] = await Promise.all([
      one(`SELECT COUNT(*) AS fin, ROUND(AVG(pts), 1) AS avg, MAX(pts) AS best, SUM(pts >= ${MAX_PTS}) AS karman, ${LEG_COLS},
          SUM(NOT EXISTS (SELECT 1 FROM results q WHERE q.device = r.device AND q.n BETWEEN ? AND ?)) AS gap7
        FROM results r WHERE n = ? AND ${NOTME}`, d - 7, d - 1, d),
      all(`SELECT MIN(pts / 70, 10) AS b, COUNT(*) AS c FROM results WHERE n = ? AND ${NOTME} GROUP BY b`, d),
      all(`SELECT substr(created, 1, 13) AS h, COUNT(*) AS c FROM results WHERE n = ? AND ${NOTME} GROUP BY h`, d),
      one(`SELECT COUNT(*) AS opened, SUM(mobile) AS mobile, SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = v.device AND r.n = v.day)) AS fo
        FROM visits v WHERE day = ? AND ${NOTME}`, d),
      one(`SELECT COUNT(*) AS nv, SUM(first_flight = first_seen) AS act, SUM(first_flight IS NOT NULL) AS fin FROM pilots WHERE first_seen = ? AND ${NOTME}`, d),
      one(`SELECT COUNT(*) AS np FROM pilots WHERE first_flight = ? AND ${NOTME}`, d),
      mau ? one(`SELECT COUNT(DISTINCT CASE WHEN n >= ? THEN device END) AS wau${mau === 'mau' ? ', COUNT(DISTINCT device) AS mau' : ''}
        FROM results WHERE n BETWEEN ? AND ? AND ${NOTME}`, wlo, mau === 'mau' ? lo : wlo, d) : null,
    ]);
    const fin = agg.fin || 0;
    const h = Array(11).fill(0);
    hist.forEach((r) => { h[Math.max(0, Math.min(10, r.b))] += r.c; });
    const hours = Array(24).fill(0);
    hrs.forEach((r) => { const x = fh(msOf(r.h)); hours[x.n > d ? 23 : x.n < d ? 0 : x.h] += r.c; });
    const out = {
      n: d, fin, avg: agg.avg || 0, best: agg.best || 0, karman: agg.karman || 0,
      opened: vis.opened || 0, mobile: vis.mobile || 0, fo: vis.fo || 0,
      nv: nv.nv || 0, act: nv.act || 0, nvFin: nv.fin || 0, np: np.np || 0,
      react: Math.max(0, (agg.gap7 || 0) - (np.np || 0)),
      legs: Array.from({ length: LEGS }, (_, i) => agg[`h${i + 1}`] || 0),
      mix: Array.from({ length: LEGS }, (_, i) => [0, 1, 2, 3, 4].map((k) => agg[`c${i + 1}_${k}`] || 0)),
      landed: [0, 1, 2, 3, 4].map((k) => agg[`l${k}`] || 0),
      hist: h, hours,
    };
    if (act) { out.wau = act.wau || 0; if (mau === 'mau') out.mau = act.mau || 0; }
    return out;
  }

  /* ------------------------------------------------ 1. pilots backfill (once) */
  const metaRows = Object.fromEntries((await all("SELECT k, v FROM meta WHERE k LIKE 'pilots_bf%'")).map((r) => [r.k, r.v]));
  let bfDone = metaRows.pilots_bf === 'done';
  const backfill = { pilots: bfDone ? 'done' : 'running', devices: Number(metaRows.pilots_bf_n || 0) };
  if (!bfDone) {
    let rc = metaRows.pilots_bf_r || '', vc = metaRows.pilots_bf_v || '';
    const END = '~';        // sorts after every device id ([\w-]): that side is finished
    let devs = 0;
    if (rc !== END) {
      const ids = await all(`SELECT device FROM results WHERE device > ? GROUP BY device ORDER BY device LIMIT ${BF_CHUNK}`, rc);
      if (ids.length) {
        const hi = ids[ids.length - 1].device;
        // Absolute values from every result of these devices (so live increments
        // that landed earlier are simply recounted). streak = the run of
        // consecutive flights that ends at the last one.
        await run(`INSERT INTO pilots (device, first_seen, first_flight, last_flight, flights, streak)
          SELECT device, MIN(n), MIN(n), MAX(n), COUNT(*), SUM(g = l - c) FROM (
            SELECT device, n, n - ROW_NUMBER() OVER (PARTITION BY device ORDER BY n) AS g,
              MAX(n) OVER (PARTITION BY device) AS l, COUNT(*) OVER (PARTITION BY device) AS c
            FROM results WHERE device > ? AND device <= ? AND n < ${RUN_BASE}) WHERE true GROUP BY device
          ON CONFLICT(device) DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen), first_flight = excluded.first_flight,
            last_flight = excluded.last_flight, flights = excluded.flights, streak = excluded.streak`, rc, hi);
        devs += ids.length; rc = hi;
      }
      if (ids.length < BF_CHUNK) rc = END;
    }
    if (vc !== END) {
      const ids = await all(`SELECT device FROM visits WHERE device > ? GROUP BY device ORDER BY device LIMIT ${BF_CHUNK}`, vc);
      if (ids.length) {
        const hi = ids[ids.length - 1].device;
        await run(`INSERT INTO pilots (device, first_seen, first_src, country, mobile)
          SELECT device, day, src, country, mobile FROM (
            SELECT device, day, src, country, mobile, ROW_NUMBER() OVER (PARTITION BY device ORDER BY day) AS k
            FROM visits WHERE device > ? AND device <= ?) WHERE k = 1
          ON CONFLICT(device) DO UPDATE SET
            first_src = CASE WHEN first_src IS NULL OR excluded.first_seen <= first_seen THEN excluded.first_src ELSE first_src END,
            country = COALESCE(country, excluded.country), mobile = COALESCE(mobile, excluded.mobile),
            first_seen = MIN(first_seen, excluded.first_seen)`, vc, hi);
        devs += ids.length; vc = hi;
      }
      if (ids.length < BF_CHUNK) vc = END;
    }
    bfDone = rc === END && vc === END;
    backfill.devices += devs; backfill.pilots = bfDone ? 'done' : 'running';
    cost.backfilled = devs;
    await run(`INSERT INTO meta (k, v) VALUES ('pilots_bf_r', ?), ('pilots_bf_v', ?), ('pilots_bf_n', ?), ('pilots_bf', ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v`, rc, vc, String(backfill.devices), bfDone ? 'done' : 'running');
  }

  /* ------------------------------------------------ 2. payments recorded before the payments table */
  {
    const need = await all(`SELECT u.sub, u.stripe_session AS s, COALESCE(u.paid_at, u.created) AS at, r.at AS refunded_at
      FROM users u LEFT JOIN refunds r ON r.sub = u.sub
      WHERE (u.paid_at IS NOT NULL OR u.unlimited = 1) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sub = u.sub) LIMIT ${PAY_BF_MAX}`);
    for (const u of need) {
      let row = null;
      if (u.s && env.STRIPE_SECRET_KEY && stripeGet) {
        try {
          const cs = await stripeGet(env, `checkout/sessions/${encodeURIComponent(u.s)}?expand[]=payment_intent.latest_charge`);
          if (cs && cs.payment_status === 'paid' && Number.isInteger(cs.amount_total)) {
            const ch = cs.payment_intent && cs.payment_intent.latest_charge;
            const refunded = ch && Number.isInteger(ch.amount_refunded) ? ch.amount_refunded : 0;
            row = [u.s, u.sub, cs.amount_total, cs.currency || 'usd', cs.created ? new Date(cs.created * 1000).toISOString().slice(0, 19).replace('T', ' ') : u.at, refunded, refunded ? (u.refunded_at || u.at) : null, 0];
          }
        } catch (e) {
          if (!/stripe 404/.test(String(e && e.message))) continue;   // Stripe unreachable: try again on a later build
        }
      }
      // No session or Stripe can't say: the list price, marked as an estimate.
      if (!row) row = [u.s || `legacy-${u.sub}`, u.sub, priceCents, 'usd', u.at, u.refunded_at ? priceCents : 0, u.refunded_at || null, 1];
      await run(`INSERT OR IGNORE INTO payments (session, sub, amount, currency, at, refunded, refunded_at, est) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ...row);
      cost.payments++;
    }
  }

  /* ------------------------------------------------ 3. closed days: read, freeze what's missing */
  const dayMap = {};
  (await all('SELECT n, data FROM day_stats WHERE n <= ?', T - 2)).forEach((r) => { try { dayMap[r.n] = JSON.parse(r.data); } catch (e) { /* refrozen below */ } });
  if (bfDone) {
    const todo = [];
    for (let d = T - 2; d >= 1 && todo.length < FREEZE_MAX; d--) if (!dayMap[d]) todo.push(d);
    for (const d of todo) {
      const x = await dayNumbers(d, d >= T - 14 ? 'mau' : 'wau');
      await run("INSERT INTO day_stats (n, data) VALUES (?, ?) ON CONFLICT(n) DO UPDATE SET data = excluded.data, updated = datetime('now')", d, JSON.stringify(x));
      dayMap[d] = x; cost.frozen.push(d);
    }
    if (todo.length) await run('DELETE FROM events WHERE day < ?', T - KEEP_EVENTS);
  }

  /* ------------------------------------------------ 4. retention, as each window closes */
  const cohMap = {};
  (await all('SELECT n, size, ret FROM cohort_ret')).forEach((r) => { let ret = {}; try { ret = JSON.parse(r.ret || '{}'); } catch (e) { /* recount */ } cohMap[r.n] = { n: r.n, size: r.size, ret }; });
  if (bfDone) {
    const todo = [];
    for (let c = T - 3; c >= 1 && todo.length < COHORT_MAX; c--) {
      const have = cohMap[c] ? cohMap[c].ret : {};
      const ks = RET_K.filter((k) => c + k <= T - 2 && !(k in have));
      if (ks.length) todo.push([c, ks, have]);
    }
    for (const [c, ks, have] of todo) {
      const r = await one(`SELECT COUNT(*) AS size, ${ks.map((k) => `SUM(EXISTS (SELECT 1 FROM results q WHERE q.device = p.device AND q.n = p.first_flight + ${k})) AS k${k}`).join(', ')}
        FROM pilots p WHERE first_flight = ? AND ${NOTME}`, c);
      const ret = { ...have };
      ks.forEach((k) => { ret[k] = r[`k${k}`] || 0; });
      await run("INSERT INTO cohort_ret (n, size, ret) VALUES (?, ?, ?) ON CONFLICT(n) DO UPDATE SET size = excluded.size, ret = excluded.ret, updated = datetime('now')", c, r.size || 0, JSON.stringify(ret));
      cohMap[c] = { n: c, size: r.size || 0, ret }; cost.cohorts.push(c);
    }
  }

  /* ------------------------------------------------ 5. live reads */
  const RB1 = RUN_BASE + 1;
  const [live0, live1, yCoh, act, flown, core, counters, acq, geo, pays, checkouts, buyers, acct, runsH, runsP, passes, reports, excluded] = await Promise.all([
    dayNumbers(T, false),
    T > 1 ? dayNumbers(T - 1, false) : null,
    one(`SELECT COUNT(*) AS size, SUM(EXISTS (SELECT 1 FROM results q WHERE q.device = p.device AND q.n = ?)) AS back FROM pilots p WHERE first_flight = ? AND ${NOTME}`, T, T - 1),
    one(`SELECT COUNT(*) AS mau, SUM(last_flight >= ?) AS wau, SUM(last_flight = ?) AS today,
        SUM(last_flight >= ? AND streak >= 3) AS streak3, SUM(last_flight >= ? AND streak >= 7) AS streak7, MAX(streak) AS best,
        SUM(flights >= 3 AND last_flight = ?) AS r0, SUM(flights >= 3 AND last_flight BETWEEN ? AND ?) AS r12,
        SUM(flights >= 3 AND last_flight BETWEEN ? AND ?) AS r36, SUM(flights >= 3 AND last_flight < ?) AS r7
      FROM pilots WHERE last_flight >= ? AND ${NOTME}`, T - 6, T, T - 1, T - 1, T, T - 2, T - 1, T - 6, T - 3, T - 6, T - 29),
    all(`SELECT MIN(flights, 31) AS f, COUNT(*) AS c FROM pilots WHERE last_flight >= ? AND ${NOTME} GROUP BY f`, T - 29),
    one(`SELECT COUNT(*) AS c FROM (SELECT device FROM results WHERE n BETWEEN ? AND ? AND ${NOTME} GROUP BY device HAVING COUNT(*) >= 5)`, T - 7, T - 1),
    all('SELECT day, kind, n FROM counters WHERE day >= ?', T - 89),
    all(`SELECT COALESCE(first_src, 'unknown') AS src, first_seen AS n, COUNT(*) AS nv, SUM(first_flight IS NOT NULL) AS fin, SUM(first_flight = first_seen) AS act
      FROM pilots WHERE first_seen BETWEEN ? AND ? AND ${NOTME} GROUP BY src, first_seen`, T - 13, T),
    all(`SELECT COALESCE(country, '??') AS cc, COUNT(*) AS c, SUM(mobile) AS m FROM pilots WHERE first_seen BETWEEN ? AND ? AND ${NOTME} GROUP BY cc ORDER BY c DESC`, T - 6, T),
    all(`SELECT p.amount, p.currency, p.at, p.refunded, p.refunded_at, p.est, cs.src, cs.first_flight, cs.flights
      FROM payments p LEFT JOIN checkout_src cs ON cs.id = p.session WHERE p.${NOTSUB} ORDER BY p.at`),
    all(`SELECT sub, created FROM checkouts WHERE created >= datetime('now', '-60 days') AND ${NOTSUB}`),
    all(`SELECT u.email, p.at, cs.src FROM payments p JOIN users u ON u.sub = p.sub LEFT JOIN checkout_src cs ON cs.id = p.session
      WHERE p.refunded < p.amount AND p.${NOTSUB} ORDER BY p.at DESC LIMIT 8`),
    one(`SELECT (SELECT COUNT(*) FROM users WHERE ${NOTSUB}) AS accounts, (SELECT COUNT(*) FROM saves WHERE ${NOTSUB}) AS saves,
      (SELECT COUNT(*) FROM plays WHERE at >= datetime('now', '-7 days') AND ${NOTSUB}) AS plays7`),
    all(`SELECT n = ${RB1} AS free, substr(created, 1, 13) AS h, COUNT(*) AS c FROM results WHERE n > ${RUN_BASE} AND ${NOTME} GROUP BY free, h`),
    one(`SELECT COUNT(DISTINCT CASE WHEN n > ${RB1} THEN device END) AS paid, COUNT(DISTINCT CASE WHEN created >= datetime('now', '-7 days') THEN device END) AS week
      FROM results WHERE n > ${RUN_BASE} AND ${NOTME}`),
    one(`SELECT COUNT(*) AS made, SUM(active) AS active, (SELECT COUNT(*) FROM unlock_claims) AS claimed,
      SUM(active = 1 AND created < datetime('now', '-14 days') AND code NOT IN (SELECT code FROM unlock_uses)) AS stale FROM unlock_codes`),
    all(`SELECT qid, MAX(n) AS n, COUNT(*) AS c, MAX(created) AS last FROM reports
      WHERE created > datetime('now', '-60 days') AND ${NOTME} GROUP BY qid ORDER BY c DESC, last DESC LIMIT 20`),
    one('SELECT (SELECT COUNT(*) FROM ignore_devices) AS devices, (SELECT COUNT(*) FROM ignore_subs) AS subs'),
  ]);

  /* ------------------------------------------------ 6. assemble */
  const ev = {};
  counters.forEach((r) => { (ev[r.day] = ev[r.day] || {})[r.kind] = r.n; });
  const days = [];
  for (let n = 1; n <= T; n++) {
    const x = n === T ? live0 : n === T - 1 ? live1 : dayMap[n];
    days.push(x ? { ...x, closed: n <= T - 2, ev: ev[n] || {} } : { n, closed: true, pending: true, ev: ev[n] || {} });
  }

  // Unlimited runs, bucketed by Eastern flight day.
  const runsByDay = {};
  let freeRunPilots = 0, paidRuns = 0;
  runsH.forEach((r) => {
    const d = fh(msOf(r.h)).n;
    const b = runsByDay[d] = runsByDay[d] || [0, 0];
    b[r.free ? 0 : 1] += r.c;
    if (r.free) freeRunPilots += r.c; else paidRuns += r.c;
  });

  // Checkouts → payments, by account (subs never leave the Worker).
  const paidSubsAt = {};
  const subPay = await all(`SELECT sub, MIN(at) AS at FROM payments WHERE ${NOTSUB} GROUP BY sub`);
  subPay.forEach((r) => { paidSubsAt[r.sub] = r.at; });
  const nowMs = Date.now();
  const ago = (s) => nowMs - Date.parse(`${String(s).replace(' ', 'T')}Z`);
  const winCheckouts = (lo, hi = 0) => {
    const subs = new Set();
    checkouts.forEach((c) => { const a = ago(c.created); if (a <= lo && a >= hi) subs.add(c.sub); });
    let paid = 0;
    subs.forEach((s) => { if (paidSubsAt[s]) paid++; });
    return { started: subs.size, paid };
  };
  const sumEv = (kind, from, to = T) => { let s = 0; for (let n = from; n <= to; n++) s += (ev[n] && ev[n][kind]) || 0; return s; };
  const pay30 = pays.filter((p) => ago(p.at) <= 30 * 864e5);
  const evSince = Object.keys(ev).length ? Math.min(...Object.keys(ev).map(Number)) : null;

  const out = {
    v: 2, T, launch, priceCents, maxPts: MAX_PTS, now: new Date(nowMs).toISOString(), builtAt: nowMs,
    retK: RET_K,
    excluded: { devices: excluded.devices || 0, subs: excluded.subs || 0 },
    backfill: { ...backfill, pendingDays: days.filter((d) => d.pending).length },
    days,
    yesterdayCohort: { n: T - 1, size: yCoh.size || 0, back: yCoh.back || 0 },
    cohorts: Object.values(cohMap).sort((a, b) => a.n - b.n),
    active: {
      wau: act.wau || 0, mau: act.mau || 0, today: act.today || 0,
      streak3: act.streak3 || 0, streak7: act.streak7 || 0, bestStreak: act.best || 0,
      regulars: { today: act.r0 || 0, d1_2: act.r12 || 0, d3_6: act.r36 || 0, d7_29: act.r7 || 0 },
      flown: flown.map((r) => [r.f, r.c]).sort((a, b) => a[0] - b[0]),
      core: core.c || 0,
    },
    acquisition: acq,
    geo7: { countries: geo.map((r) => [r.cc, r.c]), mobile: geo.reduce((a, r) => a + (r.m || 0), 0), total: geo.reduce((a, r) => a + r.c, 0) },
    money: {
      payments: pays.map((p) => ({ at: p.at, amount: p.amount, currency: p.currency, refunded: p.refunded, refundedAt: p.refunded_at, est: p.est, src: p.src || null, firstFlight: p.first_flight, flights: p.flights })),
      buyers: buyers.map((b) => ({ email: b.email || '', at: b.at, src: b.src || null })),
      checkouts: { d30: winCheckouts(30 * 864e5), d60: winCheckouts(60 * 864e5), h24: winCheckouts(864e5, 30 * 6e4) },
      funnel30: {
        paywall: sumEv('paywall_view', T - 29), buy: sumEv('buy_click', T - 29),
        checkout: winCheckouts(30 * 864e5).started,
        paid: pay30.length, kept: pay30.filter((p) => p.refunded < p.amount).length,
        since: evSince,
      },
      accounts: acct.accounts || 0, saves: acct.saves || 0, plays7: acct.plays7 || 0,
    },
    unlimited: { runsByDay, freeRunPilots, paidRuns, paidPilots: runsP.paid || 0, pilotsWeek: runsP.week || 0 },
    passes: { made: passes.made || 0, active: passes.active || 0, claimed: passes.claimed || 0, stale: passes.stale || 0 },
    reports,
    health: { stripe: health, d1: null },
  };
  if (d1Usage) { try { out.health.d1 = await d1Usage(env); } catch (e) { /* shown as unknown */ } }
  cost.ms = Date.now() - t0;
  out.cost = cost;
  return out;
}
