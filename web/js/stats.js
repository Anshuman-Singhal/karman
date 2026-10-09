/* ==========================================================================
   KÁRMÁN · stats.js
   Comparison with everyone else who flew today:
     "Higher than 72% of pilots" and "38% hit this leg".

   Display only: your points never depend on anyone else.
   Talks to the Worker in /api (see SHIPPING.md, Phase 3):
     POST {API_BASE}/api/result   { n, device, pts, legs: "11010", chips: "23412" }
     GET  {API_BASE}/api/stats/n  { n, players, step, buckets: [[from, count]…], legs: [pct×5] }
   With STATS off, nothing shows, unless DEV + SAMPLE_STATS, in which
   case clearly-labelled sample numbers preview the design.
   ========================================================================== */

K.stats = (() => {
  const C = K.CONFIG;
  const cache = new Map();          // n → { data, at }
  const FRESH_MS = 60 * 1000;

  const live = () => Boolean(C.STATS);
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
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.players) return null;
      cache.set(n, { data, at: Date.now() });
      return data;
    } catch (e) {
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

  return { submit, report, get, percentile, live, sampling };
})();
