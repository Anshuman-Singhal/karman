/* ==========================================================================
   KÁRMÁN · climb.js
   Results: the sky behind the pass replays your climb.

     open()    the pass slides down to a strip, the camera cuts to the meadow
               and climbs leg by leg at a cinematic pace: a soft burner puff,
               a climb, a beat, and a paper stub on the rail for that leg
               (what it asked, your guess and the answer, what it lifted you,
               and any milestone you crossed on the way). At the top: how high
               you got, against the Kármán line, and how you compare.
     scrub     the rail is the scrollbar while the pass is down: drag its
               thumb, wheel or trackpad over the sky, arrow keys, or tap a stub.
               Everything eases through one requestAnimationFrame loop, so
               nothing jumps. Any scrub ends the replay and shows every stub.
     close()   the pass comes back up; the camera settles at your altitude.

   Wiring: ui.js results() calls set(record) and setStats(stats); show()
   closes on any other screen. The handle (#res-handle) is a tab that floats
   above the pass (a grip on phones); it, and the pass's eyebrow row, drag
   the pass. Reduced motion: no replay and no slide; the stubs are a list.
   ========================================================================== */

K.climb = (() => {
  const S = K.scoring;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const STRIP = 64;                                 // px of the pass left showing
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let record = null, legs = [], open = false, finalKm = 0, stats = null;
  let raf = 0, panId = 0, touring = false, allShown = false;
  let marksEl, railEl, handle, dock, pad, thumb, track, sum, stubs = [];

  /* ------------------------------------------------------------ data */
  function set(rec) {
    record = rec;
    stats = null;
    finalKm = rec.alt || S.kmOf(rec.pts || 0);
    let pts = 0, prevKm = 0;
    legs = rec.rounds.map((r, i) => {
      pts = r.ptsAfter != null ? r.ptsAfter : pts + (r.delta || 0);      // older saves: add the deltas up
      const km = r.altAfter != null ? r.altAfter : S.kmOf(pts);
      const fact = K.game.factById(r.id);
      const crossed = S.MILESTONES.filter((m) => m.km > prevKm && m.km <= km && m.id !== 'orbit');
      const l = { i, km, from: prevKm, hit: Boolean(r.hit), chip: r.chip, delta: r.delta || 0, fact, none: r.guess == null, guess: r.guess, crossed };
      prevKm = km;
      return l;
    });
    if (open) close({ instant: true });
    paint();
  }
  /** Today's crowd, when it arrives (ui.js applyStats). */
  function setStats(st) { stats = st && st.players > 1 ? st : null; if (sum && allShown) sum.innerHTML = summaryHTML(); }

  /* ------------------------------------------------------------ words */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** "In what year was William Shakespeare born?" → "William Shakespeare born" */
  function shortQ(q) {
    let s = String(q || '').trim().replace(/[?.]+$/, '');
    const lead = /^(in what year (was|were|did|is)|what year (was|were|did)|when (was|were|did)|how (many|much|long|tall|far|old|fast|big|deep|heavy|high|wide|hot|cold|large|small|heavy)( is| are| was| were| does| did| do| can| has| have)?|what( is|'s| was| are| were)( the)?|which year)\s+/i;
    if (lead.test(s)) {
      const hadVerb = /^how \w+ (is|are|was|were|does|did|do|can|has|have)\s/i.test(s);
      s = s.replace(lead, '').replace(/^(the|a|an)\s+/i, '');
      // "how many bones are in…" → "bones in…": the first auxiliary goes with the question word
      if (!hadVerb) s = s.replace(/^(\S+(?:\s\S+)?)\s(is|are|was|were|does|did|do|has|have|can)\s/i, '$1 ');
    }
    if (s.length > 34) { const cut = s.slice(0, 33).replace(/\s+\S*$/, ''); s = `${cut}…`; }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function valText(l, x) {
    const f = l.fact;
    if (!f) return '';
    const v = K.units.view(f);
    return f.scale === 'year' ? (x < 0 ? `${Math.abs(Math.round(x))} BC` : String(Math.round(x))) : `${v.fmt(x, true)}${v.short ? ` ${v.short}` : ''}`;
  }
  const climbWord = (l) => (l.none ? 'no guess' : l.hit ? K.units.legText(l.from, l.km) : 'miss');

  function stubHTML(l) {
    const you = l.none ? '' : `<span class="cs-v"><i>You</i> ${esc(valText(l, l.guess))}</span> · `;
    const ans = l.fact ? `<span class="cs-v"><i>Answer</i> ${esc(valText(l, l.fact.answer))}</span>` : '';
    const x = l.crossed.length ? `<em class="cs-x">${esc(l.crossed.length === 1 ? l.crossed[0].name : l.crossed.map((m) => m.short).join(' · '))}</em>` : '';
    return `<span class="cs-head"><b class="cs-km">${esc(climbWord(l))}</b><small>Leg ${l.i + 1}</small></span>`
      + `<span class="cs-q">${esc(l.fact ? shortQ(l.fact.q) : '')}</span>`
      + `<span class="cs-va">${you}${ans}</span>${x}`;
  }
  function summaryHTML() {
    const alt = K.units.altText(finalKm);
    const pct = stats ? K.stats.percentile(stats, record.pts) : null;
    const line = finalKm >= S.MAX_KM - 0.05 ? 'Apogee: the top of the sky'
      : finalKm >= 100 ? `${K.units.climbText(finalKm - 100).replace(/^\+/, '')} past the Kármán line`
      : `${K.units.climbText(100 - finalKm).replace(/^\+/, '')} short of the Kármán line`;
    const cmp = pct == null ? '' : pct >= 100 || (stats && stats.buckets && !stats.buckets.some(([from]) => from > record.pts)) ? ' · nobody flew higher' : ` · better than ${pct}%`;
    return `<span class="cs-line"><b>Your climb</b> · ${esc(alt)}${cmp}</span><span class="cs-line cs-ctx">${esc(line)}</span><button type="button" class="cs-link" data-act="replay">Replay</button>`;
  }
  const skipHTML = () => '<span class="cs-line">Replaying your climb</span><button type="button" class="cs-link" data-act="skip">Skip</button>';

  /* ------------------------------------------------------------ the rail as a scale */
  const fracOf = (km) => K.scene.railFrac(km);
  /** Altitude at a rail fraction (railFrac is monotonic; bisect it). */
  function kmAt(f) {
    let lo = 0, hi = S.MAX_KM;
    for (let n = 0; n < 28; n++) { const mid = (lo + hi) / 2; if (fracOf(mid) < f) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  const railH = () => Math.max(1, marksEl.getBoundingClientRect().height);

  /* ------------------------------------------------------------ marks, stubs, thumb */
  function paint() {
    if (!marksEl) return;
    marksEl.innerHTML = '';
    stubs = [];
    let lastTop = null;
    legs.forEach((l) => {
      const m = document.createElement('div');
      m.className = `climb-mark${l.hit ? ' hit' : ' miss'}`;
      let top = (1 - fracOf(l.km)) * 100;
      // Legs that didn't lift you sit on the last mark: nudge each a hair so they stay countable.
      if (lastTop != null && top >= lastTop - 0.6) top = lastTop - 0.9;
      lastTop = top;
      m.style.top = `${top.toFixed(2)}%`;
      if (l.hit) m.style.setProperty('--c', `var(--c-${S.CHIPS[l.chip].key})`);
      m.dataset.i = String(l.i);
      m.addEventListener('pointerdown', (e) => { e.stopPropagation(); goTo(l.km); });
      marksEl.appendChild(m);

      const s = document.createElement('div');
      s.className = `climb-stub${l.hit ? ' hit' : l.none ? ' none' : ' miss'}`;
      s.style.setProperty('--c', l.hit ? `var(--c-${S.CHIPS[l.chip].key})` : 'var(--c-miss)');
      s.dataset.top = String(top);
      s.innerHTML = stubHTML(l);
      s.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      s.addEventListener('click', () => goTo(l.km));
      marksEl.appendChild(s);
      stubs.push(s);
    });
    if (allShown) revealAll(true);
  }
  /** Stack the stubs up the rail so none overlaps the one below it. */
  function placeStubs() {
    const H = railH(), GAP = 4;
    const hs = stubs.map((s) => s.offsetHeight || 40);
    const tops = stubs.map((s, i) => (Number(s.dataset.top) / 100) * H - hs[i] / 2);
    // up the rail: each stub clears the one below it (an earlier leg, lower down)
    for (let i = 1; i < tops.length; i++) if (tops[i] + hs[i] + GAP > tops[i - 1]) tops[i] = tops[i - 1] - hs[i] - GAP;
    // and back down: nothing above the top of the rail, so a tall stack settles downward
    if (tops.length && tops[tops.length - 1] < 0) {
      tops[tops.length - 1] = 0;
      for (let i = tops.length - 2; i >= 0; i--) if (tops[i] < tops[i + 1] + hs[i + 1] + GAP) tops[i] = tops[i + 1] + hs[i + 1] + GAP;
    }
    stubs.forEach((s, i) => { s.style.top = `${Math.max(0, tops[i]).toFixed(1)}px`; });
  }
  function showStub(i) {
    const s = stubs[i];
    if (!s || s.classList.contains('in')) return;
    placeStubs();
    s.classList.add('in');
    const m = marksEl.querySelector(`.climb-mark[data-i="${i}"]`);
    if (m) m.classList.add('lit');
  }
  function hideStubs() {
    stubs.forEach((s) => s.classList.remove('in'));
    marksEl.querySelectorAll('.climb-mark.lit').forEach((x) => x.classList.remove('lit'));
    allShown = false;
  }
  function revealAll(quiet) {
    allShown = true;
    placeStubs();
    stubs.forEach((s, i) => { s.style.transitionDelay = quiet ? '' : `${i * 40}ms`; s.classList.add('in'); });
    marksEl.querySelectorAll('.climb-mark').forEach((x) => x.classList.add('lit'));
    if (sum) { sum.innerHTML = summaryHTML(); sum.classList.add('in'); }
  }
  function placeThumb(km) {
    if (!thumb) return;
    thumb.style.top = `${((1 - fracOf(km)) * 100).toFixed(2)}%`;
    thumb.setAttribute('aria-valuenow', String(Math.round(km)));
    thumb.setAttribute('aria-valuetext', K.units.altText(km));
  }

  /* ------------------------------------------------------------ the camera */
  /* One loop while open: the scrub eases toward its target, the altimeter and
     the thumb follow the camera, and (during the replay) stubs appear as the
     camera reaches each leg. */
  let scrub = null;                              // { cur, to } in rail fraction, or null when the replay drives
  function follow() {
    if (!open) { raf = 0; return; }
    if (scrub) {
      const d = scrub.to - scrub.cur;
      if (Math.abs(d) < 0.0008) scrub.cur = scrub.to; else scrub.cur += d * (scrub.direct ? 0.38 : 0.2);
      K.scene.climbTo(kmAt(scrub.cur), { duration: 1 });
    }
    const km = K.scene.km;
    K.ui.setAltitude(S.ptsOf(km), { instant: true });
    placeThumb(km);
    raf = requestAnimationFrame(follow);
  }

  /** Scrub to an altitude (eased). Ends the replay. */
  function goTo(km, direct) {
    if (!open) return;
    endTour();
    if (!scrub) scrub = { cur: fracOf(K.scene.km), to: fracOf(K.scene.km) };
    scrub.to = clamp(fracOf(km), 0, fracOf(finalKm));
    scrub.direct = Boolean(direct);
  }
  function scrubByPx(dy, direct) {
    if (!open) return;
    endTour();
    if (!scrub) scrub = { cur: fracOf(K.scene.km), to: fracOf(K.scene.km) };
    scrub.to = clamp(scrub.to - dy / railH(), 0, fracOf(finalKm));
    scrub.direct = Boolean(direct);
  }
  function endTour() {
    if (!touring && allShown) return;
    panId++;
    touring = false;
    revealAll(false);
  }

  /* ------------------------------------------------------------ the replay */
  async function tour() {
    const id = ++panId;
    scrub = null;
    hideStubs();
    touring = true;
    if (sum) { sum.innerHTML = skipHTML(); sum.classList.add('in'); }
    const alive = () => open && id === panId;
    K.scene.climbTo(0, { duration: 1 });
    await sleep(700);                                   // a beat in the meadow
    if (!alive()) return;
    for (const l of legs) {
      if (l.hit && l.km > l.from + 0.01) {
        if (K.audio && K.audio.enabled && K.audio.enabled()) K.audio.burner(0.22);
        const dur = clamp(420 + (l.km - l.from) * 38, 520, 1300);
        K.scene.climbTo(l.km, { duration: dur });
        await sleep(dur + 40);
        if (!alive()) return;
      }
      showStub(l.i);
      await sleep(l.hit ? 820 : 520);
      if (!alive()) return;
    }
    touring = false;
    revealAll(true);
  }
  function skipTour() {
    if (!touring) return;
    panId++;
    touring = false;
    K.scene.climbTo(finalKm, { duration: 700 });
    scrub = null;
    revealAll(false);
  }

  /* ------------------------------------------------------------ inputs on the sky and the rail */
  function onWheel(e) { if (!open) return; e.preventDefault(); scrubByPx(e.deltaY * 0.55); }   // wheel down: down the rail
  let padDrag = null;
  function onPadDown(e) {
    if (!open) return;
    padDrag = { y: e.clientY, y0: e.clientY, moved: false, touch: e.pointerType === 'touch' };
    pad.setPointerCapture(e.pointerId);
  }
  function onPadMove(e) {
    if (!padDrag) return;
    const dy = e.clientY - padDrag.y;
    if (Math.abs(e.clientY - padDrag.y0) > 5) padDrag.moved = true;
    if (!padDrag.touch || !padDrag.moved) return;
    padDrag.y = e.clientY;
    scrubByPx(-dy, true);                               // finger drags the sky: the sky follows the finger
  }
  function onPadUp(e) {
    if (!padDrag) return;
    const d = padDrag; padDrag = null;
    if (!d.moved && e.type !== 'pointercancel' && touring) skipTour();   // a tap on the sky skips the replay
  }
  /* The thumb: drag it along the rail. The track: click to jump. */
  let thumbDrag = null;
  function railFracAt(clientY) { const r = marksEl.getBoundingClientRect(); return clamp(1 - (clientY - r.top) / r.height, 0, 1); }
  function onThumbDown(e) { if (!open) return; e.stopPropagation(); thumbDrag = true; thumb.setPointerCapture(e.pointerId); thumb.classList.add('held'); goTo(kmAt(railFracAt(e.clientY)), true); }
  function onThumbMove(e) { if (!thumbDrag) return; goTo(kmAt(railFracAt(e.clientY)), true); }
  function onThumbUp() { thumbDrag = false; thumb.classList.remove('held'); }
  function onTrackDown(e) { if (!open) return; e.stopPropagation(); goTo(kmAt(railFracAt(e.clientY))); }
  function onKey(e) {
    if (!open || e.altKey || e.metaKey || e.ctrlKey) return;
    if (document.querySelector('.sheet-wrap:not([hidden])')) return;
    const steps = { ArrowUp: 0.04, ArrowDown: -0.04, PageUp: 0.15, PageDown: -0.15 };
    if (e.key in steps) { e.preventDefault(); scrubByPx(-steps[e.key] * railH()); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(finalKm); }
    else if (e.key === 'Escape') close();
  }

  /* ------------------------------------------------------------ open / close */
  function setOpen(on, instant) {
    open = on;
    document.body.classList.toggle('climb-open', on);
    document.body.classList.toggle('climb-instant', Boolean(instant));
    handle.setAttribute('aria-expanded', String(on));
    [dock, handle].forEach((el) => {
      el.style.translate = '';
      el.style.transition = instant ? 'none' : '';
    });
    if (instant) { void dock.offsetHeight; dock.style.transition = ''; handle.style.transition = ''; }
  }
  function doOpen() {
    if (open || !record || K.ui.current !== 'results') return;
    seatHandle();
    setOpen(true, K.fx.reduced());
    scrub = null;
    allShown = false;
    if (!raf) raf = requestAnimationFrame(follow);
    K.fx.haptic && K.fx.haptic(6);
    if (K.fx.reduced()) { K.scene.climbTo(finalKm, { duration: 1 }); touring = false; revealAll(true); return; }
    tour();
  }
  function close(opts = {}) {
    if (!open) return;
    panId++;
    touring = false;
    scrub = null;
    hideStubs();
    if (sum) sum.classList.remove('in');
    setOpen(false, Boolean(opts.instant) || K.fx.reduced());
    // Leaving results for a new flight: the sky already belongs to that flight,
    // so nothing of this one is put back.
    if (opts.restore === false) { if (raf) { cancelAnimationFrame(raf); raf = 0; } return; }
    // A cut, not a climb: the rising pass covers it, and the craft is set to its
    // final stage first so no staging effect (or sound) replays on the way up.
    K.vehicle.set(finalKm);
    K.scene.climbTo(finalKm, { duration: 1 });
    requestAnimationFrame(() => K.vehicle.set(finalKm));
    K.ui.setAltitude(S.ptsOf(finalKm), { instant: true });
  }
  const toggle = () => (open ? close() : doOpen());
  const replay = () => { if (!open || K.fx.reduced()) return; tour(); };

  /* ------------------------------------------------------------ the tab above the pass */
  /* The handle lives outside the pass, so it needs to know where the pass's top
     edge is (--dock-h) and how far the pass travels when it parks (--pass-travel). */
  function seatHandle() {
    if (!dock || !handle) return;
    const h = dock.offsetHeight;
    const desk = window.matchMedia('(min-width: 720px)').matches;
    handle.style.setProperty('--dock-h', `${h}px`);
    handle.style.setProperty('--pass-travel', `${h - STRIP + (desk ? 20 : 0)}px`);
  }

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
    handle.style.transition = 'none';
  }
  function dragMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const y = clamp(drag.from + dy, 0, drag.h - STRIP);
    dock.style.translate = `0 ${y.toFixed(1)}px`;
    handle.style.translate = `0 ${y.toFixed(1)}px`;
    // the sky follows the pass: lower pass, lower camera, so the drag already tells the story
    if (!open) { const f = y / (drag.h - STRIP); K.scene.climbTo(finalKm * (1 - f * 0.6), { duration: 120 }); }
  }
  function dragEnd(e) {
    if (!drag) return;
    const d = drag; drag = null;
    dock.style.transition = '';
    handle.style.transition = '';
    if (!d.moved) { if (e.type !== 'pointercancel') toggle(); return; }
    const dy = e.clientY - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0);      // px per ms
    const travel = d.h - STRIP;
    const reset = () => { dock.style.translate = ''; handle.style.translate = ''; };
    if (!open) {
      if (dy > travel / 3 || v > 0.5) { reset(); doOpen(); } else { reset(); K.scene.climbTo(finalKm, { duration: 500 }); }
    } else if (-dy > travel / 3 || v < -0.5) close(); else reset();
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
    railEl = $('rail');
    if (!marksEl || !handle || !dock) return;
    // The thumb and the track: the rail is a scrollbar while the pass is down.
    track = document.createElement('div');
    track.className = 'climb-track';
    track.addEventListener('pointerdown', onTrackDown);
    railEl.appendChild(track);
    thumb = document.createElement('div');
    thumb.className = 'climb-thumb';
    thumb.setAttribute('role', 'slider');
    thumb.setAttribute('aria-label', 'Altitude');
    thumb.setAttribute('aria-valuemin', '0');
    thumb.setAttribute('aria-valuemax', String(S.MAX_KM));
    thumb.addEventListener('pointerdown', onThumbDown);
    thumb.addEventListener('pointermove', onThumbMove);
    thumb.addEventListener('pointerup', onThumbUp);
    thumb.addEventListener('pointercancel', onThumbUp);
    railEl.appendChild(thumb);
    // The summary slip under the altimeter: "Skip" during the replay, then your climb in a line.
    sum = document.createElement('div');
    sum.id = 'climb-sum';
    sum.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'skip') skipTour(); else replay();
    });
    $('app').appendChild(sum);
    // A pad over the sky catches the wheel (and a finger) while the pass is down.
    pad = document.createElement('div');
    pad.id = 'climb-pad';
    pad.setAttribute('aria-hidden', 'true');
    $('app').appendChild(pad);
    pad.addEventListener('wheel', onWheel, { passive: false });
    pad.addEventListener('pointerdown', onPadDown);
    pad.addEventListener('pointermove', onPadMove);
    pad.addEventListener('pointerup', onPadUp);
    pad.addEventListener('pointercancel', onPadUp);
    railEl.addEventListener('wheel', onWheel, { passive: false });
    grab(handle);
    grab($('res-eyebrow'));
    handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { seatHandle(); if (open) { paint(); placeStubs(); } });
    if (window.ResizeObserver) new ResizeObserver(seatHandle).observe(dock);
    seatHandle();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { set, setStats, open: doOpen, close, toggle, replay, seat: seatHandle, get isOpen() { return open; } };
})();
