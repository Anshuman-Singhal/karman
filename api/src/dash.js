/* ==========================================================================
   KÁRMÁN · api/src/dash.js
   The owner dashboard's numbers: GET /api/admin/stats (v2), built here.

   Cost model (Cloudflare D1 free tier: 5M rows read and 100k written a day).
   Nothing here scans all of history on a normal build:
     · live numbers come from the still-open days' rows (index ranges);
     · closed flights are frozen once into day_stats (oldest first, so weekly
       and monthly pilots roll forward from the day before instead of
       re-reading 30 days);
     · retention per daily cohort is written into cohort_ret as each window
       closes (never shown before it has closed);
     · per-device firsts / lasts / streaks live in `pilots`, kept by /api/hit
       and /api/result; Unlimited runs are counted in `counters` as they land.
   Catch-up work (the one-time pilots backfill, freezing older days, older
   cohorts, older Unlimited runs and purchases) is paid for from a row
   budget: about 150k rows per build (a first step may go to 300k) and 1.5M
   per UTC day, so even a big history never threatens the 5M daily quota;
   it simply takes a few builds (or days) to finish, and the page says so.

   The owner's own devices (ignore_devices) and Google accounts (ignore_subs)
   are left out of every number, money included.
   ========================================================================== */

export const RUN_BASE = 1000000;
const LEGS = 7;
const MAX_PTS = LEGS * 100;
const NOTME = 'device NOT IN (SELECT device FROM ignore_devices)';
const NOTSUB = 'sub NOT IN (SELECT sub FROM ignore_subs)';
const LIMITS = { soft: 150000, hard: 300000, daily: 1500000, chunk: 1000 };
const PAY_BF_MAX = 8;          // older purchases looked up on Stripe per day
export const RET_K = [1, 2, 3, 4, 5, 6, 7, 14, 21, 28, 30];
const KEEP_EVENTS = 60;        // days of per-device event rows kept
const FULL_DAYS = 35;          // older frozen days keep totals only (no hours / histogram)
export const EVENT_KINDS = ['paywall_view', 'buy_click', 'share', 'pass_redeem', 'error', 'stats_down'];
export const maskEmail = (e) => { const [u, d] = String(e || '').split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : ''; };

/* ---------------------------------------------------------- Eastern time
   US rule since 2007: daylight time from the second Sunday of March 2:00 to
   the first Sunday of November 2:00, local. Arithmetic instead of Intl: the
   dashboard converts hundreds of hour buckets and Intl is slow on Workers. */
