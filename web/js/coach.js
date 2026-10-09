/* ==========================================================================
   KÁRMÁN · coach.js
   The one guided leg: the first leg of a pilot's first flight (once ever).
   A spotlight tutorial with three short slips. The veil covers everything
   EXCEPT the control the slip is about, so the player just does the thing:

     1 · "Type your best guess."     → typing a digit advances
     2 · "Pick how sure you are."    → tapping any width advances (an arrow points at Wide)
     3 · "Lock it in."               → locking ends the guide

   No Next button. "Skip guide" on each slip ends it and starts the clock.
   The veil is four panels around a hole, so the lit control is live.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  let step = 0;
  let veil = null, panels = [], ring = null, slip = null, arrow = null, lit = null;
  let onDone = null;

  const STEPS = {
    1: { at: () => (coarse() ? $('keypad') : $('readout')), title: 'Type your best guess.', body: 'No clock on this first one.' },
    2: { at: () => $('wbtns'), title: 'Pick how sure you are.', body: 'Wider is safer. Narrower climbs more.', arrowAt: () => document.querySelector('#wbtns .wbtn') },
    3: { at: () => $('btn-lock'), title: 'Lock it in.', body: 'From the next leg: 30 seconds a question.' },
  };

  /* ---------------------------------------------------------- layout */
  const R = (el) => el.getBoundingClientRect();

  function place() {
    if (!slip || !lit) return;
    const r = R(lit), pad = 6, W = window.innerWidth, H = window.innerHeight;
    const hole = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    // four blocking panels around the hole
    const [top, left, right, bottom] = panels;
    Object.assign(top.style, { left: 0, top: 0, width: `${W}px`, height: `${Math.max(0, hole.t)}px` });
    Object.assign(bottom.style, { left: 0, top: `${hole.b}px`, width: `${W}px`, height: `${Math.max(0, H - hole.b)}px` });
    Object.assign(left.style, { left: 0, top: `${hole.t}px`, width: `${Math.max(0, hole.l)}px`, height: `${hole.b - hole.t}px` });
    Object.assign(right.style, { left: `${hole.r}px`, top: `${hole.t}px`, width: `${Math.max(0, W - hole.r)}px`, height: `${hole.b - hole.t}px` });
    Object.assign(ring.style, { left: `${hole.l}px`, top: `${hole.t}px`, width: `${hole.r - hole.l}px`, height: `${hole.b - hole.t}px` });
    // the slip sits above the card (over the sky), never on the keys
    const dock = $('dock');
    const dockTop = dock ? R(dock).top : H * 0.55;
    const w = Math.min(320, W - 32);
    slip.style.width = `${w}px`;
    const cx = r.left + r.width / 2;
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
    if (lit) lit.classList.remove('coach-lit');
    lit = s.at();
    if (lit) lit.classList.add('coach-lit');
    slip.innerHTML = `<span class="coach-step">${n} / 3</span><p class="coach-title">${s.title}</p><p class="coach-body">${s.body}</p><button type="button" class="coach-skip">Skip guide</button>`;
    slip.querySelector('.coach-skip').addEventListener('click', skip);
    veil.classList.add('on');
    slip.classList.remove('in'); void slip.offsetWidth; slip.classList.add('in');
    requestAnimationFrame(place);
  }

  /* ---------------------------------------------------------- hooks */
  function start() { show(1); }

  /** round.js reports keypad / width changes through game.js. */
  function input(entry, chip, kind) {
    if (!step) return;
    if (step === 1 && entry) show(2);
    else if (step === 2 && kind === 'chip') show(3);
    else requestAnimationFrame(place);
  }

  function skip() { stop(); if (onDone) onDone('skipped'); }

  function stop() {
    step = 0;
    if (lit) lit.classList.remove('coach-lit');
    lit = null;
    if (veil) { window.removeEventListener('resize', place); const v = veil; veil = null; panels = []; ring = slip = arrow = null; v.classList.remove('on'); setTimeout(() => v.remove(), 220); }
  }

  return { start, input, stop, skip, set onDone(fn) { onDone = fn; }, get active() { return step > 0; }, get paused() { return step > 0; } };
})();
