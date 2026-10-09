/* ==========================================================================
   KÁRMÁN · replay.js
   After landing, the results pass can be swiped down to a slim strip so the
   sky takes over. On the altitude rail we then draw:
     • where everyone landed today: a vertical histogram of 5 km bars beside
       the rail, your bar in amber ("the game is about going up");
     • your seven legs: a marker at the altitude each leg carried you to,
       with its lift, so you can see which answers got you higher;
   and the pilot can drag on the sky to scroll back down through the climb.
   Tap the strip (or swipe up) to bring the pass back.
   ========================================================================== */

K.replay = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false, record = null, stats = null, layer = null, raf = 0, drag = null, strip = null;

  const S = () => K.scoring;

  function build() {
    layer = document.createElement('div');
    layer.id = 'replay';
    layer.innerHTML = '<svg class="rp-chart" aria-hidden="true"></svg><div class="rp-legs"></div>';
    document.getElementById('app').appendChild(layer);
    strip = document.createElement('button');
    strip.type = 'button';
    strip.className = 'res-strip';
    strip.innerHTML = '<span class="rs-main"></span><span class="rs-cue">Open the pass <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></span>';
    strip.addEventListener('click', () => close());
    $('dock').appendChild(strip);
    const sky = $('scene');
    sky.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    sky.addEventListener('wheel', onWheel, { passive: false });
  }

  /* ---------------------------------------------------------- drawing */
  function legAltitudes(rec) {
    const out = []; let km = 0;
    (rec.rounds || []).forEach((r) => { km += r.delta || 0; out.push({ km, delta: r.delta || 0, hit: r.hit, chip: r.chip }); });
    return out;
  }

  function paint() {
    if (!open || !layer) return;
    const rail = $('rail');
    const rr = rail.getBoundingClientRect();
    const app = $('app').getBoundingClientRect();
    const top = rr.top - app.top, h = rr.height, x0 = rr.left - app.left + 128;   // chart sits right of the leg labels
    const yOf = (km) => top + (1 - K.scene.railFrac(km)) * h;
    const svg = layer.querySelector('.rp-chart');
    const W = 120;
    svg.setAttribute('viewBox', `0 0 ${W} ${Math.round(app.height)}`);
    svg.style.left = `${x0}px`; svg.style.width = `${W}px`; svg.style.top = '0'; svg.style.height = `${Math.round(app.height)}px`;
    let g = '';
    if (stats && stats.players > 0) {
      // A smooth silhouette of where everyone landed: width = how many pilots
      // ended up at that altitude, drawn up the rail like a mountain seen side-on.
      const step = stats.step || 5;
      const counts = new Map(stats.buckets.map(([f, c]) => [f, c]));
      const max = Math.max(1, ...counts.values());
      const pts = [];
      for (let from = 0; from < K.scene.MAX_KM; from += step) {
        const c = counts.get(from) || 0;
        pts.push([ (c / max) * (W - 36), yOf(from + step / 2) ]);
      }
      const top = yOf(K.scene.MAX_KM), bottom = yOf(0);
      let d = `M0 ${bottom.toFixed(1)}`;
      pts.slice().reverse().forEach(([w, y], k, arr) => {
        if (k === 0) { d += ` L${w.toFixed(1)} ${y.toFixed(1)}`; return; }
        const [pw, py] = arr[k - 1];
        const cy = (py + y) / 2;
        d += ` C${pw.toFixed(1)} ${cy.toFixed(1)} ${w.toFixed(1)} ${cy.toFixed(1)} ${w.toFixed(1)} ${y.toFixed(1)}`;
      });
      d += ` L0 ${top.toFixed(1)} Z`;
      g += `<path d="${d}" class="rp-area"/>`;
      const my = yOf(record.alt);
      g += `<line x1="0" y1="${my.toFixed(1)}" x2="${W - 20}" y2="${my.toFixed(1)}" class="rp-you"/><text x="${W - 18}" y="${(my + 4).toFixed(1)}" class="rp-you-t">YOU</text>`;
    }
    svg.innerHTML = g;
    // leg markers: where each answer carried you
    const legs = layer.querySelector('.rp-legs');
    const alts = legAltitudes(record);
    let html = '';
    // the rail is a log scale, so high legs bunch up: push markers apart (18 px) from the top down
    const ys = alts.map((l) => yOf(l.km));
    for (let i = alts.length - 1; i >= 0; i--) {
      const limit = i === alts.length - 1 ? -Infinity : ys[i + 1] + 18;
      if (ys[i] < limit) ys[i] = limit;
    }
    alts.forEach((l, i) => {
      const y = ys[i];
      const chip = S().CHIPS[l.chip];
      html += `<div class="rp-leg${l.hit ? '' : ' miss'}" style="top:${y.toFixed(1)}px;left:${(rr.left - app.left - 5).toFixed(0)}px;--c:var(--c-${chip ? chip.key : 'miss'})">
        <i></i><span>${i + 1}</span><b>${l.hit ? `+${l.delta}` : 'miss'}</b></div>`;
    });
    legs.innerHTML = html;
  }

  /* ---------------------------------------------------------- drag to scroll the climb */
  function onDown(e) {
    if (!open || e.button) return;
    drag = { y: e.clientY, km: K.scene.km, moved: false };
  }
  function onMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 3) drag.moved = true;
    const rail = $('rail').getBoundingClientRect();
    // dragging the sky down scrolls you back toward the meadow; up, back toward your landing
    const f = K.scene.railFrac(drag.km) + dy / rail.height;
    const km = fracToKm(Math.max(0, Math.min(K.scene.railFrac(record.alt), f)));
    K.scene.climbTo(km, { duration: 120 });
  }
  function onUp() { drag = null; }
  function onWheel(e) {
    if (!open) return;
    e.preventDefault();
    const rail = $('rail').getBoundingClientRect();
    const f = K.scene.railFrac(K.scene.km) - e.deltaY / rail.height / 2;
    K.scene.climbTo(fracToKm(Math.max(0, Math.min(K.scene.railFrac(record.alt), f))), { duration: 160 });
  }
  /** Inverse of railFrac by bisection (the rail is a log scale). */
  function fracToKm(f) {
    let lo = 0, hi = K.scene.MAX_KM;
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (K.scene.railFrac(mid) < f) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /* ---------------------------------------------------------- open / close */
  function show(rec, st) {
    record = rec; stats = st;
    if (!layer) build();
    open = true;
    document.body.classList.add('res-collapsed');
    const a = K.units.alt(rec.alt, 0);
    strip.querySelector('.rs-main').innerHTML = `${rec.mode === 'unlimited' ? 'Unlimited' : `Flight #${rec.n}`} · <b>${a.text} up</b>`;
    layer.classList.add('on');
    K.scene.setCaptionsDetail(true);
    cancelAnimationFrame(raf);
    const loop = () => { paint(); if (open) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!open) return;
    open = false;
    cancelAnimationFrame(raf);
    document.body.classList.remove('res-collapsed');
    layer.classList.remove('on');
    K.scene.climbTo(record.alt, { duration: 700 });
    const r = $('screen-results'); if (r) r.scrollTop = 0;
  }
  function setStats(st) { stats = st; }
  function hide() { if (open) close(); }

  return { show, close, hide, setStats, get open() { return open; } };
})();