function nthSunday(y, m, nth) {      // day-of-month of the nth Sunday (m 0-based)
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (nth - 1) * 7;
}
const dstSpan = (y) => [Date.UTC(y, 2, nthSunday(y, 2, 2), 7), Date.UTC(y, 10, nthSunday(y, 10, 1), 6)];
export function etOffsetMs(ms) {
  const [start, end] = dstSpan(new Date(ms).getUTCFullYear());
  return (ms >= start && ms < end ? -4 : -5) * 36e5;
}
/** { n: flight number, h: ET hour 0–23 } of a UTC instant. */
export function etFlightHour(ms, launch) {
  const local = ms + etOffsetMs(ms);
  return { n: Math.floor((local - launch) / 864e5) + 1, h: Math.floor((((local % 864e5) + 864e5) % 864e5) / 36e5) };
}
/** SQL: the ET flight number of a 'YYYY-MM-DD HH:MM:SS' UTC column (same rule, for one-off backfills). */
export function flightSql(col, launch, nowMs = Date.now()) {
  const sq = (ms) => `'${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}'`;
  const ys = []; for (let y = new Date(launch).getUTCFullYear() - 1; y <= new Date(nowMs).getUTCFullYear() + 1; y++) ys.push(y);
  const off = `CASE ${ys.map((y) => { const [a, b] = dstSpan(y); return `WHEN ${col} >= ${sq(a)} AND ${col} < ${sq(b)} THEN '-4 hours'`; }).join(' ')} ELSE '-5 hours' END`;
  return `(CAST(julianday(date(${col}, ${off})) - julianday(${sq(launch).slice(0, 11)}') AS INTEGER) + 1)`;
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
const ex = (lo, hi) => `NOT EXISTS (SELECT 1 FROM results q WHERE q.device = r.device AND q.n BETWEEN ${lo} AND ${hi})`;

/**
 * T: today's flight. TC: the flight two hours ago (results for T-2 are still
 * accepted in the first two hours of T), so days n <= TC - 2 are closed.
 */
export async function buildDashboard(env, { T, TC = T, launch, priceCents, health, stripeGet, d1Usage, nowMs = Date.now() }) {
  const t0 = Date.now();
  const L = { ...LIMITS, ...(env.DASH_LIMITS || {}) };
  const CLOSED = TC - 2;
  const cost = { rowsRead: 0, rowsWritten: 0, queries: 0, catchUp: 0, frozen: [], cohorts: [], backfilled: 0, payments: 0, estimated: false };
  // D1 reports rows read per query; without it (tests) count rows returned, so budgets still bite.
  const track = (r) => {
    cost.queries++;
    const m = r && r.meta;
    if (m && m.rows_read != null) { cost.rowsRead += m.rows_read || 0; cost.rowsWritten += m.rows_written || 0; } else { cost.estimated = true; cost.rowsRead += ((r && r.results) || []).length + 1; }
    return r;
  };
  const all = async (sql, ...a) => (track(await env.DB.prepare(sql).bind(...a).all()).results || []);
  const one = async (sql, ...a) => (await all(sql, ...a))[0] || {};
  const run = async (sql, ...a) => track(await env.DB.prepare(sql).bind(...a).run());
  const fh = (ms) => etFlightHour(ms, launch);
  const sqlNow = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');

  const meta = Object.fromEntries((await all('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
  // How many devices are left out right now: a frozen day remembers it, so rolled
  // weekly/monthly counts are recounted once the exclusions change.
  const exNow = (await one('SELECT COUNT(*) AS c FROM ignore_devices')).c || 0;
  const rebuildFrom = Number(meta.rebuild_from || 0);
  const utcDay = sqlNow.slice(0, 10);
  const cuUsed = meta.cu_day === utcDay ? Number(meta.cu_rows || 0) : 0;
  /* May a catch-up step start now? It must fit, with the live reads still to come
     (last build's cost) and this kind of step's last observed cost, under the
     soft budget, or under the hard cap for the first step of its kind. A step
     too big for any budget still runs when it is the build's only catch-up. */
  const liveEst = Number(meta.live_rows || 0);
  const stepEst = {};
  const may = (first, kind) => {
    if (cuUsed + cost.catchUp >= L.daily) return false;
    const need = cost.rowsRead + liveEst + (stepEst[kind] || 0);
    return need <= (first ? L.hard : L.soft) || (first && cost.catchUp === 0);
  };
  const spend = async (fn, kind) => { const r0 = cost.rowsRead; try { return await fn(); } finally { const used = cost.rowsRead - r0; cost.catchUp += used; if (kind) stepEst[kind] = Math.max(stepEst[kind] || 0, used); } };
  const metaW = {};

  /** Every number for one flight day d. live: skip what only a frozen day needs. prev: frozen d-1 (for rolling WAU/MAU). */
  async function dayNumbers(d, { live = false, withPilots = true, prev = null, lite = false, core = false } = {}) {
    // Roll forward from the day before, except: the day before was frozen under other
    // exclusions, this is the first day re-frozen by a rebuild, or a weekly checkpoint.
    const rolled = !live && Boolean(prev && prev.mau != null && prev.wau != null) && prev.exN === exNow && d !== rebuildFrom && d % 7 !== 0;
    const [agg, hist, hrs, vis, nv, np, roll, cor] = await Promise.all([
      one(`SELECT COUNT(*) AS fin, ROUND(AVG(pts), 1) AS avg, MAX(pts) AS best, SUM(pts >= ${MAX_PTS}) AS karman, ${LEG_COLS},
          SUM(${ex(d - 7, d - 1)}) AS gap7
        FROM results r WHERE n = ? AND ${NOTME}`, d),
      lite ? [] : all(`SELECT MIN(pts / 70, 10) AS b, COUNT(*) AS c FROM results WHERE n = ? AND ${NOTME} GROUP BY b`, d),
      lite ? [] : all(`SELECT substr(created, 1, 13) AS h, COUNT(*) AS c FROM results WHERE n = ? AND ${NOTME} GROUP BY h`, d),
      one(`SELECT COUNT(*) AS opened, SUM(mobile) AS mobile, SUM(EXISTS (SELECT 1 FROM results r WHERE r.device = v.device AND r.n = v.day)) AS fo
        FROM visits v WHERE day = ? AND ${NOTME}`, d),
      withPilots ? one(`SELECT COUNT(*) AS nv, SUM(first_flight = first_seen) AS act, SUM(first_flight IS NOT NULL) AS fin FROM pilots WHERE first_seen = ? AND ${NOTME}`, d) : null,
      withPilots ? one(`SELECT COUNT(*) AS np FROM pilots WHERE first_flight = ? AND ${NOTME}`, d) : null,
      // weekly / monthly pilots roll forward from the day before: who entered the window today, who left it
      live ? null : rolled
        // entered: flew on d and not in the previous window [d-30, d-1] / [d-7, d-1]; left: flew on d-30 / d-7 and not since
        ? one(`SELECT SUM(n = ?1 AND ${ex('?1 - 30', '?1 - 1')}) AS e30, SUM(n = ?1 AND ${ex('?1 - 7', '?1 - 1')}) AS e7,
              SUM(n = ?1 - 30 AND ${ex('?1 - 29', '?1')}) AS l30, SUM(n = ?1 - 7 AND ${ex('?1 - 6', '?1')}) AS l7
            FROM results r WHERE n IN (?1, ?1 - 7, ?1 - 30) AND ${NOTME}`, d)
        : one(`SELECT COUNT(DISTINCT CASE WHEN n >= ? THEN device END) AS wau, COUNT(DISTINCT device) AS mau FROM results WHERE n BETWEEN ? AND ? AND ${NOTME}`, d - 6, d - 29, d),
      core ? one(`SELECT COUNT(*) AS c FROM (SELECT device FROM results WHERE n BETWEEN ? AND ? AND ${NOTME} GROUP BY device HAVING COUNT(*) >= 5)`, d - 6, d) : null,
    ]);
    const fin = agg.fin || 0;
    const out = {
      n: d, fin, avg: agg.avg || 0, best: agg.best || 0, karman: agg.karman || 0,
      opened: vis.opened || 0, mobile: vis.mobile || 0, fo: vis.fo || 0,
      legs: Array.from({ length: LEGS }, (_, i) => agg[`h${i + 1}`] || 0),
      mix: Array.from({ length: LEGS }, (_, i) => [0, 1, 2, 3, 4].map((k) => agg[`c${i + 1}_${k}`] || 0)),
      landed: [0, 1, 2, 3, 4].map((k) => agg[`l${k}`] || 0),
    };
    if (withPilots) Object.assign(out, { nv: nv.nv || 0, act: nv.act || 0, nvFin: nv.fin || 0, np: np.np || 0, react: Math.max(0, (agg.gap7 || 0) - (np.np || 0)) });
    if (!lite) {
      const h = Array(11).fill(0);
      hist.forEach((r) => { h[Math.max(0, Math.min(10, r.b))] += r.c; });
      const hours = Array(24).fill(0);
      hrs.forEach((r) => { const x = fh(msOf(r.h)); hours[x.n > d ? 23 : x.n < d ? 0 : x.h] += r.c; });
      Object.assign(out, { hist: h, hours });
    }
    if (roll) {
      if (rolled) { out.wau = prev.wau + (roll.e7 || 0) - (roll.l7 || 0); out.mau = prev.mau + (roll.e30 || 0) - (roll.l30 || 0); } else { out.wau = roll.wau || 0; out.mau = roll.mau || 0; }
    }
    if (cor) out.core = cor.c || 0;
    if (!live) out.exN = exNow;
    return out;
  }

  /* ------------------------------------------------ 1. pilots backfill (once), sliced by a row budget */
  let bfDone = meta.pilots_bf === 'done';
  const backfill = { pilots: bfDone ? 'done' : 'running', devices: Number(meta.pilots_bf_n || 0) };
  if (!bfDone) {
    let rc = meta.pilots_bf_r || '', vc = meta.pilots_bf_v || '';
    const END = '~';        // sorts after every device id ([\w-]): that side is finished
    let bfRows = 0, first = true;
    while ((rc !== END || vc !== END) && may(first, 'bf') && bfRows < L.soft) {
      first = false;
      const r0 = cost.rowsRead;
      await spend(async () => {
        const side = rc !== END ? 'r' : 'v';
        const cur = side === 'r' ? rc : vc;
        const ids = await all(`SELECT device FROM ${side === 'r' ? 'results' : 'visits'} WHERE device > ? GROUP BY device ORDER BY device LIMIT ${L.chunk}`, cur);
        let next = cur;
        if (ids.length) {
          const hi = ids[ids.length - 1].device;
          if (side === 'r') {
            // Absolute values from every result of these devices (live increments that
            // landed earlier are simply recounted). streak = the run ending at the last flight.
            await run(`INSERT INTO pilots (device, first_seen, first_flight, last_flight, flights, streak)
              SELECT device, MIN(n), MIN(n), MAX(n), COUNT(*), SUM(g = l - c) FROM (
                SELECT device, n, n - ROW_NUMBER() OVER (PARTITION BY device ORDER BY n) AS g,
                  MAX(n) OVER (PARTITION BY device) AS l, COUNT(*) OVER (PARTITION BY device) AS c
                FROM results WHERE device > ? AND device <= ? AND n < ${RUN_BASE}) WHERE true GROUP BY device
              ON CONFLICT(device) DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen), first_flight = excluded.first_flight,
                last_flight = excluded.last_flight, flights = excluded.flights, streak = excluded.streak`, cur, hi);
          } else {
            await run(`INSERT INTO pilots (device, first_seen, first_src, country, mobile)
              SELECT device, day, src, country, mobile FROM (
                SELECT device, day, src, country, mobile, ROW_NUMBER() OVER (PARTITION BY device ORDER BY day) AS k
                FROM visits WHERE device > ? AND device <= ?) WHERE k = 1
              ON CONFLICT(device) DO UPDATE SET
                first_src = CASE WHEN first_src IS NULL OR excluded.first_seen <= first_seen THEN excluded.first_src ELSE first_src END,
                country = COALESCE(country, excluded.country), mobile = COALESCE(mobile, excluded.mobile),
                first_seen = MIN(first_seen, excluded.first_seen)`, cur, hi);
          }
          backfill.devices += ids.length; cost.backfilled += ids.length; next = hi;
        }
        if (ids.length < L.chunk) next = END;
        if (side === 'r') rc = next; else vc = next;
      }, 'bf');
      bfRows += cost.rowsRead - r0;
    }
    bfDone = rc === END && vc === END;
    backfill.pilots = bfDone ? 'done' : 'running';
    // Device ids are random UUIDs, so how far a cursor has got through the id space
    // estimates the share done (two passes: results, then visits).
    const ALPHA = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    const frac = (c) => (c === END ? 1 : !c ? 0 : /^[0-9a-f]{8}/.test(c) ? parseInt(c.slice(0, 8), 16) / 2 ** 32
      : (Math.max(0, ALPHA.indexOf(c[0])) + Math.max(0, ALPHA.indexOf(c[1] || '-')) / ALPHA.length) / ALPHA.length);
    backfill.progress = Math.round(((frac(rc) + frac(vc)) / 2) * 1000) / 1000;
    Object.assign(metaW, { pilots_bf_r: rc, pilots_bf_v: vc, pilots_bf_n: String(backfill.devices), pilots_bf: bfDone ? 'done' : 'running' });
  }

  /* ------------------------------------------------ 2. Unlimited runs from before the counters (once) */
  if (meta.runs_bf !== 'done' && may(true, 'runs')) {
    await spend(async () => {
      const from = meta.live_from || sqlNow;     // runs from then on are counted as they land
      const day = flightSql('created', launch, nowMs);
      await run(`INSERT INTO counters (day, kind, n)
        SELECT ${day} AS d, CASE WHEN n = ${RUN_BASE + 1} THEN 'runs_free' ELSE 'runs_paid' END AS k, COUNT(*) FROM results
        WHERE n > ${RUN_BASE} AND created < ? AND ${NOTME} GROUP BY d, k
        ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n`, from);
      await run(`INSERT OR IGNORE INTO events (day, kind, device)
        SELECT DISTINCT ${day}, 'run', device FROM results
        WHERE n > ${RUN_BASE + 1} AND created >= datetime(?, '-32 days') AND created < ? AND ${NOTME}`, sqlNow, from);
      metaW.runs_bf = 'done';
      if (!meta.live_from) metaW.live_from = from;
    });
  }

  /* ------------------------------------------------ 3. purchases from before the payments table (once a day) */
  if (meta.pay_bf_day !== utcDay && may(true, 'pay')) {
    await spend(async () => {
      const need = await all(`SELECT u.sub, u.stripe_session AS s, COALESCE(u.paid_at, u.created) AS at, r.at AS refunded_at
        FROM users u LEFT JOIN refunds r ON r.sub = u.sub
        WHERE (u.paid_at IS NOT NULL OR u.unlimited = 1) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sub = u.sub) LIMIT ${PAY_BF_MAX}`);
      let retry = false;
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
            if (!/stripe 404/.test(String(e && e.message))) { retry = true; continue; }   // Stripe unreachable: try again later
          }
        }
        // No session or Stripe can't say: the list price, marked as an estimate.
        if (!row) row = [u.s || `legacy-${u.sub}`, u.sub, priceCents, 'usd', u.at, u.refunded_at ? priceCents : 0, u.refunded_at || null, 1];
        await run('INSERT OR IGNORE INTO payments (session, sub, amount, currency, at, refunded, refunded_at, est) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...row);
        cost.payments++;
      }
      if (!retry && need.length < PAY_BF_MAX) metaW.pay_bf_day = utcDay;
    });
  }

  /* ------------------------------------------------ 4. closed days: read, freeze what's missing (oldest first) */
  const dayMap = {};
  (await all('SELECT n, data FROM day_stats WHERE n <= ?', CLOSED)).forEach((r) => { try { dayMap[r.n] = JSON.parse(r.data); } catch (e) { /* refrozen below */ } });
  if (bfDone) {
    let first = true;
    for (let d = 1; d <= CLOSED; d++) {
      if (dayMap[d]) continue;
      if (!may(first, 'freeze')) break;
      first = false;
      const x = await spend(() => dayNumbers(d, { prev: dayMap[d - 1] || (d === 1 ? { wau: 0, mau: 0 } : null), lite: d < T - FULL_DAYS, core: d >= CLOSED - 9 }), 'freeze');
      await run("INSERT INTO day_stats (n, data) VALUES (?, ?) ON CONFLICT(n) DO UPDATE SET data = excluded.data, updated = datetime('now')", d, JSON.stringify(x));
      dayMap[d] = x; cost.frozen.push(d);
    }
    if (cost.frozen.length) await run('DELETE FROM events WHERE day < ?', T - KEEP_EVENTS);
  }

  /* ------------------------------------------------ 5. retention: every due window, oldest cohort first */
  const cohMap = {};
  (await all('SELECT n, size, ret FROM cohort_ret')).forEach((r) => { let ret = {}; try { ret = JSON.parse(r.ret || '{}'); } catch (e) { /* recount */ } cohMap[r.n] = { n: r.n, size: r.size, ret }; });
  if (bfDone) {
    let first = true;
    for (let c = 1; c <= CLOSED - 1; c++) {
      const have = cohMap[c] ? cohMap[c].ret : {};
      const ks = RET_K.filter((k) => c + k <= CLOSED && !(k in have));
      if (!ks.length) continue;
      if (!may(first, 'coh')) break;
      first = false;
      const r = await spend(() => one(`SELECT COUNT(*) AS size, ${ks.map((k) => `SUM(EXISTS (SELECT 1 FROM results q WHERE q.device = p.device AND q.n = p.first_flight + ${k})) AS k${k}`).join(', ')}
        FROM pilots p WHERE first_flight = ? AND ${NOTME}`, c), 'coh');
      const ret = { ...have };
      ks.forEach((k) => { ret[k] = r[`k${k}`] || 0; });
      await run("INSERT INTO cohort_ret (n, size, ret) VALUES (?, ?, ?) ON CONFLICT(n) DO UPDATE SET size = excluded.size, ret = excluded.ret, updated = datetime('now')", c, r.size || 0, JSON.stringify(ret));
      cohMap[c] = { n: c, size: r.size || 0, ret }; cost.cohorts.push(c);
    }
  }
  const pendingCohorts = (() => { let k = 0; for (let c = 1; c <= CLOSED - 1; c++) { const h = cohMap[c] ? cohMap[c].ret : {}; if (RET_K.some((x) => c + x <= CLOSED && !(x in h))) k++; } return k; })();

  /* ------------------------------------------------ 6. live reads (pilots-based ones only once pilots is complete) */
  const liveR0 = cost.rowsRead;
  const liveDays = []; for (let n = Math.max(1, CLOSED + 1); n <= T; n++) liveDays.push(n);
  const runDays = []; for (let n = Math.max(1, T - 29); n <= T; n++) runDays.push(n);
  const [liveNums, yCoh, act, acq, geo, counters, runTotals, runPilots, pays, checkouts, buyers, acct, passes, reports, excluded] = await Promise.all([
    Promise.all(liveDays.map((n) => dayNumbers(n, { live: true, withPilots: bfDone }))),
    bfDone ? one(`SELECT COUNT(*) AS size, SUM(EXISTS (SELECT 1 FROM results q WHERE q.device = p.device AND q.n = ?)) AS back FROM pilots p WHERE first_flight = ? AND ${NOTME}`, T, T - 1) : null,
    // one pass over the month's pilots: active counts, streaks, regulars and days flown
    bfDone ? all(`SELECT MIN(flights, 31) AS f, COUNT(*) AS mau, SUM(last_flight >= ?) AS wau, SUM(last_flight = ?) AS today,
        SUM(last_flight >= ? AND streak >= 3) AS streak3, SUM(last_flight >= ? AND streak >= 7) AS streak7, MAX(streak) AS best,
        SUM(flights >= 3 AND last_flight = ?) AS r0, SUM(flights >= 3 AND last_flight BETWEEN ? AND ?) AS r12,
        SUM(flights >= 3 AND last_flight BETWEEN ? AND ?) AS r36, SUM(flights >= 3 AND last_flight < ?) AS r7
      FROM pilots WHERE last_flight >= ? AND ${NOTME} GROUP BY f`, T - 6, T, T - 1, T - 1, T, T - 2, T - 1, T - 6, T - 3, T - 6, T - 29) : null,
    bfDone ? all(`SELECT COALESCE(first_src, 'unknown') AS src, first_seen AS n, COUNT(*) AS nv, SUM(first_flight IS NOT NULL) AS fin, SUM(first_flight = first_seen) AS act
      FROM pilots WHERE first_seen BETWEEN ? AND ? AND ${NOTME} GROUP BY src, first_seen`, T - 13, T) : [],
    bfDone ? all(`SELECT COALESCE(country, '??') AS cc, COUNT(*) AS c, SUM(mobile) AS m FROM pilots WHERE first_seen BETWEEN ? AND ? AND ${NOTME} GROUP BY cc ORDER BY c DESC`, T - 6, T) : [],
    all('SELECT day, kind, n FROM counters WHERE day >= ?', T - 89),
    all("SELECT kind, SUM(n) AS s FROM counters WHERE kind IN ('runs_free', 'runs_paid') GROUP BY kind"),
    one(`SELECT COUNT(DISTINCT device) AS m, COUNT(DISTINCT CASE WHEN day >= ? THEN device END) AS w FROM events WHERE day IN (${runDays.join(',')}) AND kind = 'run'`, T - 6),
    all(`SELECT p.amount, p.currency, p.at, p.refunded, p.refunded_at, p.est, cs.src, cs.first_flight, cs.flights
      FROM payments p LEFT JOIN checkout_src cs ON cs.id = p.session WHERE p.${NOTSUB} ORDER BY p.at`),
    all(`SELECT sub, created FROM checkouts WHERE created >= datetime('now', '-60 days') AND ${NOTSUB}`),
    all(`SELECT u.email, p.at, cs.src FROM payments p JOIN users u ON u.sub = p.sub LEFT JOIN checkout_src cs ON cs.id = p.session
      WHERE p.refunded < p.amount AND p.${NOTSUB} ORDER BY p.at DESC LIMIT 8`),
    one(`SELECT (SELECT COUNT(*) FROM users WHERE ${NOTSUB}) AS accounts, (SELECT COUNT(*) FROM saves WHERE ${NOTSUB}) AS saves,
      (SELECT COUNT(*) FROM plays WHERE at >= datetime('now', '-7 days') AND ${NOTSUB}) AS plays7`),
    one(`SELECT COUNT(*) AS made, SUM(active) AS active, (SELECT COUNT(*) FROM unlock_claims) AS claimed,
      SUM(active = 1 AND created < datetime('now', '-14 days') AND code NOT IN (SELECT code FROM unlock_uses)) AS stale FROM unlock_codes`),
    all(`SELECT qid, MAX(n) AS n, COUNT(*) AS c, MAX(created) AS last FROM reports
      WHERE created > datetime('now', '-60 days') AND ${NOTME} GROUP BY qid ORDER BY c DESC, last DESC LIMIT 20`),
    one('SELECT (SELECT COUNT(*) FROM ignore_devices) AS devices, (SELECT COUNT(*) FROM ignore_subs) AS subs'),
  ]);

  metaW.live_rows = String(cost.rowsRead - liveR0);

  /* ------------------------------------------------ 7. assemble */
  const ev = {};
  counters.forEach((r) => { (ev[r.day] = ev[r.day] || {})[r.kind] = r.n; });
  const liveMap = Object.fromEntries(liveNums.map((x) => [x.n, x]));
  const days = [];
  for (let n = 1; n <= T; n++) {
    const x = liveMap[n] || dayMap[n];
    days.push(x ? { ...x, closed: n <= CLOSED, ev: ev[n] || {} } : { n, closed: true, pending: true, ev: ev[n] || {} });
  }
  const runsByDay = {};
  Object.entries(ev).forEach(([d, k]) => { if (k.runs_free || k.runs_paid) runsByDay[d] = [k.runs_free || 0, k.runs_paid || 0]; });
  const rt = Object.fromEntries(runTotals.map((r) => [r.kind, r.s]));

  let active = null;
  if (act) {
    const s = (k) => act.reduce((a, r) => a + (r[k] || 0), 0);
    active = {
      wau: s('wau'), mau: s('mau'), today: s('today'), streak3: s('streak3'), streak7: s('streak7'), bestStreak: Math.max(0, ...act.map((r) => r.best || 0)),
      regulars: { today: s('r0'), d1_2: s('r12'), d3_6: s('r36'), d7_29: s('r7') },
      flown: act.map((r) => [r.f, r.mau]).sort((a, b) => a[0] - b[0]),
    };
  }
  const coreDay = dayMap[CLOSED], corePrev = dayMap[CLOSED - 7];

  // Checkouts → payments, by account (subs never leave the Worker).
  const paidSubs = new Set((await all(`SELECT DISTINCT sub FROM payments WHERE ${NOTSUB}`)).map((r) => r.sub));
  const ago = (s) => nowMs - Date.parse(`${String(s).replace(' ', 'T')}Z`);
  const winCheckouts = (lo, hi = 0) => {
    const subs = new Set();
    checkouts.forEach((c) => { const a = ago(c.created); if (a <= lo && a >= hi) subs.add(c.sub); });
    let paid = 0;
    subs.forEach((x) => { if (paidSubs.has(x)) paid++; });
    return { started: subs.size, paid };
  };
  const sumEv = (kind, from, to = T) => { let x = 0; for (let n = from; n <= to; n++) x += (ev[n] && ev[n][kind]) || 0; return x; };
  const pay30 = pays.filter((p) => ago(p.at) <= 30 * 864e5);
  const evDays = Object.keys(ev).filter((d) => EVENT_KINDS.some((k) => ev[d][k])).map(Number);

  // D1 writes: today's count from Cloudflare when connected, else an estimate for yesterday.
  const y = liveMap[T - 1] || dayMap[T - 1];
  const yEv = Object.entries(ev[T - 1] || {}).reduce((a, [k, v]) => a + (k === 'runs_free' || k === 'runs_paid' ? v * 3 : v * 2), 0);
  const writesEst = y ? Math.round((y.fin || 0) * 5 + (y.opened || 0) * 2 + (y.nv || 0) * 4 + yEv + 200) : null;

  const out = {
    v: 2, T, closedThrough: CLOSED, launch, priceCents, maxPts: MAX_PTS, now: new Date(nowMs).toISOString(), builtAt: nowMs,
    retK: RET_K,
    excluded: { devices: excluded.devices || 0, subs: excluded.subs || 0 },
    backfill: { ...backfill, pendingDays: days.filter((d) => d.pending).length, pendingCohorts },
    days,
    yesterdayCohort: yCoh ? { n: T - 1, size: yCoh.size || 0, back: yCoh.back || 0 } : null,
    cohorts: Object.values(cohMap).sort((a, b) => a.n - b.n),
    active,
    core: coreDay && coreDay.core != null ? { n: CLOSED, c: coreDay.core, prev: corePrev && corePrev.core != null ? corePrev.core : null } : null,
    acquisition: acq,
    geo7: { countries: geo.map((r) => [r.cc, r.c]), mobile: geo.reduce((a, r) => a + (r.m || 0), 0), total: geo.reduce((a, r) => a + r.c, 0) },
    money: {
      payments: pays.map((p) => ({ at: p.at, amount: p.amount, currency: p.currency, refunded: p.refunded, refundedAt: p.refunded_at, est: p.est, src: p.src || null, firstFlight: p.first_flight, flights: p.flights })),
      buyers: buyers.map((b) => ({ email: maskEmail(b.email) || 'unknown', at: b.at, src: b.src || null })),
      checkouts: { d30: winCheckouts(30 * 864e5), d60: winCheckouts(60 * 864e5), h24: winCheckouts(864e5, 30 * 6e4) },
      funnel30: {
        paywall: sumEv('paywall_view', T - 29), buy: sumEv('buy_click', T - 29),
        checkout: winCheckouts(30 * 864e5).started,
        paid: pay30.length, kept: pay30.filter((p) => p.refunded < p.amount).length,
        since: evDays.length ? Math.min(...evDays) : null,
      },
      accounts: acct.accounts || 0, saves: acct.saves || 0, plays7: acct.plays7 || 0,
    },
    unlimited: { runsByDay, freeRunPilots: rt.runs_free || 0, paidRuns: rt.runs_paid || 0, pilots30: runPilots.m || 0, pilotsWeek: runPilots.w || 0 },
    passes: { made: passes.made || 0, active: passes.active || 0, claimed: passes.claimed || 0, stale: passes.stale || 0 },
    reports,
    health: { stripe: health, d1: null, writesEst },
  };
  if (d1Usage) { try { out.health.d1 = await d1Usage(env); } catch (e) { /* shown as unknown */ } }

  // bookkeeping: catch-up spend for today, backfill cursors
  metaW.cu_day = utcDay; metaW.cu_rows = String(cuUsed + cost.catchUp);
  const kv = Object.entries(metaW);
  await run(`INSERT INTO meta (k, v) VALUES ${kv.map(() => '(?, ?)').join(', ')} ON CONFLICT(k) DO UPDATE SET v = excluded.v`, ...kv.flat());
  out.backfill.catchUpToday = cuUsed + cost.catchUp;
  cost.ms = Date.now() - t0;
  out.cost = cost;
  return out;
}
