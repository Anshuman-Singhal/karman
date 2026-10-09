/* ==========================================================================
   KÁRMÁN · coach.js
   The guided first leg, once per pilot. Three paper slips you tap through,
   each spotlighting one control while everything else is dimmed and frozen:
     1. the keypad       "Type your best guess"
     2. the width switch "Pick how sure you are" (we demo Wide → Pinpoint live)
     3. Lock it in       "Lock it in"
   Then the leg is yours, untimed. Skip is one tap away on every slip. The
   clock only starts on leg 2.
   ========================================================================== */

K.coach = (() => {
  const $ = (id) => document.getElementById(id);
  let step = 0, shield = null, spot = null, slip = null, target = null, demoTimer = 0, chip0 = 2;
  const phone = () => matchMedia('(pointer: coarse)').matches;

  const STEPS = [
    { at: () => (phone() ? $('keypad') : $('readout')),
      text: '<b>Type your best guess.</b> Every answer is a number.' },
    { at: () => $('wbtns'),
      text: '<b>Then pick how sure you are.</b> Wide is a safe bet for a little lift. Pinpoint pays the most.', demo: true },
    { at: () => $('btn-lock'),
      text: '<b>Lock it in.</b> This first leg has no clock. From the next one, you get 30 seconds.' },
  ];

  function build() {
    shield = document.createElement('div');
    shield.className = 'coach-shield';
    shield.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    spot = document.createElement('div');
    spot.className = 'coach-spot';
    slip = document.createElement('div');
    slip.className = 'coach-slip';
    slip.setAttribute('role', 'dialog');
    slip.setAttribute('aria-live', 'polite');
    document.body.append(shield, spot, slip);
  }

  function place() {
    if (!slip || !target) return;
    const r = target.getBoundingClientRect();
    const pad = 8;
    spot.style.left = `${r.left - pad}px`;
    spot.style.top = `${r.top - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;
    const w = Math.min(320, window.innerWidth - 32);
    slip.style.width = `${w}px`;
    const x = Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2));
    const h = slip.offsetHeight;
    const above = r.top - h - 18;
    const below = above >= 12 ? false : true;        // slips sit above their control unless there's no room
    slip.classList.toggle('below', below);
    slip.style.left = `${x}px`;
    slip.style.top = `${below ? r.bottom + 18 : above}px`;
    slip.style.setProperty('--arrow-x', `${Math.max(18, Math.min(w - 18, r.left + r.width / 2 - x))}px`);
  }

  function show(i) {
    step = i + 1;
    const s = STEPS[i];
    target = s.at();
    const last = i === STEPS.length - 1;
    slip.innerHTML = `<span class="coach-step">${i + 1}/${STEPS.length}</span><span class="coach-text">${s.text}</span>` +
      `<span class="coach-btns"><button type="button" class="coach-skip">Skip</button><button type="button" class="coach-next">${last ? 'Got it' : 'Next'}</button></span>`;
    slip.querySelector('.coach-next').addEventListener('click', () => (last ? stop(true) : show(i + 1)));
    slip.querySelector('.coach-skip').addEventListener('click', () => stop(true));
    slip.classList.remove('in'); void slip.offsetWidth; slip.classList.add('in');
    clearTimeout(demoTimer);
    if (s.demo) demo();
    requestAnimationFrame(place);
    setTimeout(() => slip.querySelector('.coach-next').focus({ preventScroll: true }), 50);
  }

  /** Step 2: walk the switch Wide → Pinpoint so the range visibly stretches and shrinks. */
  function demo() {
    const order = [0, 1, 2, 3, 4, chip0];
    let k = 0;
    const tick = () => {
      if (step !== 2) return;
      K.round.selectChip(order[k]);
      k += 1;
      if (k < order.length) demoTimer = setTimeout(tick, 650);
    };
    demoTimer = setTimeout(tick, 500);
  }

  function start(chip) {
    chip0 = chip;
    if (!shield) build();
    shield.classList.add('on');
    spot.classList.add('on');
    window.addEventListener('resize', place);
    show(0);
  }

  /** Legacy hook (round.js still calls it); the slips no longer react to input. */
  function input() {}

  function stop(byPilot) {
    if (!step) return;
    step = 0;
    clearTimeout(demoTimer);
    K.round.selectChip(chip0);
    window.removeEventListener('resize', place);
    [shield, spot, slip].forEach((el) => el && el.classList.remove('on', 'in'));
    setTimeout(() => { [shield, spot, slip].forEach((el) => el && el.remove()); shield = spot = slip = null; }, 260);
    if (byPilot) K.fx.toast('Your turn. No clock on this one.');
  }

  return { start, input, stop, get active() { return step > 0; } };
})();
