/* ==========================================================================
   KÁRMÁN · coach.js
   The one guided leg: the first leg of a pilot's first flight (and once more
   for everyone whenever storage.js bumps guideV). A spotlight tutorial; the
   veil covers everything EXCEPT the controls the slip is about, so the
   player just does the thing:

     1 · "Type your best guess."   → a pause in the typing advances
     2 · "Tap Wide."               → only Wide advances
     3 · "Now tap Pinpoint."       → only Pinpoint advances
     4 · "How sure are you? Pick one." → Pinpoint holds a beat, then every width
         is unselected (Lock waits), a slow colour wash runs across the five
         boxes, and a small arrow in each box's colour bobs over it, each box
         breathing its tint, until the player picks one. Then the ring moves
         to Lock, and locking ends the guide.
   Players used to tap the pre-selected width and never look at the others
   (Oct 2026), so steps 2 and 3 make them feel both ends of the trade before
   choosing. Every width tap in the guide runs a highlighter, in that width's
   colour, under the range numbers and lets it fade: the card itself shows
   what changed. Step 4 sweeps the same highlighter across all five widths.
   The lit area only ever grows, so a player can keep typing throughout.

   One slip, anchored above the card: its text crossfades and its height
   eases between steps; the ring, the hole in the veil and the arrow glide
   to their next target (CSS transitions, off under reduced motion).

   No Next button. "Skip" on the slip ends it and starts the clock.
   The veil is four panels around a hole, so the lit control is live.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  const reduced = () => (K.fx && K.fx.reduced ? K.fx.reduced() : matchMedia('(prefers-reduced-motion: reduce)').matches);
  let step = 0;
  let veil = null, panels = [], ring = null, slip = null, arrow = null, lit = null, focus = null;
  let pips = null, text = null, swapT = 0;
  let arrows = [];             // step 4: one small arrow per width, in its colour
  let pick = '';               // step 4 phase: 'wash' → 'choose' → 'chosen'
  let seqT = [];               // step 4 timers
  const later = (fn, ms) => { seqT.push(setTimeout(fn, ms)); };
  let onDone = null;

  // The lit area grows rather than moves: the guess stays live (keep typing,
  // fix a digit) while the width row, then Lock, join it. The ring marks the
  // control the slip is about.
  const entry = () => (coarse() ? [$('readout'), $('keypad')] : [$('readout')]);
  const chipEl = (i) => document.querySelectorAll('#wbtns .wbtn')[i];
  const S = () => K.scoring;
  const STEPS = {
    1: { at: () => entry(), focus: () => (coarse() ? $('keypad') : $('readout')), tone: 'amber',
      title: () => 'Type your best guess.', body: () => '<p>No clock on this one.</p>' },
    2: { at: () => [...entry(), $('wbtns')], focus: () => chipEl(0), arrowAt: () => chipEl(0), tone: 'wide',
      title: () => 'Tap Wide.', body: () => '<p>Watch your range.</p>' },
    3: { at: () => [...entry(), $('wbtns')], focus: () => chipEl(4), arrowAt: () => chipEl(4), tone: 'pinpoint',
      title: () => 'Now tap Pinpoint.', body: () => '' },
    4: { at: () => [...entry(), $('wbtns'), $('btn-lock')], focus: () => (pick === 'chosen' ? $('btn-lock') : $('wbtns')), tone: 'amber',
      title: () => (pick === 'chosen' ? 'Now lock it in.' : 'How sure are you? Pick one.'),
      body: () => (pick === 'chosen' ? '' : '<p><b>Wide</b> if you’re unsure, all the way to <b>Pinpoint</b> if you know it exactly. The surer you are, the higher you climb, but the tighter your range.</p>') },
  };
  const LAST = 4;

  /* ---------------------------------------------------------- layout */
  const R = (el) => el.getBoundingClientRect();

  function place() {
    if (!slip || !lit || !lit.length) return;
    const rs = lit.map(R), pad = 6, W = window.innerWidth, H = window.innerHeight;
    const r = { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) };
    const hole = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    const f = focus ? R(focus) : r;
    const ringBox = { l: f.left - pad, t: f.top - pad, r: f.right + pad, b: f.bottom + pad };
    // four blocking panels around the hole
    const [top, left, right, bottom] = panels;
    Object.assign(top.style, { left: 0, top: 0, width: `${W}px`, height: `${Math.max(0, hole.t)}px` });
    Object.assign(bottom.style, { left: 0, top: `${hole.b}px`, width: `${W}px`, height: `${Math.max(0, H - hole.b)}px` });
    Object.assign(left.style, { left: 0, top: `${hole.t}px`, width: `${Math.max(0, hole.l)}px`, height: `${hole.b - hole.t}px` });
    Object.assign(right.style, { left: `${hole.r}px`, top: `${hole.t}px`, width: `${Math.max(0, W - hole.r)}px`, height: `${hole.b - hole.t}px` });
    Object.assign(ring.style, { left: `${ringBox.l}px`, top: `${ringBox.t}px`, width: `${ringBox.r - ringBox.l}px`, height: `${ringBox.b - ringBox.t}px` });
    // The slip hangs above the card (over the sky), centred on it and anchored
    // at its foot, so it only ever grows upward and never covers the keys.
    const dock = $('dock');
    const d = dock ? R(dock) : { left: 0, width: W, top: H * 0.55 };
    const w = Math.min(336, W - 32);
    const x = Math.max(16, Math.min(W - w - 16, d.left + d.width / 2 - w / 2));
    slip.style.width = `${w}px`;
    slip.style.left = `${x}px`;
    slip.style.bottom = `${Math.max(12, H - d.top + 14)}px`;
    // the arrow over the width to tap; it glides from one to the next
    const s = STEPS[step];
    const target = s && s.arrowAt ? s.arrowAt() : null;
    if (target) {
      const a = R(target);
      arrow.style.left = `${a.left + a.width / 2}px`;
      arrow.style.top = `${a.top - 3}px`;   // its tip rests on the ring; the bounce taps down, never up into the readout
      arrow.classList.add('on');
    } else arrow.classList.remove('on');
    // step 4: an arrow over every width while the player chooses
    arrows.forEach((a, i) => {
      const c = chipEl(i);
      if (!c) return;
      const b = R(c);
      a.style.left = `${b.left + b.width / 2}px`;
      a.style.top = `${b.top - pad - 1}px`;
    });
  }

  /* ---------------------------------------------------------- dom */
  function ensureDom() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'coach-veil';
    panels = ['top', 'left', 'right', 'bottom'].map((k) => { const d = document.createElement('div'); d.className = `coach-panel coach-${k}`; veil.appendChild(d); return d; });
    ring = document.createElement('div'); ring.className = 'coach-ring'; veil.appendChild(ring);
    arrow = document.createElement('div'); arrow.className = 'coach-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 22 28" aria-hidden="true"><path d="M8 1.5h6v12h5.5L11 26.5 2.5 13.5H8z" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    veil.appendChild(arrow);
    arrows = S().CHIPS.map((c, i) => {
      const a = document.createElement('div');
      a.className = 'coach-arrow coach-mini';
      a.style.setProperty('--ac', `var(--c-${c.key})`);
      a.style.setProperty('--hl-delay', `${i * 140}ms`);
      a.innerHTML = '<svg viewBox="0 0 22 28" aria-hidden="true"><path d="M8 1.5h6v12h5.5L11 26.5 2.5 13.5H8z" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      veil.appendChild(a);
      return a;
    });
    slip = document.createElement('div');
    slip.className = 'coach-slip';
    slip.setAttribute('role', 'status');
    slip.innerHTML = `<div class="coach-head"><span class="coach-pips" aria-hidden="true">${'<i></i>'.repeat(LAST)}</span><button type="button" class="coach-skip">Skip</button></div><div class="coach-text"><p class="coach-title"></p><div class="coach-body"></div></div>`;
    pips = [...slip.querySelectorAll('.coach-pips i')];
    text = slip.querySelector('.coach-text');
    slip.querySelector('.coach-skip').addEventListener('click', skip);
    veil.appendChild(slip);
    document.body.appendChild(veil);
    // the panels swallow taps so nothing else moves while a slip is up
    panels.forEach((p) => ['pointerdown', 'click', 'touchstart'].forEach((ev) => p.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false })));
    window.addEventListener('resize', place);
  }

  /** The slip's words: crossfade the text and ease the height, in place. */
  function setText(s, first) {
    const fill = () => {
      slip.querySelector('.coach-title').textContent = s.title();
      slip.querySelector('.coach-body').innerHTML = s.body();
    };
    clearTimeout(swapT);
    if (first || reduced()) {
      fill();
      text.style.height = '';
      return;
    }
    const h0 = text.offsetHeight;
    text.style.height = `${h0}px`;
    text.classList.add('out');
    swapT = setTimeout(() => {
      fill();
      text.style.height = 'auto';
      const h1 = text.offsetHeight;
      text.style.height = `${h0}px`;
      void text.offsetWidth;
      text.style.height = `${h1}px`;
      text.classList.remove('out');
      swapT = setTimeout(() => { text.style.height = ''; }, 320);
    }, 150);
  }

  function show(n) {
    const first = !veil;
    ensureDom();
    step = n;
    const s = STEPS[n];
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = s.at().filter(Boolean);
    focus = s.focus ? s.focus() : null;
    lit.forEach((e) => e.classList.add('coach-lit'));
    veil.dataset.tone = s.tone;
    slip.dataset.step = String(n);
    pips.forEach((p, i) => { p.classList.toggle('done', i < n - 1); p.classList.toggle('now', i === n - 1); });
    setText(s, first);
    place();
    if (first) { void veil.offsetWidth; veil.classList.add('on'); }   // lay out first, so nothing glides in from nowhere
    requestAnimationFrame(place);
  }

  /** A highlighter stroke under `els` in a width's colour, then it fades.
      Restarts cleanly if tapped again mid-stroke. stagger: ms between items. */
  function mark(els, colorOf, stagger = 0, cls = 'coach-hl') {
    if (reduced()) return;
    els.forEach((e, i) => {
      if (!e) return;
      e.classList.remove(cls);
      e.style.setProperty('--hl', colorOf(i));
      e.style.setProperty('--hl-delay', `${i * stagger}ms`);
      void e.offsetWidth;
      e.classList.add(cls);
    });
  }
  const chipColor = (i) => `var(--hl-${S().CHIPS[i].key})`;
  const markRange = (chip) => mark([...document.querySelectorAll('#readout .r-num')], () => chipColor(chip));
  const widthEls = () => [...document.querySelectorAll('#wbtns .wbtn')];

  /** Step 4, in order: Pinpoint's range holds a beat → every width is unselected
      → a slow wash crosses the five boxes → an arrow bobs over each box, each
      breathing its tint, until the player picks. */
  function toChoose() {
    pick = 'wash';
    later(() => {
      if (step !== 3) return;
      K.round.clearChip();
      show(4);
      mark(widthEls(), chipColor, 230, 'coach-box');
      later(() => {
        if (step !== 4 || pick !== 'wash') return;
        pick = 'choose';
        widthEls().forEach((b, i) => { b.style.setProperty('--hl', chipColor(i)); b.style.setProperty('--hl-delay', `${i * 140}ms`); b.classList.add('coach-breathe'); });
        place();
        arrows.forEach((a) => a.classList.add('on'));
      }, reduced() ? 0 : 230 * 4 + 1500);
    }, reduced() ? 300 : 1100);
  }
  function chosen(chip) {
    const firstPick = pick !== 'chosen';
    pick = 'chosen';
    seqT.forEach(clearTimeout); seqT = [];
    arrows.forEach((a) => a.classList.remove('on'));
    widthEls().forEach((b) => b.classList.remove('coach-breathe', 'coach-box'));
    markRange(chip);
    focus = $('btn-lock');
    if (slip && firstPick) setText(STEPS[4]);
    place();
  }

  /* ---------------------------------------------------------- hooks */
  function start() { pick = ''; show(1); }

  /** round.js reports keypad / width changes through game.js. */
  // Step 1 waits for a pause in the typing (not the first digit), so a full
  // number goes in before the slip changes; the keypad stays live either way.
  let typeT = 0;
  function input(entry, chip, kind) {
    if (!step) return;
    clearTimeout(typeT);
    if (step === 1 && entry) typeT = setTimeout(() => { if (step === 1) show(2); }, 1100);
    else if (kind === 'chip' && step === 4) chosen(chip);
    else if (kind === 'chip' && step === 3 && pick === 'wash') { /* Pinpoint is holding its beat */ }
    else {
      if (step >= 2 && kind === 'chip') markRange(chip);
      if (step === 2 && kind === 'chip' && chip === 0) show(3);
      else if (step === 3 && kind === 'chip' && chip === 4) toChoose();
      else requestAnimationFrame(place);
    }
  }

  function skip() { stop(); if (onDone) onDone('skipped'); }

  function stop() {
    clearTimeout(typeT); clearTimeout(swapT);
    seqT.forEach(clearTimeout); seqT = [];
    step = 0; pick = '';
    document.querySelectorAll('.coach-breathe').forEach((e) => e.classList.remove('coach-breathe'));
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = null; focus = null;
    document.querySelectorAll('.coach-hl, .coach-box').forEach((e) => e.classList.remove('coach-hl', 'coach-box'));
    if (veil) { window.removeEventListener('resize', place); const v = veil; veil = null; panels = []; ring = slip = arrow = pips = text = null; arrows = []; v.classList.remove('on'); setTimeout(() => v.remove(), 260); }
  }

  return { start, input, stop, skip, set onDone(fn) { onDone = fn; }, get active() { return step > 0; }, get paused() { return step > 0; } };
})();
