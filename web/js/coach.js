/* ==========================================================================
   KÁRMÁN · coach.js
   The one guided leg: the first leg of a pilot's first flight (once ever).
   A spotlight tutorial in three short slips. While a slip is up the game is
   paused under a veil: nothing behind it can be tapped, the control the slip
   is about sits in a lit cut-out, and the slip waits for Next (or Skip).
   Between slips the lit control pulses until it's used.

     1 · "Type your best guess"      → Next → keypad / readout lit → type a digit
     2 · "Pick how sure you are"      → Next → width switch lit    → tap any width
     3 · "Lock it in"                 → Next → Lock lit            → lock

   The leg has no clock. game.js owns the untimed flag and calls stop() on lock.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  let step = 0;            // 1..3 while a slip is up, 0 otherwise
  let waiting = 0;         // which step's action we're waiting for after Next
  let veil = null, spot = null, slip = null, lit = null;

  const STEPS = {
    1: {
      at: () => (coarse() ? $('keypad') : $('readout')),
      title: 'Type your best guess.',
      body: 'Every answer is a number. There’s no clock on this first one.',
    },
    2: {
      at: () => $('wbtns'),
      title: 'Now pick how sure you are.',
      body: 'Wide is a huge, safe range for a small climb. Pinpoint is a tiny range for the biggest climb. Narrower pays more.',
      demo: true,
    },
    3: {
      at: () => $('btn-lock'),
      title: 'Lock it in.',
      body: 'From the next leg, you get 30 seconds a question.',
    },
  };

  /* ---------------------------------------------------------- layout */
  function rectOf(el) { return el.getBoundingClientRect(); }

  function place() {
    if (!slip || !lit) return;
    const r = rectOf(lit);
    // Spotlight hole around the control
    spot.style.left = `${r.left - 6}px`;
    spot.style.top = `${r.top - 6}px`;
    spot.style.width = `${r.width + 12}px`;
    spot.style.height = `${r.height + 12}px`;
    // The slip sits above the card (over the sky), never on the keys
    const dock = $('dock');
    const dockTop = dock ? rectOf(dock).top : window.innerHeight * 0.55;
    const w = Math.min(340, window.innerWidth - 32);
    slip.style.width = `${w}px`;
    const cx = r.left + r.width / 2;
    const x = Math.max(16, Math.min(window.innerWidth - w - 16, cx - w / 2));
    const h = slip.offsetHeight;
    let y = dockTop - h - 18;
    if (y < 12) y = Math.max(12, r.top - h - 14);
    slip.style.left = `${x}px`;
    slip.style.top = `${y}px`;
    slip.style.setProperty('--arrow-x', `${Math.max(22, Math.min(w - 22, cx - x))}px`);
  }

  /* ---------------------------------------------------------- slips */
  function ensureDom() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'coach-veil';
    spot = document.createElement('div');
    spot.className = 'coach-spot';
    slip = document.createElement('div');
    slip.className = 'coach-slip';
    slip.setAttribute('role', 'dialog');
    slip.setAttribute('aria-live', 'polite');
    veil.append(spot, slip);
    document.body.appendChild(veil);
    // Taps on the veil never reach the game; the slip's own buttons handle themselves.
    veil.addEventListener('pointerdown', (e) => { if (!slip.contains(e.target)) e.stopPropagation(); }, true);
    veil.addEventListener('click', (e) => { if (!slip.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } }, true);
    window.addEventListener('resize', place);
  }

  function show(n) {
    ensureDom();
    step = n;
    waiting = 0;
    const s = STEPS[n];
    setLit(s.at());
    const demo = s.demo ? `<div class="coach-demo" aria-hidden="true">
        <span class="cd-row"><i class="cd-tag" style="--c:var(--c-wide)">Wide</i><span class="cd-bar"><b style="width:100%"></b></span><em>${K.units.climbText(K.scoring.legKm(0))}</em></span>
        <span class="cd-row"><i class="cd-tag" style="--c:var(--c-snug)">Snug</i><span class="cd-bar"><b style="width:34%"></b></span><em>${K.units.climbText(K.scoring.legKm(2))}</em></span>
        <span class="cd-row"><i class="cd-tag" style="--c:var(--c-pinpoint)">Pinpoint</i><span class="cd-bar"><b style="width:6%"></b></span><em>${K.units.climbText(K.scoring.legKm(4))}</em></span>
      </div>` : '';
    slip.innerHTML = `<span class="coach-step">${n} / 3</span>
      <p class="coach-title">${s.title}</p>
      <p class="coach-body">${s.body}</p>${demo}
      <div class="coach-actions"><button type="button" class="coach-skip">Skip guide</button><button type="button" class="coach-next">${n === 3 ? 'Got it' : 'Next'}</button></div>`;
    slip.querySelector('.coach-next').addEventListener('click', next);
    slip.querySelector('.coach-skip').addEventListener('click', skip);
    veil.classList.add('on');
    slip.classList.remove('in'); void slip.offsetWidth; slip.classList.add('in');
    requestAnimationFrame(() => { place(); slip.querySelector('.coach-next').focus({ preventScroll: true }); });
  }

  function setLit(el) {
    if (lit) lit.classList.remove('coach-lit');
    lit = el;
    if (lit) lit.classList.add('coach-lit');
  }

  /** Next: drop the veil, keep the control lit and pulsing until it's used. */
  function next() {
    waiting = step;
    step = 0;
    veil.classList.remove('on');
    if (lit) lit.classList.add('coach-pulse');
    if (waiting === 3) { /* wait for lock */ }
  }

  function clearLit() {
    if (lit) lit.classList.remove('coach-lit', 'coach-pulse');
    lit = null;
  }

  /* ---------------------------------------------------------- hooks from the game */
  function start() {
    show(1);
  }

  /** round.js reports every keypad / width change through game.js. */
  function input(entry, chip, kind) {
    if (step) return;                                    // a slip is up: ignore (the veil blocks anyway)
    if (waiting === 1 && entry) { clearLit(); show(2); }
    else if (waiting === 2 && kind === 'chip') { clearLit(); show(3); }
  }

  function skip() { stop(); if (onDone) onDone('skipped'); }

  function stop() {
    step = 0; waiting = 0;
    clearLit();
    if (veil) { veil.classList.remove('on'); window.removeEventListener('resize', place); const v = veil; veil = spot = slip = null; setTimeout(() => v.remove(), 240); }
  }

  let onDone = null;
  return { start, input, stop, skip, set onDone(fn) { onDone = fn; }, get active() { return step > 0 || waiting > 0; }, get paused() { return step > 0; } };
})();
