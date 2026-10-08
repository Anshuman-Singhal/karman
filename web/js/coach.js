/* ==========================================================================
   KÁRMÁN · coach.js
   One guided leg, once ever: the first leg of a pilot's first flight is
   untimed and three small paper slips walk through it:
     1. type a guess  →  2. pick how sure you are  →  3. lock it in
   Never shown again (store.tutored), never shown to existing pilots.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  let step = 0, slip = null, target = null, startChip = null;

  const STEPS = {
    1: { at: () => (matchMedia('(pointer: coarse)').matches ? $('keypad') : $('readout')),
         text: '<b>Type your best guess.</b> No rush on this one.' },
    2: { at: () => $('wbtns'), below: () => matchMedia('(pointer: coarse)').matches,   // phones: don't cover the guess
         text: '<b>Now pick how sure you are.</b> Wide is safe. Pinpoint pays the most.' },
    3: { at: () => $('btn-lock'),
         text: '<b>Lock it in.</b> From the next leg, the 30-second clock is on.' },
  };

  function place() {
    if (!slip || !target) return;
    const r = target.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 32);
    slip.style.width = `${w}px`;
    const x = Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2));
    const below = STEPS[step] && STEPS[step].below && STEPS[step].below();
    slip.classList.toggle('below', Boolean(below));
    const y = below ? r.bottom + 14 : r.top - slip.offsetHeight - 14;
    slip.style.left = `${x}px`;
    slip.style.top = `${Math.max(12, y)}px`;
    slip.style.setProperty('--arrow-x', `${Math.max(18, Math.min(w - 18, r.left + r.width / 2 - x))}px`);
  }

  function show(n) {
    step = n;
    if (target) target.classList.remove('coach-target');
    const s = STEPS[n];
    target = s.at();
    if (!slip) {
      slip = document.createElement('div');
      slip.className = 'coach-slip';
      slip.setAttribute('role', 'status');
      document.body.appendChild(slip);
    }
    slip.innerHTML = `<span class="coach-step">${n}/3</span><span>${s.text}</span>`;
    slip.classList.remove('in'); void slip.offsetWidth; slip.classList.add('in');
    if (target) target.classList.add('coach-target');
    requestAnimationFrame(place);
  }

  function start(chip) {
    startChip = chip;
    show(1);
    window.addEventListener('resize', place);
  }

  /** Called on every keypad / width change during the guided leg. */
  function input(entry, chip) {
    if (!step) return;
    if (step === 1 && entry) show(2);
    else if (step === 2 && chip !== startChip) show(3);
    else if (step === 3) requestAnimationFrame(place);
  }

  function stop() {
    if (!step) return;
    step = 0;
    if (target) target.classList.remove('coach-target');
    target = null;
    if (slip) { slip.classList.remove('in'); const s = slip; slip = null; setTimeout(() => s.remove(), 250); }
    window.removeEventListener('resize', place);
  }

  return { start, input, stop, get active() { return step > 0; } };
})();
