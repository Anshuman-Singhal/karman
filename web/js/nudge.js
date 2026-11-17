/* ==========================================================================
   KÁRMÁN · nudge.js
   "Posted": the share nudge on the results screen.

   After the landing reveal has settled, an airmail stamp ("Dare a friend ·
   Can they fly higher? · 12 KM") is slapped into the empty corner beside the
   score, holds long enough to read, then peels off and flies into the Share
   ticket, where it stays as a small stamp beside SHARE FLIGHT. Nothing loops;
   ~2.8 s from slap to rest. Taps anywhere else pass straight through and make
   it finish at once; tapping the stamp itself shares.

   When: the full sequence plays only on the first finish of today's daily
   flight, at most once a day, never for pilots who shared today or
   yesterday, and backing off (1, 2, 4, then 7 days) for pilots who never
   share. Everywhere else the ticket simply wears its stamp (the quiet
   version). Reduced motion: the stamp fades in at the corner and out again.

   Storage: K.storage.data.nudge = { seen, miss, shared } (flight numbers and
   a count). A LOCAL_ONLY key (sync.js): never uploaded, never merged, and a
   missing key just means "never seen", so no existing save changes.

   The rules at the top are pure (tests/logic.test.js runs them in Node);
   nothing touches the DOM until results() is called.
   ========================================================================== */

