/* ==========================================================================
   KÁRMÁN · climb.js
   Results: drag the pass down and the sky shows your climb.

     open()    the pass slides to a strip at the foot of the screen, the camera
               drops to the meadow and flies back up to where you landed, and
               every leg is marked on the altitude rail: one short horizontal
               line at the height it left you, in that width's colour (a miss
               is a faint dash). Tapping a mark, or passing it while you scrub
               the sky, shows "Leg 3 · +10 km · 1896".
     close()   the pass comes back up; the camera settles at your altitude.

   Wiring: ui.js results() calls set(record); show() closes on any other
   screen. The handle (#res-handle) is a button everywhere and a drag grip
   on touch; the pass's eyebrow row drags too. Reduced motion: no pan, no
   slide, everything instant.
   ========================================================================== */

K.climb = (() => {
  const S = K.scoring;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const STRIP = 64;                                 // px of the pass left showing

  let record = null, legs = [], open = false, finalKm = 0;
  let tagTimer = 0, raf = 0, lastCross = -1, panId = 0;
  let marksEl, tagEl, handle, dock, pad;

  /* ------------------------------------------------------------ data */
  function set(rec) {
    record = rec;
    finalKm = rec.alt || S.kmOf(rec.pts || 0);
    let pts = 0;
    legs = rec.rounds.map((r, i) => {
      pts = r.ptsAfter != null ? r.ptsAfter : pts + (r.delta || 0);      // older saves: add the deltas up
      const km = r.altAfter != null ? r.altAfter : S.kmOf(pts);
      const fact = K.game.factById(r.id);
      return { i, km, hit: Boolean(r.hit), chip: r.chip, delta: r.delta || 0, fact, none: r.guess == null };
    });
    if (open) close({ instant: true });
    paint();
  }

  /** "Leg 3 · +10 km · 1896" */
  function label(l) {
    const climb = l.none ? 'no guess' : l.hit ? K.units.climbText(S.kmOf(l.delta)) : 'miss';
    let ans = '';
    if (l.fact) {
      const v = K.units.view(l.fact);
      ans = l.fact.scale === 'year' ? v.fmt(l.fact.answer) : `${v.fmt(l.fact.answer, true)}${v.short ? ` ${v.short}` : ''}`;
    }
    return `Leg ${l.i + 1} · ${climb}${ans ? ` · ${ans}` : ''}`;
  }

  /* ------------------------------------------------------------ marks on the rail */
  function paint() {
    if (!marksEl) return;
    marksEl.innerHTML = '';
    let lastTop = null;
    legs.forEach((l) => {
      const m = document.createElement('div');
      m.className = `climb-mark${l.hit ? ' hit' : ' miss'}`;
      let top = (1 - K.scene.railFrac(l.km)) * 100;
      // Legs that didn't lift you sit on the last mark: nudge each a hair so they stay countable.
      if (lastTop != null && top >= lastTop - 0.6) top = lastTop - 0.9;
      lastTop = top;
      m.style.top = `${top.toFixed(2)}%`;
      if (l.hit) m.style.setProperty('--c', `var(--c-${S.CHIPS[l.chip].key})`);
      m.dataset.i = String(l.i);
      m.title = label(l);
      m.addEventListener('pointerdown', (e) => { e.stopPropagation(); showTag(l.i, 2200); });
      m.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTag(l.i, 0); });
      m.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTag(); });
      marksEl.appendChild(m);
    });
  }

  function showTag(i, ms) {
    const l = legs[i];
    const m = marksEl.querySelector(`.climb-mark[data-i="${i}"]`);
    if (!l || !m) return;
    clearTimeout(tagTimer);
    tagEl.textContent = label(l);
    tagEl.style.top = m.style.top;
    tagEl.classList.toggle('is-miss', !l.hit);
    tagEl.hidden = false;
    void tagEl.offsetWidth;
    tagEl.classList.add('in');
    marksEl.querySelectorAll('.climb-mark.lit').forEach((x) => x.classList.remove('lit'));
    m.classList.add('lit');
    if (ms) tagTimer = setTimeout(hideTag, ms);
  }
  function hideTag() {
    clearTimeout(tagTimer);
    tagEl.classList.remove('in');
    marksEl.querySelectorAll('.climb-mark.lit').forEach((x) => x.classList.remove('lit'));
    tagTimer = setTimeout(() => { tagEl.hidden = true; }, 220);
  }

  /* ------------------------------------------------------------ the camera */
  /** While open: the altimeter follows the camera, and the tag pops as you pass each leg. */
  function follow() {
    if (!open) { raf = 0; return; }
    const km = K.scene.km;
    K.ui.setAltitude(S.ptsOf(km), { instant: true });
    // the highest leg the camera has reached
    let at = -1;
    legs.forEach((l, i) => { if (l.hit && km >= l.km - 0.05) at = i; });
    if (at !== lastCross) {
      lastCross = at;
      if (at >= 0) showTag(at, 1500);
    }
    raf = requestAnimationFrame(follow);
  }

  function pan() {
    const id = ++panId;
    if (K.fx.reduced()) { K.scene.climbTo(finalKm, { duration: 1 }); return; }
    K.scene.climbTo(0, { duration: 1 });
    setTimeout(() => {
      if (!open || id !== panId) return;
      lastCross = -1;
      K.scene.climbTo(finalKm, { duration: clamp(1600 + finalKm * 14, 1800, 3400) });
    }, 520);
  }

  /** Scrub the sky: wheel or a vertical drag moves the camera along the climb. */
  let scrubKm = null, scrubY = 0, scrubbing = false;
  function scrubBy(dy) {
    if (!open) return;
    panId++;                                           // any scrub cancels the pan
    if (scrubKm == null) scrubKm = K.scene.km;
    scrubKm = clamp(scrubKm + dy * 0.055, 0, finalKm);
    K.scene.climbTo(scrubKm, { duration: 160 });
  }
  function onWheel(e) { if (!open) return; e.preventDefault(); scrubBy(-e.deltaY); }
  function onPadDown(e) { if (!open) return; scrubbing = true; scrubY = e.clientY; pad.setPointerCapture(e.pointerId); }
  function onPadMove(e) { if (!scrubbing) return; const dy = e.clientY - scrubY; scrubY = e.clientY; scrubBy(dy); }
  function onPadUp() { scrubbing = false; }

  /* ------------------------------------------------------------ open / close */
  function setOpen(on, instant) {
    open = on;
    document.body.classList.toggle('climb-open', on);
    document.body.classList.toggle('climb-instant', Boolean(instant));
    handle.setAttribute('aria-expanded', String(on));
    dock.style.translate = '';
    dock.style.transition = instant ? 'none' : '';
    if (instant) { void dock.offsetHeight; dock.style.transition = ''; }
  }
  function doOpen() {
    if (open || !record || K.ui.current !== 'results') return;
    scrubKm = null;
    lastCross = -1;
    setOpen(true, K.fx.reduced());
    pan();
    if (!raf) raf = requestAnimationFrame(follow);
    K.fx.haptic && K.fx.haptic(6);
  }
  function close(opts = {}) {
    if (!open) return;
    panId++;
    hideTag();
    setOpen(false, Boolean(opts.instant) || K.fx.reduced());
    // A cut, not a climb: the rising pass covers it, and the craft is set to its
    // final stage first so no staging effect (or sound) replays on the way up.
    K.vehicle.set(finalKm);
    K.scene.climbTo(finalKm, { duration: 1 });
    requestAnimationFrame(() => K.vehicle.set(finalKm));
    K.ui.setAltitude(S.ptsOf(finalKm), { instant: true });
  }
  const toggle = () => (open ? close() : doOpen());

  /* ------------------------------------------------------------ drag */
  /* The handle and the pass's head row drag the whole pass. Past a third of
     the way (or a quick flick) it commits; otherwise it springs back. */
  let drag = null;
  function dragStart(e) {
    if (K.ui.current !== 'results' || e.button > 0) return;
    const r = dock.getBoundingClientRect();
    drag = { y0: e.clientY, t0: performance.now(), h: r.height, moved: false, from: open ? r.height - STRIP : 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    dock.style.transition = 'none';
  }
  function dragMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const y = clamp(drag.from + dy, 0, drag.h - STRIP);
    dock.style.translate = `0 ${y.toFixed(1)}px`;
    // the sky follows the pass: lower pass, lower camera, so the drag already tells the story
    if (!open) { const f = y / (drag.h - STRIP); K.scene.climbTo(finalKm * (1 - f * 0.6), { duration: 120 }); }
  }
  function dragEnd(e) {
    if (!drag) return;
    const d = drag; drag = null;
    dock.style.transition = '';
    if (!d.moved) { if (e.type !== 'pointercancel') toggle(); return; }
    const dy = e.clientY - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0);      // px per ms
    const travel = d.h - STRIP;
    if (!open) {
      if (dy > travel / 3 || v > 0.5) doOpen(); else { dock.style.translate = ''; K.scene.climbTo(finalKm, { duration: 500 }); }
    } else if (-dy > travel / 3 || v < -0.5) close(); else dock.style.translate = '';
  }
  function grab(el) {
    if (!el) return;
    el.addEventListener('pointerdown', dragStart);
    el.addEventListener('pointermove', dragMove);
    el.addEventListener('pointerup', dragEnd);
    el.addEventListener('pointercancel', dragEnd);
  }

  function init() {
    marksEl = $('climb-marks');
    handle = $('res-handle');
    dock = $('dock');
    if (!marksEl || !handle) return;
    tagEl = document.createElement('div');
    tagEl.className = 'climb-tag';
    tagEl.hidden = true;
    $('rail').appendChild(tagEl);
    // A pad over the sky catches wheel and drag while the pass is down.
    pad = document.createElement('div');
    pad.id = 'climb-pad';
    pad.setAttribute('aria-hidden', 'true');
    $('app').appendChild(pad);
    pad.addEventListener('wheel', onWheel, { passive: false });
    pad.addEventListener('pointerdown', onPadDown);
    pad.addEventListener('pointermove', onPadMove);
    pad.addEventListener('pointerup', onPadUp);
    pad.addEventListener('pointercancel', onPadUp);
    grab(handle);
    grab($('res-eyebrow'));
    handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
    window.addEventListener('resize', () => { if (open) paint(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { set, open: doOpen, close, toggle, get isOpen() { return open; } };
})();
