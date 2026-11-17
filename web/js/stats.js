/* ==========================================================================
   KÁRMÁN · stats.js
   Comparison with everyone else who flew today:
     "Higher than 72% of pilots" and "38% hit this leg".

   Display only: your points never depend on anyone else.
   Talks to the Worker in /api (see SHIPPING.md, Phase 3):
     POST {API_BASE}/api/result   { n, device, pts, legs: "11010", chips: "23412" }
     GET  {API_BASE}/api/stats/n  { n, players, step, buckets: [[from, count]…], legs: [pct×5] }
   With STATS off, nothing shows, unless DEV + SAMPLE_STATS, in which
   case clearly-labelled sample numbers preview the design. A ?dev session on
   the live site never writes anything (picker plays, wipes and test runs
   stay out of the numbers): it previews with the sample numbers instead.

   Also the owner dashboard's anonymous beacons (no cookies, nothing personal,
   the same random device id): hit() = first open of the day, event(kind) =
   paywall seen / buy pressed / shared / pass redeemed / an error / the share
   stamp seen or tapped, each at most once per device per day.
   ========================================================================== */

K.stats = (() => {
  const C = K.CONFIG;
  const cache = new Map();          // n → { data, at }
  const FRESH_MS = 60 * 1000;

  const live = () => Boolean(C.STATS) && !C.DEV;
  const sampling = () => !live() && C.DEV && C.SAMPLE_STATS;

  /** Send a finished flight. Fire-and-forget; failures are ignored. */
  let pending = Promise.resolve();
  const justSent = new Set();        // flights you just submitted: next read skips the edge cache   // stats.get waits for your own result to land first
  function submit(record) {
    if (!live()) return pending;
    pending = send(record);
    return pending;
  }
  async function send(record) {
    try {
      await fetch(`${C.API_BASE}/api/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(record.mode === 'unlimited' ? { run: record.run } : { n: record.n }),
          device: K.storage.data.device,
          pts: record.pts,
          legs: record.rounds.map((r) => (r.hit ? '1' : '0')).join(''),
          chips: record.rounds.map((r) => r.chip).join(''),
        }),
        keepalive: true,
      });
      const key = record.mode === 'unlimited' ? `r${record.run}` : record.n;
      cache.delete(key);
      justSent.add(key);
    } catch (e) { /* offline: stats just won't include this flight */ }
  }

  /** A player flagged an answer as wrong. Stored server-side for the weekly check. */
  function report(qid, n) {
    if (!live()) return;
    fetch(`${C.API_BASE}/api/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ qid, n, device: K.storage.data.device }),
    }).catch(() => {});
  }

  let down = false;
  /** Today's distribution, or null when unavailable. */
  async function get(n) {
    await pending;
    if (sampling()) return sample(n);
    if (!live()) return null;
    // Short-lived: the crowd keeps growing all day, so reopening results later
    // (or after the tab sat open) refetches instead of showing a morning snapshot.
    const hit = cache.get(n);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.data;
    try {
      const fresh = justSent.delete(n) ? '?fresh=1' : '';
      const res = await fetch(`${C.API_BASE}/api/stats/${n}${fresh}`);
      down = !res.ok;                 // the server couldn't answer (not "nobody yet")
      if (!res.ok) { event('stats_down'); return null; }
      const data = await res.json();
      if (!data || !data.players) return null;
      cache.set(n, { data, at: Date.now() });
      return data;
    } catch (e) {
      down = navigator.onLine !== false;   // offline is the player's network, not ours
      if (down) event('stats_down');
      return null;
    }
  }

  /** Share of pilots you beat (ties count half), 0–100. */
  function percentile(stats, pts) {
    let below = 0, equal = 0;
    for (const [from, count] of stats.buckets) {
      if (from + stats.step <= pts) below += count;
      else if (from <= pts) equal += count;
    }
    return Math.round(((below + equal / 2) / stats.players) * 100);
  }

  /** Deterministic fake distribution for previewing the design. */
  function sample(n) {
    const rand = K.rng.fromLabel(`karman-sample-stats-${n}`);
    const step = 25;
    const buckets = [];
    let players = 0;
    for (let from = 0; from < K.scoring.MAX_PTS; from += step) {
      // Right-skewed: most flights land around 80–180 points.
      const x = (from + step / 2) / 130;
      const count = Math.round(4000 * x * Math.exp(-x * 1.4) * (0.85 + rand() * 0.3));
      if (count > 0) { buckets.push([from, count]); players += count; }
    }
    const legs = Array.from({ length: K.CONFIG.LEGS }, () => Math.round(18 + rand() * 50));
    return { n, players, step, buckets, legs, sample: true };
  }

  const dayStamp = () => String((K.date && K.date.flightNumber ? K.date.flightNumber() : null) || new Date().toDateString());
  const beacons = () => live() && !/^\/dev\b/.test(location.pathname) && Boolean(K.storage && K.storage.data && K.storage.data.device);
  const stamped = (key, stamp) => { try { return localStorage.getItem(key) === stamp; } catch (e) { return false; } };
  const stampIt = (key, stamp) => { try { localStorage.setItem(key, stamp); } catch (e) { /* private mode */ } };

  /** First open of the day: counts visitors and where they came from, for the
      owner's dashboard. Once per day per browser (also called when the game
      reboots at midnight or the tab comes back, so a tab left open still
      counts); stamped only once the server has it, so a failed send retries.
      The dashboard itself never counts. */
  const sentHit = new Set();
  function hit() {
    if (!beacons()) return;
    const stamp = dayStamp();
    if (sentHit.has(stamp) || stamped('karman:hit', stamp)) return;
    sentHit.add(stamp);
    const q = new URLSearchParams(location.search);
    let src = q.get('utm_source') || q.get('ref') || q.get('src') || '';
    if (!src && document.referrer) {
      try { const h = new URL(document.referrer).hostname.replace(/^www\./, ''); if (!/(^|\.)karman\.day$/.test(h)) src = h; } catch (e) { /* ignore */ }
    }
    if (!src && window.matchMedia && matchMedia('(display-mode: standalone)').matches) src = 'home-screen';
    fetch(`${C.API_BASE}/api/hit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ device: K.storage.data.device, src: src || 'direct' }),
    }).then((r) => { if (r && r.ok) stampIt('karman:hit', stamp); else sentHit.delete(stamp); }, () => sentHit.delete(stamp));
  }

  /** An anonymous product event for the owner's dashboard: one of
      paywall_view, buy_click, share, pass_redeem, error, stats_down,
      nudge_seen (the share stamp played), nudge_tap (it was tapped).
      At most once per kind per device per day; fire-and-forget. */
  const sentEv = new Set();
  function event(kind) {
    if (!beacons()) return;
    const stamp = dayStamp(), key = `karman:ev:${kind}`, mem = `${kind}:${stamp}`;
    if (sentEv.has(mem) || stamped(key, stamp)) return;
    sentEv.add(mem);
    try {
      fetch(`${C.API_BASE}/api/event`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ device: K.storage.data.device, kind }),
      }).then((r) => { if (r && r.ok) stampIt(key, stamp); else sentEv.delete(mem); }, () => sentEv.delete(mem));
    } catch (e) { sentEv.delete(mem); }
  }
  // Only the game's own errors: scripts on this origin (not extensions, not
  // third-party widgets such as Google sign-in).
  const ours = (url) => { try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; } };
  if (typeof addEventListener === 'function') {
    addEventListener('error', (e) => { if (e && e.filename && ours(e.filename)) event('error'); });
    addEventListener('unhandledrejection', (e) => {
      const stack = e && e.reason && e.reason.stack ? String(e.reason.stack) : '';
      if (stack && stack.includes(location.origin)) event('error');
    });
  }

  return { submit, report, get, percentile, live, sampling, hit, event, get down() { return down; } };
})();