K.nudge = (() => {
  /* ------------------------------------------------------------ the rules (pure) */
  const GAPS = [1, 2, 4, 7];            // days between full nudges, by how many went unanswered

  /** Should this results screen play the full sequence? nd = the stored state (may be missing). */
  const obj = (nd) => (nd && typeof nd === 'object' && !Array.isArray(nd) ? nd : {});   // a stored value that isn't a record counts as none
  function plan(nd, { n, mode, isFresh }) {
    nd = obj(nd);
    if (mode !== 'daily' || !isFresh || !Number.isFinite(n)) return false;    // first finish of a daily flight only
    if (nd.seen === n) return false;                                           // once a day
    if (Number.isFinite(nd.shared) && nd.shared >= n - 1) return false;        // shared today or yesterday
    const miss = Math.max(0, Math.floor(nd.miss) || 0);
    if (Number.isFinite(nd.seen) && n - nd.seen < GAPS[Math.min(miss, GAPS.length - 1)]) return false;   // back off
    return true;
  }
  /** The state after a full (or still) nudge has started on flight n. */
  const afterSeen = (nd, n) => ({ ...obj(nd), seen: n, miss: Math.max(0, Math.floor(obj(nd).miss) || 0) + 1 });
  /** The state after any share, on day `day` (today's flight number). */
  const afterShare = (nd, day) => ({ ...obj(nd), shared: day, miss: 0 });

  /* ------------------------------------------------------------ easing and the timeline */
  function bez(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-5 || !d) break; t -= e / d; }
      return sy(Math.min(1, Math.max(0, t)));
    };
  }
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    out: bez(0.16, 1, 0.3, 1),            // the game's --ease-out
    in: bez(0.55, 0, 1, 0.45),            // the game's --ease-in
    inq: (u) => u * u,
    io: bez(0.45, 0, 0.55, 1),
    path: bez(0.4, 0, 0.2, 1),            // flight progress: lift away, glide, settle in
    shrink: bez(0.05, 0.95, 0.2, 1),      // small early, so it is small while crossing anything
    spring: bez(0.34, 1.56, 0.64, 1),     // the game's --ease-spring
    sheen: bez(0.45, 0, 0.25, 1),
  };
  /* ms from T0 (the slap). The read hold is 1.2 s: two short lines, read once. */
  const T = { fall: 150, flat: 240, peel: 1440, fly: 1560, land: 2060, press: 2140, swap: 2280, dip: 2120, spring: 2200, back: 2480, sheen: 2160, rest: 2800 };
  const RM = { in: 200, out: 2000, gone: 2200 };   // reduced motion: fade in, hold, fade out
  const R_READ = 3.5, R_REST = -6, S_SLAP = 1.4;

  /** The stamp's pose at t: centre (x, y), scale s against its read size, rotation r,
      opacity, the two faces (a words, b balloon) and the two shadows. g = geometry. */
  function pose(g, t, calm) {
    const { P0, P3, w, h, sRest } = g;
    if (calm) {
      const op = t < RM.in ? t / RM.in : t < RM.out ? 1 : 1 - seg(t, RM.out, RM.gone);
      return { x: P0.x, y: P0.y, s: 1, r: R_READ, op: clamp(op), a: 1, b: 0, soft: 0, tight: 1 };
    }
    if (t < T.flat) {
      // The slap: it drops onto the paper from the camera. Scale and turn pivot on the
      // stamp's lower-left corner, so the bigger, lifted stamp only ever grows up and to
      // the right, away from the score, the tier and the percentile line.
      let s, r;
      if (t < T.fall) { const u = t / T.fall; s = lerp(S_SLAP, 0.965, E.inq(u)); r = lerp(R_READ + 3, R_READ - 0.4, E.out(u)); }
      else { const u = (t - T.fall) / (T.flat - T.fall); s = lerp(0.965, 1, E.out(u)); r = lerp(R_READ - 0.4, R_READ, u); }
      const c = corner(g, s, r);
      return { x: c.x, y: c.y, s, r, op: clamp(t / 70), a: 1, b: 0, soft: 1 - seg(t, 0, T.fall), tight: seg(t, 0, T.fall) };
    }
    if (t < T.peel) return { x: P0.x, y: P0.y, s: 1, r: lerp(R_READ, R_READ - 0.5, E.io(seg(t, T.flat, T.peel))), op: 1, a: 1, b: 0, soft: 0, tight: 1 };
    if (t < T.fly) {
      const e = E.out(seg(t, T.peel, T.fly));
      return { x: P0.x, y: P0.y - 4 * e, s: lerp(1, 1.06, e), r: lerp(R_READ - 0.5, 1, e), op: 1, a: 1, b: 0, soft: e, tight: 1 - e };
    }
    if (t < T.land) {
      const u = seg(t, T.fly, T.land), pu = E.path(u), p = cubic(g, pu);
      return { x: p.x, y: p.y - 4 * (1 - pu), s: lerp(1.06, sRest * 1.15, E.shrink(u)),
        r: lerp(1, R_REST, pu) - 10 * Math.sin(Math.PI * pu), op: 1, a: 1 - seg(u, 0.08, 0.42), b: seg(u, 0.2, 0.55), soft: 1, tight: 0 };
    }
    const press = ticket(t).ty;
    if (t < T.press) {
      const u = seg(t, T.land, T.press);
      return { x: P3.x, y: P3.y + press, s: lerp(sRest * 1.15, sRest * 0.946, E.inq(u)), r: R_REST, op: 1, a: 0, b: 1, soft: 1 - u, tight: u };
    }
    return { x: P3.x, y: P3.y + press, s: lerp(sRest * 0.946, sRest, E.out(seg(t, T.press, T.swap))), r: R_REST, op: 1, a: 0, b: 1, soft: 0, tight: 1 };
  }
  /** The ticket takes the hit: a 1.5 px dip, a spring back, one light across it. */
  function ticket(t) {
    let ty = 0, sc = 1;
    if (t >= T.dip && t < T.spring) { const u = E.in(seg(t, T.dip, T.spring)); ty = 1.5 * u; sc = 1 - 0.015 * u; }
    else if (t >= T.spring && t < T.back) { const u = E.spring(seg(t, T.spring, T.back)); ty = 1.5 * (1 - u); sc = 1 - 0.015 * (1 - u); }
    return { ty, sc, sheen: E.sheen(seg(t, T.sheen, T.rest)) };
  }
  const rot = (x, y, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; };
  /** Centre of the stamp when it is scaled by s and turned to r about its read pose's lower-left corner. */
  function corner(g, s, r) {
    const v = rot((s * g.w) / 2, (-s * g.h) / 2, r);
    return { x: g.C.x + v.x, y: g.C.y + v.y };
  }
  /** The flight: shrinking fast, it glides left across the empty band between the tier
      and the percentile line, then drops onto the ticket from straight above. It never
      crosses the percentile figure, your YOU marker or Copy image; small, it only brushes
      the first word of the percentile lines on its way down (its spot on the ticket sits
      right under them). */
  function cubic(g, u) {
    const { P0, P3 } = g, dx = P3.x - P0.x, dy = P3.y - P0.y;
    const P1 = { x: P0.x - 0.9 * Math.abs(dx), y: P0.y + 0.3 * dy };
    const P2 = { x: P3.x, y: P3.y - 0.8 * dy };
    const v = 1 - u;
    return { x: v * v * v * P0.x + 3 * v * v * u * P1.x + 3 * v * u * u * P2.x + u * u * u * P3.x,
      y: v * v * v * P0.y + 3 * v * v * u * P1.y + 3 * v * u * u * P2.y + u * u * u * P3.y };
  }

  /* ------------------------------------------------------------ where the stamp fits
     The corner is only the corner where nothing is printed: find the largest
     stamp, turned to its read angle, that clears the score, the unit, the tier,
     "past yesterday", the eyebrow and the percentile line by GAP px, stays on
     the pass (it may overlap the printed rope border) and above the Share ticket. Long scores ("142 km") or long tier
     names just get a smaller stamp, never an overlap. */
  const GAP = 4;
  function textRects(el) {
    if (!el || el.hidden || !el.textContent.trim()) return [];
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0);
  }
  /** Separating axes: a w×h box centred on (cx, cy) turned by deg, against an axis-aligned rect. */
  function hits(cx, cy, w, h, deg, b) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    const L = b.left - GAP, R = b.right + GAP, Tp = b.top - GAP, B = b.bottom + GAP;
    if (Math.max(...pts.map((p) => p[0])) <= L || Math.min(...pts.map((p) => p[0])) >= R) return false;
    if (Math.max(...pts.map((p) => p[1])) <= Tp || Math.min(...pts.map((p) => p[1])) >= B) return false;
    const corners = [[L, Tp], [R, Tp], [R, B], [L, B]];
    for (const [ax, ay, half] of [[c, s, w / 2], [-s, c, h / 2]]) {
      const ctr = cx * ax + cy * ay;
      const proj = corners.map(([x, y]) => x * ax + y * ay);
      if (Math.max(...proj) <= ctr - half || Math.min(...proj) >= ctr + half) return false;
    }
    return true;
  }
  function fit(desk) {
    const $ = (id) => document.getElementById(id);
    const lock = document.querySelector('#screen-results .res-lockup').getBoundingClientRect();
    const share = $('btn-share').getBoundingClientRect();
    const eyebrow = textRects($('res-eyebrow'));
    const pctl = $('pctl').hidden ? [] : textRects($('pctl-txt'));
    const busy = [...eyebrow, ...textRects($('res-alt')), ...textRects($('res-unit')), ...textRects($('res-tier')), ...textRects($('res-vs')), ...pctl];
    const chart = $('crowd-chart');
    if (chart && chart.childElementCount) busy.push(chart.getBoundingClientRect());
    const top = eyebrow.length ? Math.min(...eyebrow.map((b) => b.top)) : lock.top - 12;
    const bottom = (pctl.length ? Math.min(...pctl.map((b) => b.top)) : share.top - 2) - GAP;
    const left = lock.left, right = Math.min(innerWidth - 2, lock.right + 18);
    const a = (R_READ * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let w = desk ? 136 : 120; w >= 76; w -= 2) {
      const h = w * 1.25, hx = (w * ca + h * sa) / 2, hy = (w * sa + h * ca) / 2;
      const want = { x: right - hx, y: Math.max(top + hy, lock.top - 6 + hy) };
      let best = null;
      for (let cx = right - hx; cx >= left + hx; cx -= 2) {
        for (let cy = top + hy; cy <= bottom - hy; cy += 2) {
          const score = (want.x - cx) + Math.abs(cy - want.y) * 0.6;
          if (best && score >= best.score) continue;
          if (busy.some((b) => hits(cx, cy, w, h, R_READ, b))) continue;
          best = { x: cx, y: cy, score };
        }
      }
      if (best) return { w, h, P0: { x: best.x, y: best.y } };
    }
    return null;
  }

  /* ------------------------------------------------------------ the DOM */
  const BALLOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c-4.1 0-6.6 3-6.6 6.6 0 2.8 2.2 5 4 6.4h5.2c1.8-1.4 4-3.6 4-6.4 0-3.6-2.5-6.6-6.6-6.6z"/><path d="M12 3.2c-1.6 1.7-2.3 4.1-2.3 6.6 0 2.6.5 4.9 1 6.4M12 3.2c1.6 1.7 2.3 4.1 2.3 6.6 0 2.6-.5 4.9-1 6.4"/><rect x="10" y="18.3" width="4" height="2.7" rx=".6"/></svg>';
  const FPS = 1000 / 60;
  let ctx = null;          // this results screen: { n, mode, face, wait }
  let run = null;          // the stamp in the air: { sky, fly, parts, anims, g, calm, ff, tap }
  let tail = [];           // the ticket's dip and its one light, which outlive the swap by ~0.5 s

  const reduced = () => (K.fx && K.fx.reduced ? K.fx.reduced() : false);
  const btn = () => document.getElementById('btn-share');
  const store = () => K.storage.data;
  const save = (nd) => { store().nudge = nd; K.storage.save(true); };   // local only: nothing for the cloud to sync
  const tf = (g, p) => `translate(${(p.x - g.w / 2).toFixed(2)}px, ${(p.y - g.h / 2).toFixed(2)}px) rotate(${p.r.toFixed(3)}deg) scale(${p.s.toFixed(4)})`;
  const now = () => (run && run.anims[0] ? Number(run.anims[0].currentTime) || 0 : 0);

  /** A results screen is up. ready resolves to the moment the landing reveal and the
      percentile count have settled (or null if they didn't in time). */
  function results({ n, mode, isFresh, face, ready }) {
    reset();
    const b = btn();
    const nd = obj(store().nudge);
    b.classList.remove('inking');
    b.classList.toggle('posted', mode === 'daily' && nd.shared === n);   // shared today's flight already
    ctx = { n, mode, face };
    if (!plan(nd, { n, mode, isFresh })) return;
    b.classList.add('stamping');                      // the ticket's own stamp waits for the flying one
    const mine = ctx;
    Promise.resolve(ready).then((at) => {
      if (ctx !== mine) return;
      if (at == null) return rest();
      mine.wait = setTimeout(() => { if (ctx === mine) start(); }, Math.max(0, at - performance.now()));
    }, () => { if (ctx === mine) rest(); });
  }
  /** The rest state: the ticket wears its stamp. (Skipping never burns the day.) */
  function rest() { const b = btn(); if (b) b.classList.remove('stamping'); }

  function start() {
    try {
      const b = btn();
      const scr = document.getElementById('screen-results');
      const main = scr.querySelector('.res-main');
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; };
      if (typeof Element.prototype.animate !== 'function'          // no Web Animations: the ticket just wears its stamp
        || !plan(store().nudge, { n: ctx.n, mode: ctx.mode, isFresh: true })
        || K.ui.current !== 'results' || document.hidden || document.querySelector('.sheet-wrap.open')
        || (K.coach && K.coach.active) || document.body.classList.contains('climb-open')
        || scr.scrollTop > 0 || (main && main.scrollTop > 0) || !vis(b)) return rest();
      const spot = fit(innerWidth >= 720);
      const stamp = b.querySelector('.ticket-stamp');
      if (!spot || !stamp || !vis(stamp)) return rest();
      const sb = stamp.getBoundingClientRect();
      const g = { ...spot, P3: { x: sb.left + sb.width / 2, y: sb.top + sb.height / 2 }, sRest: stamp.offsetWidth / spot.w };
      const v = rot(g.w / 2, -g.h / 2, R_READ);
      g.C = { x: g.P0.x - v.x, y: g.P0.y - v.y };    // the read pose's lower-left corner: the slap's pivot
      play(g, reduced());
      save(afterSeen(store().nudge, ctx.n));          // the day counts only once the stamp is actually on screen
      try { K.stats.event('nudge_seen'); } catch (e) { /* stats never block the game */ }
    } catch (e) {
      stop();                                         // whatever went wrong, the screen ends at rest
    }
  }

  function build(g) {
    const u = g.w / 80;
    const sky = document.createElement('div');
    sky.className = 'post-sky';
    sky.innerHTML = `<div class="post-fly" aria-hidden="true" style="--u:${u.toFixed(4)}px;width:${g.w}px;height:${g.h}px">
      <i class="pf-sh pf-tight"></i><i class="pf-sh pf-soft"></i>
      <div class="pf-paper"><div class="pf-frame"><div class="pf-field">
        <div class="pf-face pf-a"><b>Dare a<br>friend</b><span>Can they fly<br>higher?</span><em></em></div>
        <div class="pf-face pf-b">${BALLOON}</div>
      </div></div></div></div>`;
    document.body.appendChild(sky);
    const fly = sky.firstElementChild;
    // The face value (your altitude, as on the ticket's stub), only where it reads.
    const val = fly.querySelector('.pf-a em');
    val.textContent = ctx.face || '';
    if (!ctx.face || u * 7 < 8.5 || val.offsetWidth > fly.querySelector('.pf-field').clientWidth - 6 * u) val.remove();
    return { sky, fly };
  }

  function play(g, calm) {
    const b = btn();
    const { sky, fly } = build(g);
    const parts = { a: fly.querySelector('.pf-a'), b: fly.querySelector('.pf-b'), soft: fly.querySelector('.pf-soft'), tight: fly.querySelector('.pf-tight') };
    // One WAAPI animation per element, sampled from pose() at 60 fps: the eased path
    // stays exact and everything runs on the compositor (transform and opacity only).
    const end = calm ? RM.gone : T.swap;
    const k = { fly: [], a: [], b: [], soft: [], tight: [] };
    for (let t = 0; ; t = Math.min(end, t + FPS)) {
      const p = pose(g, t, calm), offset = t / end;
      k.fly.push({ offset, transform: tf(g, p), opacity: p.op });
      k.a.push({ offset, opacity: p.a });
      k.b.push({ offset, opacity: p.b });
      k.soft.push({ offset, opacity: p.soft * 0.9 });
      k.tight.push({ offset, opacity: p.tight * 0.55 });
      if (t >= end) break;
    }
    const o = { duration: end, fill: 'forwards' };
    const anims = [];
    run = { sky, fly, parts, anims, g, calm, ff: false, tap: null };   // set first, so stop() can always take the overlay away
    const mine = run;
    anims.push(fly.animate(k.fly, o), ...['a', 'b', 'soft', 'tight'].map((x) => parts[x].animate(k[x], o)));
    anims[0].onfinish = () => { if (run === mine && !mine.ff) land(); };
    if (calm) rest();                                 // the still version: the ticket already wears its stamp
    else {
      const dip = [];
      for (let t = T.dip; ; t = Math.min(T.back, t + FPS)) {
        const q = ticket(t);
        dip.push({ offset: (t - T.dip) / (T.back - T.dip), transform: `translateY(${q.ty.toFixed(3)}px) scale(${q.sc.toFixed(4)})` });
        if (t >= T.back) break;
      }
      const sheen = document.createElement('span');
      sheen.className = 'ticket-sheen';
      sheen.setAttribute('aria-hidden', 'true');
      b.appendChild(sheen);
      tail = [b.animate(dip, { duration: T.back - T.dip, delay: T.dip }),
        sheen.animate([{ transform: 'translateX(-80%)' }, { transform: 'translateX(80%)' }],
          { duration: T.rest - T.sheen, delay: T.sheen, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'both' })];
      tail[1].onfinish = () => sheen.remove();
      tail.sheen = sheen;
      setTimeout(() => { if (run === mine && !mine.ff && !mine.tap && K.audio && K.audio.tick) K.audio.tick(); }, T.fall);
    }
    listen(true);
  }

  /** Straight to rest from wherever it is, in ms: no dip, no light. */
  function finish(ms) {
    if (!run || run.ff) return;
    const mine = run, { g, calm, fly, parts } = mine;
    const t = now();
    if (!calm && t >= T.swap) return land();
    const from = pose(g, t, calm);
    mine.anims.forEach((x) => x.cancel());
    clearTail();
    mine.ff = true;
    const o = { duration: calm ? 120 : ms, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' };
    const to = calm ? { ...from, op: 0 } : { x: g.P3.x, y: g.P3.y, s: g.sRest, r: R_REST, op: 1, a: 0, b: 1, soft: 0, tight: 1 };
    const last = fly.animate([{ transform: tf(g, from), opacity: from.op }, { transform: tf(g, to), opacity: to.op }], o);
    parts.a.animate([{ opacity: from.a }, { opacity: to.a }], o);
    parts.b.animate([{ opacity: from.b }, { opacity: to.b }], o);
    parts.soft.animate([{ opacity: from.soft * 0.9 }, { opacity: 0 }], o);
    parts.tight.animate([{ opacity: from.tight * 0.55 }, { opacity: 0.55 }], o);
    last.onfinish = () => { if (run === mine) land(); };
  }
  /** The flying stamp is now exactly where the ticket's own sits: swap, and the overlay goes. */
  function land() {
    if (!run) return;
    settle();
    listen(false);
    run.sky.remove();
    run = null;
    rest();
  }
  function clearTail() {
    tail.forEach((x) => x.cancel());
    if (tail.sheen) tail.sheen.remove();
    tail = [];
  }
  /** End at once (a screen change, a hidden tab, a resize, a new results screen): no flight, the rest state. */
  function stop() {
    if (ctx && ctx.wait) clearTimeout(ctx.wait);
    clearTail();
    listen(false);
    if (run) { run.anims.forEach((x) => x.cancel()); run = null; }
    document.querySelectorAll('.post-sky').forEach((x) => x.remove());
    rest();
  }
  function reset() { stop(); ctx = null; }

  /* Interrupts: nothing is blocked or swallowed; the stamp just hurries home.
     The overlay never takes pointer events (a swipe or a wheel that starts on the
     stamp still scrolls the pass). A tap on the stamp is recognised here instead:
     a press inside its box that doesn't travel, then the click it produces. */
  const inside = (x, y) => { const r = run.fly.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const settle = (fn) => { if (run && run.tap) { clearTimeout(run.tap.timer); run.tap = null; } if (fn) fn(); };
  const onDown = (e) => {
    if (!run || run.ff) return;
    const live = now() >= (run.calm ? 100 : 70);       // only a stamp you can see takes a tap
    if (e.isPrimary !== false && live && inside(e.clientX, e.clientY)) {
      settle();
      run.tap = { x: e.clientX, y: e.clientY, timer: 0 };
      [...run.anims, ...tail].forEach((x) => x.pause());   // hold still under the finger until the tap lands
    } else finish(180);
  };
  const onMove = (e) => { if (run && run.tap && Math.hypot(e.clientX - run.tap.x, e.clientY - run.tap.y) > 10) settle(() => finish(180)); };
  const onUp = () => { if (run && run.tap) run.tap.timer = setTimeout(() => settle(() => finish(180)), 400); };   // no click followed
  const onCancel = () => { if (run && run.tap) settle(() => finish(180)); };
  const onClick = (e) => {
    if (!run || !run.tap) return;
    const hit = inside(e.clientX, e.clientY);
    settle();
    if (!hit) return finish(180);
    // The stamp's tap shares, and only that: whatever lies under the stamp doesn't also get the click.
    e.preventDefault();
    e.stopPropagation();
    try { K.stats.event('nudge_tap'); } catch (err) { /* stats never block sharing */ }
    btn().click();                                    // the very same share, inside the tap (clipboard and share sheet keep the gesture)
    finish(220);
  };
  const onKey = (e) => { if (!e.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) finish(180); };
  const onScroll = () => finish(180);
  const onHide = () => { if (document.hidden) stop(); };
  function listen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointerdown', onDown, true);
    document[f]('pointermove', onMove, true);
    document[f]('pointerup', onUp, true);
    document[f]('pointercancel', onCancel, true);
    document[f]('click', onClick, true);
    document[f]('keydown', onKey, true);
    document[f]('scroll', onScroll, true);
    document[f]('visibilitychange', onHide);
    window[f]('resize', stop);
  }

  /** Any share, anywhere (Share, Copy image, the stamp, the passport): remember the day,
      postmark the ticket's stamp, and if the stamp is still in the air, bring it home. */
  function shared() {
    try { save(afterShare(store().nudge, K.game.today)); } catch (e) { /* storage never blocks sharing */ }
    const b = btn();
    if (b && K.ui.current === 'results' && !b.classList.contains('posted')) b.classList.add('posted', 'inking');
    finish(220);
  }
  /** A sheet opens over the results: finish now (the stamp is home before the sheet is up). */
  const hurry = () => finish(180);

  return { plan, afterSeen, afterShare, GAPS, results, shared, hurry, stop };
})();
