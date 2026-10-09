/* ==========================================================================
   KÁRMÁN · replay.js
   After landing, the results pass can be swiped down to a slim strip so the
   sky takes over. The rail steps right to make room and becomes the axis:
     • km ticks (0, 20, 50, 100, 140) to its left;
     • where everyone landed today: one bar per 5 km bin, running out from
       the rail, your bin in amber, a dashed YOU line at your altitude.
       Kept within the left ~40% of the sky and short of the balloon, which
       steps right while the pass is down. Nothing drawn without stats;
     • your seven legs: a thin line on the rail in the width's colour at the
       altitude each leg reached (a miss is a faint grey one, stepped 2.5 px
       above the last mark so it still counts). Hover or tap one for a tag.
   The pilot can drag or wheel on the sky to travel back down the climb.
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
    // Leg marks: hover (or a tap) shows one small tag, nothing otherwise.
    const legs = layer.querySelector('.rp-legs');
    let tagTimer = 0;
    const tagOf = (el, on) => {
      legs.querySelectorAll('.rp-leg.show').forEach((m) => { if (m !== el) m.classList.remove('show'); });
      el.classList.toggle('show', on);
    };
    legs.addEventListener('pointerover', (e) => { const m = e.target.closest('.rp-leg'); if (m && e.pointerType !== 'touch') tagOf(m, true); });
    legs.addEventListener('pointerout', (e) => { const m = e.target.closest('.rp-leg'); if (m && e.pointerType !== 'touch') m.classList.remove('show'); });
    legs.addEventListener('click', (e) => {
      const m = e.target.closest('.rp-leg'); if (!m) return;
      e.stopPropagation();
      clearTimeout(tagTimer);
      tagOf(m, !m.classList.contains('show'));
      tagTimer = setTimeout(() => m.classList.remove('show'), 2200);
    });
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

  /** Re-bin the server's buckets (any step) into 5 km bins from 0 to MAX_KM. */
  const BIN = 5;
  function bins(st) {
    const n = Math.ceil(K.scene.MAX_KM / BIN);
    const out = new Array(n).fill(0);
    const step = st.step || BIN;
    for (const [from, c] of st.buckets || []) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((from + step / 2) / BIN)));
      out[i] += c;
    }
    return out;
  }

  const TICKS = [0, 20, 50, 100, 140];
  let lastKey = '';

  function paint() {
    if (!open || !layer) return;
    const rail = $('rail');
    const rr = rail.getBoundingClientRect();
    const app = $('app').getBoundingClientRect();
    const rig = $('balloon-rig');
    const W = Math.round(app.width), H = Math.round(app.height);
    const top = rr.top - app.top, h = rr.height;
    const xr = rr.left - app.left + 4.5;                    // the rail line itself
    // The chart never meets the balloon: it stops short of the envelope, and
    // never runs past the left 40% of the screen.
    const balloonL = rig.offsetLeft - rig.offsetWidth / 2;
    const x0 = xr + 16;                                     // bars start after the leg marks
    const x1 = Math.min(W * 0.4, balloonL - 14, x0 + 170);
    const key = [W, H, top.toFixed(1), h.toFixed(1), xr.toFixed(1), x1.toFixed(0)].join('|');
    if (key === lastKey) return;
    lastKey = key;

    const yOf = (km) => top + (1 - K.scene.railFrac(km)) * h;
    const svg = layer.querySelector('.rp-chart');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.left = '0'; svg.style.top = '0'; svg.style.width = `${W}px`; svg.style.height = `${H}px`;
    let g = '';

    // km ticks on the rail: a short dash to the left, the number beside it
    TICKS.forEach((km) => {
      const y = yOf(km);
      g += `<line x1="${(xr - 9).toFixed(1)}" x2="${(xr - 3).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="rp-tick"/>`
        + `<text x="${(xr - 12).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="rp-tick-t">${km}</text>`;
    });

    // where everyone landed: one bar per 5 km bin, running out from the rail
    const alt = record.alt || 0;
    if (stats && stats.players > 0 && x1 - x0 > 30) {
      const counts = bins(stats);
      const mine = Math.min(counts.length - 1, Math.floor(alt / BIN));
      if (!counts[mine]) counts[mine] = 1;
      const peak = Math.max(1, ...counts);
      let bars = '';
      counts.forEach((c, i) => {
        if (!c) return;
        // The rail is a log scale: low bins are tall, high ones thin. A bar fills
        // its bin up to a cap, centred on it, so the bottom never turns into slabs.
        const yb = yOf(i * BIN), yt = yOf((i + 1) * BIN);
        const t = Math.max(1.5, Math.min(10, (yb - yt) - 2));
        const y = (yb + yt) / 2 - t / 2;
        const w = Math.max(3, (c / peak) * (x1 - x0));
        bars += `<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${t.toFixed(1)}" class="rp-bar${i === mine ? ' me' : ''}" style="--i:${i}"/>`;
      });
      g += `<g class="rp-bars">${bars}</g>`;
      const my = yOf(alt);
      g += `<line x1="${(xr + 10).toFixed(1)}" y1="${my.toFixed(1)}" x2="${(x1 + 6).toFixed(1)}" y2="${my.toFixed(1)}" class="rp-you"/>`
        + `<text x="${(x1 + 11).toFixed(1)}" y="${(my + 3.6).toFixed(1)}" class="rp-you-t">YOU</text>`;
    }
    svg.innerHTML = g;

    // your seven legs: a thin line on the rail at the altitude each one reached.
    // Legs that didn't lift sit on the previous mark, stepped 2.5 px so they still count.
    const legs = layer.querySelector('.rp-legs');
    const alts = legAltitudes(record);
    const ys = alts.map((l) => yOf(l.km));
    for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1] - 2.5) ys[i] = ys[i - 1] - 2.5;
    legs.innerHTML = alts.map((l, i) => {
      const chip = S().CHIPS[l.chip];
      const km = K.units.alt(l.km, 0).text;
      return `<div class="rp-leg${l.hit ? '' : ' miss'}" style="top:${ys[i].toFixed(1)}px;left:${(xr - 6).toFixed(1)}px;--c:var(--c-${chip && l.hit ? chip.key : 'miss'})" tabindex="0" aria-label="Leg ${i + 1}: ${l.hit ? `+${l.delta} km` : 'no lift'}, ${km}">`
        + `<i></i><span class="rp-tag">Leg ${i + 1} · ${l.hit ? `+${l.delta} km` : 'miss'}</span></div>`;
    }).join('');
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
    lastKey = '';                       // a fresh record or stats: redraw even at the same geometry
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
  function setStats(st) { stats = st; lastKey = ''; }
  function hide() { if (open) close(); }

  return { show, close, hide, setStats, get open() { return open; } };
})();
