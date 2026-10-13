/* ==========================================================================
   KÁRMÁN · coach.js
   The one guided leg: the first leg of a pilot's first flight (and once more
   for everyone whenever storage.js bumps guideV). A spotlight tutorial; the
   veil covers everything EXCEPT the controls the slip is about, so the
   player just does the thing:

     1 · "Type your best guess."   → a pause in the typing advances
     2 · "Tap Wide."               → only Wide advances; the range swells
     3 · "Now tap Pinpoint."       → only Pinpoint advances; the range shrinks
     4 · "Your call."              → any width, then Lock ends the guide
   Players used to tap the pre-selected width and never look at the others
   (Oct 2026), so steps 2 and 3 make them feel both ends of the trade before
   choosing. Each slip quotes their own range and climb, in their units.
   The lit area only ever grows, so a player can keep typing throughout.

   No Next button. "Skip guide" on each slip ends it and starts the clock.
   The veil is four panels around a hole, so the lit control is live.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  let step = 0;
  let veil = null, panels = [], ring = null, slip = null, arrow = null, lit = null, focus = null;
  let onDone = null;

  // The lit area grows rather than moves: the guess stays live (keep typing,
  // fix a digit) while the width row, then Lock, join it. The ring marks the
  // control the slip is about.
  const entry = () => (coarse() ? [$('readout'), $('keypad')] : [$('readout')]);
  const chipEl = (i) => document.querySelectorAll('#wbtns .wbtn')[i];
  const S = () => K.scoring;
  const climb = (i) => K.units.climbText(S().kmOf(S().legPoints(i)));
  const rangeNow = () => `${$('r-lo').textContent}–${$('r-hi').textContent}`;
  let seen = { wide: '', pin: '' };     // the ranges the player saw, quoted back on the next slip
  const STEPS = {
    1: { at: () => entry(), focus: () => (coarse() ? $('keypad') : $('readout')), title: () => 'Type your best guess.', body: () => 'No clock on this first one.' },
    2: { at: () => [...entry(), $('wbtns')], focus: () => chipEl(0), arrowAt: () => chipEl(0),
      title: () => 'Now, how sure are you? Tap Wide.', body: () => 'Watch the range around your guess.' },
    3: { at: () => [...entry(), $('wbtns')], focus: () => chipEl(4), arrowAt: () => chipEl(4),
      title: () => 'Now tap Pinpoint.', body: () => `Wide covers ${seen.wide}. Safe, but only ${climb(0)}.` },
    4: { at: () => [...entry(), $('wbtns'), $('btn-lock')], focus: () => $('wbtns'),
      title: () => 'Your call. Pick a width, lock it in.', body: () => `Pinpoint is just ${seen.pin}: ${climb(4)} if you're right, nothing if you're not.` },
  };
  const LAST = 4;

  /* ---------------------------------------------------------- layout */
  const R = (el) => el.getBoundingClientRect();

  function place() {
    if (!slip || !lit || !lit.length) return;
    const rs = lit.map(R), pad = 6, W = window.innerWidth, H = window.innerHeight;
    const r = { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) };
    r.width = r.right - r.left;
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
    // the slip sits above the card (over the sky), never on the keys
    const dock = $('dock');
    const dockTop = dock ? R(dock).top : H * 0.55;
    const w = Math.min(320, W - 32);
    slip.style.width = `${w}px`;
    const cx = f.left + (f.right - f.left) / 2;
    const x = Math.max(16, Math.min(W - w - 16, cx - w / 2));
    const h = slip.offsetHeight;
    let y = dockTop - h - 16;
    if (y < 12) y = Math.max(12, r.top - h - 14);
    slip.style.left = `${x}px`;
    slip.style.top = `${y}px`;
    slip.style.setProperty('--arrow-x', `${Math.max(22, Math.min(w - 22, cx - x))}px`);
    // the bouncing arrow over Wide
    const s = STEPS[step];
    const target = s && s.arrowAt ? s.arrowAt() : null;
    if (arrow && target) {
      const a = R(target);
      arrow.hidden = false;
      arrow.style.left = `${a.left + a.width / 2}px`;
      arrow.style.top = `${a.top - 8}px`;
    } else if (arrow) arrow.hidden = true;
  }

  /* ---------------------------------------------------------- dom */
  function ensureDom() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'coach-veil';
    panels = ['top', 'left', 'right', 'bottom'].map((k) => { const d = document.createElement('div'); d.className = `coach-panel coach-${k}`; veil.appendChild(d); return d; });
    ring = document.createElement('div'); ring.className = 'coach-ring'; veil.appendChild(ring);
    arrow = document.createElement('div'); arrow.className = 'coach-arrow'; arrow.hidden = true;
    arrow.innerHTML = '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 2v22M4 16l8 10 8-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    veil.appendChild(arrow);
    slip = document.createElement('div');
    slip.className = 'coach-slip';
    slip.setAttribute('role', 'status');
    veil.appendChild(slip);
    document.body.appendChild(veil);
    // the panels swallow taps so nothing else moves while a slip is up
    panels.forEach((p) => ['pointerdown', 'click', 'touchstart'].forEach((ev) => p.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false })));
    window.addEventListener('resize', place);
  }

  function show(n) {
    ensureDom();
    step = n;
    const s = STEPS[n];
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = s.at().filter(Boolean);
    focus = s.focus ? s.focus() : null;
    lit.forEach((e) => e.classList.add('coach-lit'));
    slip.innerHTML = `<span class="coach-step">${n} / ${LAST}</span><p class="coach-title">${s.title()}</p><p class="coach-body">${s.body()}</p><button type="button" class="coach-skip">Skip guide</button>`;
    slip.querySelector('.coach-skip').addEventListener('click', skip);
    veil.classList.add('on');
    slip.classList.remove('in'); void slip.offsetWidth; slip.classList.add('in');
    requestAnimationFrame(place);
  }

  /* ---------------------------------------------------------- hooks */
  function start() { seen = { wide: '', pin: '' }; show(1); }

  /** round.js reports keypad / width changes through game.js. */
  // Step 1 waits for a pause in the typing (not the first digit), so a full
  // number goes in before the slip changes; the keypad stays live either way.
  let typeT = 0;
  function input(entry, chip, kind) {
    if (!step) return;
    clearTimeout(typeT);
    if (step === 1 && entry) typeT = setTimeout(() => { if (step === 1) show(2); }, 1100);
    else if (step === 2 && kind === 'chip' && chip === 0) { seen.wide = rangeNow(); show(3); }
    else if (step === 3 && kind === 'chip' && chip === 4) { seen.pin = rangeNow(); show(4); }
    else requestAnimationFrame(place);
  }

  function skip() { stop(); if (onDone) onDone('skipped'); }

  function stop() {
    clearTimeout(typeT);
    step = 0;
    if (lit) lit.forEach((e) => e && e.classList.remove('coach-lit'));
    lit = null; focus = null;
    if (veil) { window.removeEventListener('resize', place); const v = veil; veil = null; panels = []; ring = slip = arrow = null; v.classList.remove('on'); setTimeout(() => v.remove(), 220); }
  }

  return { start, input, stop, skip, set onDone(fn) { onDone = fn; }, get active() { return step > 0; }, get paused() { return step > 0; } };
})();
