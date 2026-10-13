/* ==========================================================================
   KÁRMÁN · round.js
   The round card, kept deliberately lean so the sky stays the star:

     header   progress pips · LEG 2 · MACHINES · (timer only in the last 10 s) · Clue
     question + one scale hint
     readout  1,886 ⟵ 1,896 ⟶ 1,906   your scoring range, big and plain
     width    five buttons, Wide … Pinpoint, each showing what it pays
     keypad   5 × 3 with a decimal point, Lock built into the bottom row

   At the reveal, the ruler (drawn around your own guess, so it never hints)
   slides in where the controls were, and the needle drops onto the answer.

   It owns no game rules: it reports changes to game.js through callbacks and
   plays animations when asked. Typed values are in the player's units
   (units.js); the value handed to game.js for scoring is always metric.
   ========================================================================== */

K.round = (() => {
  const S = K.scoring;
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const MAX_DIGITS = 9;

  let els;
  let fact = null;
  let view = null;          // units.view(fact)
  let lastResult = null;    // showResult args, to redraw it if the units flip
  let reveal = { guess: null, chip: 0 };   // what the ruler shows after the lock
  let state = { entry: '', chip: 2 };
  let ctx = { clueUsed: false, clueHere: false, onClue: null };
  let locked = false;
  let onChange = () => {};
  let ruler = null;
  let clueArmTimer = 0;
  let lastSec = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------ setup */
  function init() {
    els = {
      card: $('screen-round'), timerLive: $('timer-live'), legs: $('legs'), cat: $('round-cat'),
      timer: $('round-timer'), clue: $('btn-clue'), q: $('round-q'), hint: $('round-hint'),
      lo: $('r-lo'), hi: $('r-hi'), guess: $('guess-value'), unitBtn: $('unit-toggle'),
      ticks: $('scale-ticks'), track: $('track'), band: $('band'), needle: $('needle'),
      wbtns: $('wbtns'),
      pad: $('keypad'), controls: $('round-controls'), result: $('round-result'),
    };

    // Width buttons: one tap picks how sure you are.
    els.wbtnEls = S.CHIPS.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wbtn';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--c', `var(--c-${c.key})`);
      b.innerHTML = `<span>${c.name}</span><b></b>`;
      b.addEventListener('click', () => selectChip(i));
      els.wbtns.appendChild(b);
      return b;
    });

    // Keypad, 5 columns: 1 2 3 4 5 / 6 7 8 9 0 / . ⌫ [Lock it in]
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', 'del'].forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `key${k === 'del' ? ' key-del' : ''}${k === '.' ? ' key-dot' : ''}`;
      b.dataset.k = k;
      b.setAttribute('aria-label', k === 'del' ? 'Delete' : k === '.' ? 'Decimal point' : k);
      b.innerHTML = k === 'del'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="m12 9 5 6M17 9l-5 6"/></svg>'
        : k;
      b.addEventListener('click', () => press(b.dataset.k, b));
      els.pad.appendChild(b);
    });
    const lock = document.createElement('button');
    lock.type = 'button';
    lock.id = 'btn-lock';
    lock.className = 'btn-primary key-lock';
    lock.innerHTML = '<span class="kl-main">Lock it in</span><span class="kl-stub"></span>';
    els.pad.appendChild(lock);
    els.lock = lock;
    els.lockMain = lock.querySelector('.kl-main');
    els.lockStub = lock.querySelector('.kl-stub');
    els.timerNum = els.timer.querySelector('b');

    els.unitBtn.addEventListener('click', toggleUnits);
    els.clue.addEventListener('click', clueTap);
  }

  /* ------------------------------------------------------------ render */
  function render(opts) {
    fact = opts.fact;
    view = K.units.view(fact);
    ctx = {
      clueUsed: Boolean(opts.clueUsed), clueHere: Boolean(opts.clueHere), clueLeg: opts.clueLeg, onClue: opts.onClue,
    };
    onChange = opts.onChange;
    locked = false;

    els.card.classList.remove('is-locked', 'is-revealed', 't-mid', 't-low', 'clued', 'show-ruler');
    els.band.className = 'band';
    els.needle.hidden = true;
    els.needle.className = 'needle';
    els.result.hidden = true;
    els.controls.hidden = false;
    els.pad.classList.toggle('years', fact.scale === 'year');
    els.card.style.setProperty('--left', '1');
    lastSec = K.CONFIG.ROUND_SECONDS;
    els.timerNum.textContent = String(lastSec);
    els.timer.setAttribute('aria-label', `${lastSec} seconds left`);

    els.cat.innerHTML = '';
    [['leg-no', `Leg ${opts.index + 1}`], ['leg-of', `/ ${K.CONFIG.LEGS}`], ['leg-cat', fact.cat]]
      .forEach(([c, t]) => { const s = document.createElement('span'); s.className = c; s.textContent = t; els.cat.appendChild(s); });
    els.cat.setAttribute('aria-label', `Leg ${opts.index + 1} of ${K.CONFIG.LEGS}, ${fact.cat}`);
    els.q.textContent = K.units.hint(fact.q);
    lastResult = null;
    reveal = { guess: null, chip: 0 };
    renderHint();
    renderClue();
    renderUnit();
    renderLegs(opts.index, opts.rounds);

    state = { entry: opts.entry || '', chip: opts.chip };
    update(true);

    els.card.classList.remove('enter');
    void els.card.offsetWidth;
    els.card.classList.add('enter');
  }

  function renderHint() {
    els.hint.classList.remove('is-clue', 'is-cost');
    if (ctx.clueHere) {
      // The clue is a second, closer benchmark (a real fact), shown under the scale hint.
      const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const clueText = K.units.hint(K.CLUES && K.CLUES[fact.id]) || '';
      els.hint.innerHTML = `<span class="hint-scale">${esc(K.units.hint(K.HINTS && K.HINTS[fact.id]))}</span><span class="hint-clue"><b>Closer</b>${esc(clueText)}</span>`;
      els.hint.classList.add('is-clue');
      els.card.classList.add('clued');
    } else {
      els.hint.textContent = K.units.hint(K.HINTS && K.HINTS[fact.id]);
    }
  }

  /** Clue tag: one per flight, needs a confirming second tap. data-state: ready | armed | on | spent */
  function renderClue() {
    const c = els.clue;
    clearTimeout(clueArmTimer);
    c.hidden = false;
    const st = ctx.clueHere ? 'on' : ctx.clueUsed ? 'spent' : 'ready';
    const leg = ctx.clueLeg != null ? ctx.clueLeg + 1 : '';
    c.dataset.state = st;
    c.disabled = st === 'spent';
    c.innerHTML = {
      ready: '<span class="ct-main">Clue</span><span class="ct-stub">½<small>climb</small></span>',
      on: '<span class="ct-main">Clue on</span>',
      spent: `<span class="ct-main">Used on leg ${leg}</span>`,
    }[st];
    c.setAttribute('aria-label', {
      ready: 'Use your one clue for this flight. This leg climbs half as far',
      on: 'Clue on. This leg climbs half as far',
      spent: `Clue already used on leg ${leg}`,
    }[st]);
  }

  function clueTap() {
    if (locked || ctx.clueUsed || ctx.clueHere) return;
    const c = els.clue;
    if (c.dataset.state !== 'armed') {
      c.dataset.state = 'armed';
      c.innerHTML = '<span class="ct-main">Confirm</span><span class="ct-stub">½<small>climb</small></span>';
      c.setAttribute('aria-label', 'Tap again to use your clue. This leg pays half');
      els.hint.classList.remove('is-clue');
      els.hint.classList.add('is-cost');
      els.hint.textContent = 'Tap again to use it. This leg pays half.';
      return;
    }
    clearTimeout(clueArmTimer);
    ctx.clueUsed = true;
    ctx.clueHere = true;
    renderClue();
    els.hint.classList.add('swap');
    setTimeout(() => { renderHint(); els.hint.classList.remove('swap'); update(); }, 180);
    K.fx.haptic(10);
    if (ctx.onClue) ctx.onClue();
  }

  function renderUnit() {
    els.unitBtn.hidden = !view.unit;
    els.unitBtn.disabled = !view.convertible;
    els.unitBtn.classList.toggle('swap', view.convertible);
    els.unitBtn.querySelector('span').textContent = view.unit;
    els.unitBtn.setAttribute('aria-label', view.convertible ? `Unit: ${view.unit}. Switch units` : `Unit: ${view.unit}`);
  }

  function renderLegs(index, rounds) {
    els.legs.innerHTML = '';
    for (let i = 0; i < K.CONFIG.LEGS; i++) {
      const li = document.createElement('li');
      const r = rounds[i];
      li.className = 'leg';
      if (r) {
        li.classList.add(r.hit ? 'leg-hit' : 'leg-miss');
        li.style.setProperty('--c', r.hit ? `var(--c-${S.CHIPS[r.chip].key})` : 'var(--c-miss)');
      } else if (i === index) li.classList.add('leg-now');
      if (r && i === index - 1) li.classList.add('leg-prev');
      li.setAttribute('aria-label', `Leg ${i + 1}${r ? (r.hit ? ', hit' : ', miss') : i === index ? ', now' : ''}`);
      els.legs.appendChild(li);
    }
  }

  /* ------------------------------------------------------------ input */
  function press(k, btn) {
    if (!fact || locked) return;   // no question on the card yet (take-off), or already locked
    if (locked) return;
    if (btn) {
      btn.classList.remove('tap');
      void btn.offsetWidth;
      btn.classList.add('tap');
    }
    let e = state.entry;
    if (k === 'del') e = e.slice(0, -1);
    else if (k === '.') {
      if (fact.scale === 'year' || e.includes('.') || e.length >= MAX_DIGITS) return shake();
      e = (e || '0') + '.';
    } else {
      if (e.includes('.') && e.split('.')[1].length >= 3) return shake();   // 3 decimals is plenty
      if (e.length >= MAX_DIGITS) return shake();
      if (e === '0') e = '';
      e += k;
    }
    state.entry = e;
    K.fx.haptic(5);
    if (k !== 'del') { K.scene.flare(0.55); K.audio.tick(); }
    els.guess.classList.remove('roll');
    void els.guess.offsetWidth;
    els.guess.classList.add('roll');
    update();
    onChange(state.entry, state.chip);
  }

  function shake() {
    els.guess.classList.remove('nope');
    void els.guess.offsetWidth;
    els.guess.classList.add('nope');
  }

  /** Physical keyboard (desktop). Returns true if handled. */
  function key(e) {
    if (locked) return false;
    if (/^[0-9]$/.test(e.key)) { press(e.key); return true; }
    if (e.key === '.' || e.key === ',') { press('.'); return true; }
    if (e.key === 'Backspace') { press('del'); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { selectChip(state.chip == null ? 0 : Math.max(0, state.chip - 1)); return true; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { selectChip(state.chip == null ? 4 : Math.min(4, state.chip + 1)); return true; }
    return false;
  }

  /** The guide's last step: no width selected, so the player has to choose one. */
  function clearChip() {
    if (!fact || locked) return;
    state.chip = null;
    update();
    onChange(state.entry, null, 'clear');
  }

  function selectChip(i) {
    if (!fact || locked) return;
    // Re-tapping the lit width still counts as a choice for the guide.
    if (i === state.chip) { if (K.coach && K.coach.active) onChange(state.entry, state.chip, 'chip'); return; }
    state.chip = i;
    K.scene.setChip(i);
    K.fx.haptic(8);
    const b = els.wbtnEls[i];
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    update();
    onChange(state.entry, state.chip, 'chip');
  }

  /** Switch metric ⇄ imperial, converting whatever has been typed. */
  function toggleUnits() { setUnits(K.units.system() === 'imperial' ? 'metric' : 'imperial'); }
  /** Menu switch + inline toggle. Everything on the card that carries a unit
      re-renders in place: the typed guess (converted), the range edges, the
      width chips and lock stub (km ⇄ mi), the hint, clue and question text,
      and, after the reveal, the ruler, needle and result lines. */
  function setUnits(sys) {
    K.units.setSystem(sys);
    if (!fact) return;
    const old = view;
    view = K.units.view(fact);
    els.q.textContent = K.units.hint(fact.q);
    renderUnit();
    renderHint();
    if (!locked) {
      const typed = typedValue();
      if (typed != null && fact.scale !== 'year' && old.convertible) state.entry = String(Number(view.toDisp(old.toMetric(typed)).toPrecision(4)));
      if (view.convertible) {
        els.unitBtn.classList.remove('flip');
        void els.unitBtn.offsetWidth;
        els.unitBtn.classList.add('flip');
      }
      update();
      onChange(state.entry, state.chip);
      return;
    }
    if (els.card.classList.contains('show-ruler')) {
      if (reveal.guess != null) layoutRuler(reveal.guess, reveal.chip);
      else { ruler = makeRuler(fact.scale === 'year' ? fact.answer : view.toDisp(fact.answer)); drawTicks(ruler); }
      placeNeedle();
    }
    if (lastResult && !els.result.hidden) showResult(lastResult);
  }

  /** Show typed digits with thousands separators, keeping a trailing "." or decimals. */
  function showEntry(e) {
    const [int, dec] = e.split('.');
    const head = Number(int || '0').toLocaleString('en-US');
    return dec == null ? head : `${head}.${dec}`;
  }

  function typedValue() {
    const v = parseFloat(state.entry);
    return isFinite(v) && v > 0 ? v : null;
  }
  /** The committed guess in METRIC, for scoring. */
  function guessValue() {
    if (!fact) return null;
    const v = typedValue();
    if (v == null) return null;
    return fact.scale === 'year' ? v : view.toMetric(v);
  }

  /* ------------------------------------------------------------ ruler (reveal only) */
  function makeRuler(center) {
    if (fact.scale === 'year') {
      const now = new Date().getFullYear();
      const hi = Math.min(center + 75, Math.max(now, center + 10));
      const lo = hi - 150;
      return { lo, hi, toT: (v) => (v - lo) / (hi - lo), year: true };
    }
    const lo = center / 30, hi = center * 30, L = Math.log(hi / lo);
    return { lo, hi, toT: (v) => (v > 0 ? Math.log(v / lo) / L : -1), year: false };
  }

  function compact(v) {
    if (v >= 1e9) return `${+(v / 1e9).toPrecision(3)}B`;
    if (v >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
    if (v >= 1e3) return `${+(v / 1e3).toPrecision(3)}k`;
    return `${+v.toPrecision(3)}`;
  }

  function drawTicks(r) {
    els.ticks.innerHTML = '';
    const add = (v, major, text) => {
      const t = r.toT(v);
      if (t < 0 || t > 1) return;
      const el = document.createElement('span');
      el.className = major ? 'tick major' : 'tick';
      el.style.left = `${(t * 100).toFixed(3)}%`;
      if (major && text) {
        const lab = document.createElement('em');
        lab.textContent = text;
        if (t < 0.06) lab.classList.add('edge-l');
        if (t > 0.94) lab.classList.add('edge-r');
        el.appendChild(lab);
      }
      els.ticks.appendChild(el);
    };
    if (r.year) {
      for (let y = Math.ceil(r.lo / 25) * 25; y <= r.hi; y += 25) add(y, y % 50 === 0, y % 50 === 0 ? String(y) : '');
    } else {
      for (let p = Math.floor(Math.log10(r.lo)); p <= Math.ceil(Math.log10(r.hi)); p++) {
        const b = Math.pow(10, p);
        add(b, true, compact(b));
        add(b * 2, false); add(b * 5, false);
      }
    }
  }

  /** Position the band on the ruler for the committed guess and width. */
  function layoutRuler(metricGuess, chip) {
    const typed = fact.scale === 'year' ? metricGuess : view.toDisp(metricGuess);
    ruler = makeRuler(typed);
    drawTicks(ruler);
    const r = S.range(fact, metricGuess, chip);
    const lo = fact.scale === 'year' ? r.lo : view.toDisp(r.lo);
    const hi = fact.scale === 'year' ? r.hi : view.toDisp(r.hi);
    const tlo = clamp(ruler.toT(lo), 0, 1), thi = clamp(ruler.toT(hi), 0, 1);
    els.band.style.left = `${(tlo * 100).toFixed(3)}%`;
    els.band.style.width = `${((thi - tlo) * 100).toFixed(3)}%`;
    els.band.style.setProperty('--c', `var(--c-${S.CHIPS[chip].key})`);
  }

  /* ------------------------------------------------------------ paint */
  function update() {
    const none = state.chip == null;          // the guide clears the width so the player must choose one
    const chip = none ? null : S.CHIPS[state.chip];
    const typed = typedValue();
    const guess = guessValue();
    if (chip) els.card.style.setProperty('--chip', `var(--c-${chip.key})`);
    els.card.classList.toggle('no-chip', none);
    els.card.classList.toggle('empty', guess == null);

    // Readout: low ⟵ guess ⟶ high
    els.guess.textContent = typed == null ? (state.entry.endsWith('.') ? '0.' : '') : fact.scale === 'year' ? String(typed) : showEntry(state.entry);
    if (guess != null && !none) {
      const r = S.range(fact, guess, state.chip);
      // wrapped so the guide can run a highlighter under just the number
      els.lo.innerHTML = `<span class="r-num">${view.fmt(r.lo)}</span>`;
      els.hi.innerHTML = `<span class="r-num">${view.fmt(r.hi)}</span>`;
    } else {
      els.lo.textContent = '—';
      els.hi.textContent = '—';
    }
    els.lock.disabled = guess == null || none;
    els.lockMain.textContent = guess == null ? 'Type a guess' : none ? 'Pick one' : 'Lock it in';
    if (none) {
      els.lockStub.innerHTML = '';
      els.lock.setAttribute('aria-label', 'Pick how sure you are first');
    } else {
      const bet = S.legPointsFor(state.chip, Boolean(ctx.clueHere));
      els.lockStub.innerHTML = `<i class="kl-pip"></i>${K.units.climbText(S.kmOf(bet))}`;
      els.lock.setAttribute('aria-label', guess == null ? 'Type a guess first' : `Lock it in for ${K.units.climbText(S.kmOf(bet))}`);
    }

    // Width buttons: the chosen one lights up; values halve when the clue is on.
    els.wbtnEls.forEach((b, i) => {
      const full = S.legPoints(i);
      b.classList.toggle('on', i === state.chip);
      b.setAttribute('aria-checked', String(i === state.chip));
      b.querySelector('b').textContent = K.units.climbText(S.kmOf(S.legPointsFor(i, Boolean(ctx.clueHere))));
    });
  }

  /* ------------------------------------------------------------ timer */
  /** The dial: --left drives the arc every frame; numerals and colour change once a second. */
  function setTimer(remaining, total) {
    if (locked) return;
    const sec = Math.max(0, Math.ceil(remaining));
    const frac = reduce.matches ? sec / total : remaining / total;   // stepped under reduced motion
    els.card.style.setProperty('--left', clamp(frac, 0, 1).toFixed(4));
    if (sec === lastSec) return;
    lastSec = sec;
    els.timerNum.textContent = sec;
    els.timer.setAttribute('aria-label', `${sec} seconds left`);
    els.card.classList.toggle('t-mid', sec <= 15 && sec > 5);
    els.card.classList.toggle('t-low', sec <= 5);
    if (sec <= 5 && sec > 0) { els.timer.classList.remove('beat'); void els.timer.offsetWidth; els.timer.classList.add('beat'); }
    if (sec === 10 || sec === 5) els.timerLive.textContent = `${sec} seconds`;
  }

  /* ------------------------------------------------------------ reveal visuals */
  function lockVisual() {
    locked = true;
    clearTimeout(clueArmTimer);
    els.card.classList.add('is-locked');
    els.card.classList.remove('t-mid', 't-low');
    els.timer.classList.remove('beat');
  }

  /** The ruler slides in; the needle hovers, then drops onto the answer. */
  async function dropNeedle(metricGuess) {
    reveal = { guess: metricGuess, chip: state.chip };
    const answerD = fact.scale === 'year' ? fact.answer : view.toDisp(fact.answer);
    if (metricGuess != null) layoutRuler(metricGuess, state.chip);
    else { ruler = makeRuler(answerD); drawTicks(ruler); els.band.style.width = '0'; }
    els.card.classList.add('show-ruler');
    placeNeedle();
    await K.fx.sleep(K.fx.reduced() ? 60 : 260);
    els.needle.hidden = false;
    els.needle.classList.add('hover');
    await K.fx.sleep(K.fx.reduced() ? 120 : 560);
    els.needle.classList.remove('hover');
    els.needle.classList.add('drop');
    await K.fx.sleep(K.fx.reduced() ? 60 : 280);
  }

  /** Needle on the answer, labelled in the player's units. */
  function placeNeedle() {
    const answerD = fact.scale === 'year' ? fact.answer : view.toDisp(fact.answer);
    const raw = ruler.toT(answerD);
    const off = raw < 0 ? 'left' : raw > 1 ? 'right' : '';
    const t = clamp(raw, 0, 1);
    els.needle.style.left = `${(t * 100).toFixed(3)}%`;
    const label = `${view.fmt(fact.answer, true)}${view.short ? ' ' + view.short : ''}`;
    els.needle.querySelector('.needle-label').textContent = off === 'left' ? `← ${label}` : off === 'right' ? `${label} →` : label;
    els.needle.classList.toggle('label-l', t > 0.72);
    els.needle.classList.toggle('label-r', t < 0.28);
    els.needle.classList.toggle('offscale', !!off);
  }

  function markOutcome(hit, chipIdx) {
    els.band.classList.add(hit ? 'hit' : 'miss');
    if (hit) els.band.style.setProperty('--c', `var(--c-${S.CHIPS[chipIdx].key})`);
  }

  function bandPoint() {
    const r = (ruler ? els.band : els.track).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function offByText(metricGuess) {
    if (fact.scale === 'year') return S.offBy(fact, metricGuess, false);
    return S.offBy({ ...fact, answer: view.toDisp(fact.answer) }, view.toDisp(metricGuess), false);
  }

  function showResult(args) {
    lastResult = args;
    const { hit, chipIdx, delta, ptsAfter, timedOut, guess, lo, hi, clue, nextLabel, nextStub } = args;
    const chip = S.CHIPS[chipIdx];
    const unit = view.unit ? ` ${view.unit}` : '';
    const verdict = els.result.querySelector('.verdict');
    verdict.textContent = hit ? (chipIdx === 4 ? 'Pinpoint' : 'Hit') : guess == null ? (timedOut ? 'Ran out of time' : 'No answer') : 'Miss';
    verdict.className = `verdict ${hit ? 'is-hit' : 'is-miss'}`;
    verdict.style.setProperty('--c', hit ? `var(--c-${chip.key})` : 'var(--c-miss)');

    let d;
    const climb = ptsAfter != null ? K.units.legText(S.kmOf(ptsAfter - delta), S.kmOf(ptsAfter)) : K.units.climbText(S.kmOf(delta));
    if (hit) d = `${climb}${clue ? ' (clue: half)' : ''}`;
    else d = guess == null ? (timedOut ? 'No climb' : 'No climb') : `No climb · ${offByText(guess)}`;
    els.result.querySelector('.verdict-delta').textContent = d;

    els.result.querySelector('.result-line').innerHTML = guess == null
      ? `Answer <strong>${view.fmt(fact.answer, true)}${unit}</strong>`
      : `Answer <strong>${view.fmt(fact.answer, true)}${unit}</strong> · you said ${view.fmt(lo)}–${view.fmt(hi)}`;
    const hs = els.result.querySelector('.result-hind');
    const h = args.hindsight;
    hs.hidden = !h;
    if (h) {
      const name = S.CHIPS[h.chip].name;
      const km = K.units.climbText(S.kmOf(h.pts));
      hs.style.setProperty('--c', `var(--c-${S.CHIPS[h.chip].key})`);
      // One line, same voice as the answer line: a width pip, the width, the climb.
      hs.innerHTML = `<i></i><b>${name}</b> would've ${h.hit ? 'hit too' : 'caught it'} · <b>${km}</b>`;
    }
    els.result.querySelector('.result-fact').textContent = K.units.hint(fact.card);
    const nb = els.result.querySelector('#btn-next');
    nb.querySelector('.kl-main').textContent = nextLabel;
    nb.querySelector('.kl-stub').innerHTML = nextStub || '';
    els.controls.hidden = true;
    els.result.hidden = false;
    els.card.classList.add('is-revealed');
  }

  /* ------------------------------------------------------------ leg to leg
     0 ms .leg-out (body tears off) → OUT ms render(next) + .leg-in → +IN ms done.
     Any key or tap jumps to the end; the key still types into the new leg. */
  function advance(opts) {
    const OUT = reduce.matches ? 120 : 200;
    const IN = reduce.matches ? 160 : 460;
    const card = els.card;
    return new Promise((resolve) => {
      let t = 0, swapped = false, done = false;
      const swap = () => {
        swapped = true;
        card.classList.remove('leg-out');
        render(opts);
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('leg-in');
        t = setTimeout(end, IN);
      };
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        card.classList.remove('leg-out', 'leg-in');
        document.removeEventListener('keydown', skip, true);
        document.removeEventListener('pointerdown', skip, true);
        resolve();
      };
      const skip = () => { if (!swapped) { clearTimeout(t); swap(); } end(); };
      document.addEventListener('keydown', skip, true);
      document.addEventListener('pointerdown', skip, true);
      card.classList.add('leg-out');
      t = setTimeout(swap, OUT);
    });
  }

  return {
    init, render, advance, setUnits, setTimer, lockVisual, dropNeedle, markOutcome, bandPoint, showResult,
    renderLegs, selectChip, clearChip, key, guessValue, offByText,
    get locked() { return locked; },
    get state() { return state; },
  };
})();
