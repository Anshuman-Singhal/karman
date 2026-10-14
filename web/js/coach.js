/* ==========================================================================
   KÁRMÁN · coach.js
   The one guided leg: the first leg of a pilot's first flight (and once more
   for everyone whenever storage.js bumps guideV). Two slips, nothing dimmed,
   and the controls themselves do the explaining:

     1 · "Type your best guess."   The card is fully readable; the width row
         is on it but unprinted (a blank strip, not tappable), so there is
         one thing to do. The dial shows a pause glyph. A pause in the typing
         advances.
     2 · "How sure are you?"       The width row prints in, each box showing
         the real range it gives the typed guess and its climb; no box is
         chosen. The ring moves onto the row. A tap fills the box, runs the
         highlighter under the range numbers, and the slip's line becomes the
         live sentence that states both outcomes in plain words:
         "If it's between 33 and 75 meters, you climb +10 km. If not, nothing."
         The ring glides to Lock; locking ends the guide.

   No veil: the Oct 2026 tests found the dimmed question was the one thing
   players never read. No prescribed taps either: every tap shows its own
   consequence, which is what teaches. One slip per step, few words.

   No Next button. "Skip" on the slip ends it and starts the clock.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  const reduced = () => (K.fx && K.fx.reduced ? K.fx.reduced() : matchMedia('(prefers-reduced-motion: reduce)').matches);
  let step = 0;
  let veil = null, ring = null, slip = null, lit = null, focus = null;
  let pips = null, text = null, swapT = 0, typeT = 0, ro = null;
  let chosen = null;           // step 2: the width tapped so far (null until the first tap)
  let onDone = null;
  const S = () => K.scoring;
  const LAST = 2;

  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const entry = () => (coarse() ? $('keypad') : $('readout'));

  /** The live sentence for a tapped width: both outcomes, in the player's units.
      It sits ON the card, right above the guess and its range (where the eye
      already is), not in the slip. */
  function outcome(chip) {
    const rs = K.round.ranges();
    if (!rs || chip == null) return '';
    const r = rs[chip];
    return `If it's <b>${esc(r.words)}</b>, you climb <b>${esc(r.climb)}</b>. If not, nothing.`;
  }
  function say(chip) {
    const hint = $('round-hint');
    if (!hint) return;
    let el = $('coach-say');
    if (chip == null) { if (el) el.remove(); hint.classList.remove('coach-said'); return; }
    if (!el) {
      // It takes the place of the "For scale" hint (already used: the guess is
      // typed), which is the line right above the guess and its range.
      el = document.createElement('p');
      el.id = 'coach-say';
      el.className = 'coach-say';
      el.setAttribute('role', 'status');
      hint.after(el);
      hint.classList.add('coach-said');
    }
    el.style.setProperty('--c', `var(--c-${S().CHIPS[chip].key})`);
    el.innerHTML = outcome(chip);
  }

  const STEPS = {
    1: { lit: () => [entry()], focus: () => entry(), tone: 'amber',
      title: () => 'Type your best guess.', body: () => '<p>No time limit on this one. After this, 30 seconds each.</p>' },
    2: { lit: () => [$('wbtns'), $('btn-lock')], focus: () => (chosen != null ? $('btn-lock') : $('wbtns')), tone: () => (chosen != null ? S().CHIPS[chosen].key : 'amber'),
      title: () => 'How sure are you? Tap a box.',
      body: () => (chosen != null ? '' : '<p>If the answer\u2019s in your box, you climb. If not, nothing.</p>') },
  };

  /* ---------------------------------------------------------------- layout */
  const R = (el) => el.getBoundingClientRect();

  function place() {
    if (!slip || !focus) return;
    const pad = 6, W = window.innerWidth, H = window.innerHeight;
    const f = R(focus);
    Object.assign(ring.style, { left: `${f.left - pad}px`, top: `${f.top - pad}px`, width: `${f.width + pad * 2}px`, height: `${f.height + pad * 2}px` });
    // The slip hangs above the card (over the sky), centred on it and anchored
    // at its foot, so it only ever grows upward and never covers the question.
    const dock = $('dock');
    const d = dock ? R(dock) : { left: 0, width: W, top: H * 0.55 };
    const w = Math.min(336, W - 32);
    const x = Math.max(16, Math.min(W - w - 16, d.left + d.width / 2 - w / 2));
    slip.style.width = `${w}px`;
    slip.style.left = `${x}px`;
    slip.style.bottom = `${Math.max(12, H - d.top + 14)}px`;
  }

  /* ---------------------------------------------------------------- dom */
  function ensureDom() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'coach-veil';
    ring = document.createElement('div'); ring.className = 'coach-ring'; veil.appendChild(ring);
    slip = document.createElement('div');
    slip.className = 'coach-slip';
    slip.setAttribute('role', 'status');
    slip.innerHTML = `<div class="coach-head"><span class="coach-pips" aria-hidden="true">${'<i></i>'.repeat(LAST)}</span><button type="button" class="coach-skip">Skip</button></div><div class="coach-text"><p class="coach-title"></p><div class="coach-body"></div></div>`;
    pips = [...slip.querySelectorAll('.coach-pips i')];
    text = slip.querySelector('.coach-text');
    slip.querySelector('.coach-skip').addEventListener('click', skip);
    veil.appendChild(slip);
    document.body.appendChild(veil);
    window.addEventListener('resize', place);
    // the card changes height (a clue, a longer sentence): the slip and ring follow
    if (window.ResizeObserver) { ro = new ResizeObserver(() => place()); const d = $('dock'); if (d) ro.observe(d); }
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

  function tone(s) { return typeof s.tone === 'function' ? s.tone() : s.tone; }

  function show(n) {
    const first = !veil;
    ensureDom();
    step = n;
    const s = STEPS[n];
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = s.lit().filter(Boolean);
    focus = s.focus();
    lit.forEach((e) => e.classList.add('coach-lit'));
    veil.dataset.tone = tone(s);
    slip.dataset.step = String(n);
    pips.forEach((p, i) => { p.classList.toggle('done', i < n - 1); p.classList.toggle('now', i === n - 1); });
    setText(s, first);
    place();
    if (first) { void veil.offsetWidth; veil.classList.add('on'); }   // lay out first, so nothing glides in from nowhere
    requestAnimationFrame(place);
  }

  /** The width row: unprinted in step 1, printed in (left to right) for step 2. */
  function blank(on) {
    const w = $('wbtns');
    if (!w) return;
    if (on) { w.classList.add('coach-blank'); w.classList.remove('coach-print'); return; }
    if (!w.classList.contains('coach-blank')) return;
    w.classList.remove('coach-blank');
    if (!reduced()) { void w.offsetWidth; w.classList.add('coach-print'); setTimeout(() => w.classList.remove('coach-print'), 1400); }
  }

  /** A highlighter stroke under the range numbers in the width's colour, then it fades. */
  function markRange(chip) {
    if (reduced()) return;
    document.querySelectorAll('#readout .r-num').forEach((e) => {
      e.classList.remove('coach-hl');
      e.style.setProperty('--hl', `var(--hl-${S().CHIPS[chip].key})`);
      void e.offsetWidth;
      e.classList.add('coach-hl');
    });
  }

  /* ---------------------------------------------------------------- hooks */
  /** game.js hands over what is already on the card (a reload mid-guide). */
  function start(saved = {}) {
    chosen = saved.chip != null ? saved.chip : null;
    if (saved.entry) { blank(false); show(2); }
    else { blank(true); show(1); }
  }

  /** round.js reports keypad / width changes through game.js. */
  function input(entry, chip, kind) {
    if (!step) return;
    clearTimeout(typeT);
    if (step === 1) {
      if (kind === 'chip' && chip != null) { K.round.clearChip(); return; }   // (keyboard arrows) the row is not printed yet
      // Wait for a pause in the typing (not the first digit), so a whole number
      // goes in before the row prints; the keypad stays live either way.
      if (entry) typeT = setTimeout(() => { if (step === 1) { blank(false); show(2); } }, 1100);
      return;
    }
    if (kind === 'chip' && chip != null) {
      const firstPick = chosen == null;
      chosen = chip;
      markRange(chip);
      const s = STEPS[2];
      veil.dataset.tone = tone(s);
      focus = s.focus();
      if (firstPick) setText(s);
      say(chip);
      place();
      return;
    }
    // more digits: the ranges on the card change; the sentence follows
    if (chosen != null) say(chosen);
    requestAnimationFrame(place);
  }

  function skip() { stop(); if (onDone) onDone('skipped'); }

  function stop() {
    clearTimeout(typeT); clearTimeout(swapT);
    step = 0; chosen = null;
    say(null);
    blank(false);
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = null; focus = null;
    document.querySelectorAll('.coach-hl').forEach((e) => e.classList.remove('coach-hl'));
    if (ro) { ro.disconnect(); ro = null; }
    if (veil) { window.removeEventListener('resize', place); const v = veil; veil = null; ring = slip = pips = text = null; v.classList.remove('on'); setTimeout(() => v.remove(), 260); }
  }

  return { start, input, stop, skip, set onDone(fn) { onDone = fn; }, get active() { return step > 0; }, get paused() { return step > 0; } };
})();
