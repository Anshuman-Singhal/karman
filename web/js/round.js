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
  /** What each width is for, in everyday words: the tag on every width box. */
  const SURE = ['no idea', 'rough idea', 'ballpark', 'close', 'pinpoint'];

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
  let scorePts = 0;         // the flight's points before this leg (for the reach preview)
  let isFinal = false;      // leg 7
  let guttering = false;    // the burner turned down for the last five seconds
  const REST_FLAME = 0.45;  // the burner's cruising level (scene.js liftOff)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------ setup */
  function init() {
    els = {
      card: $('screen-round'), timerLive: $('timer-live'), legs: $('legs'), cat: $('round-cat'),
      timer: $('round-timer'), clue: $('btn-clue'), q: $('round-q'), hint: $('round-hint'),
      lo: $('r-lo'), hi: $('r-hi'), between: $('r-between'), guess: $('guess-value'), unitBtn: $('unit-toggle'),
      ticks: $('scale-ticks'), track: $('track'), band: $('band'), needle: $('needle'),
      wbtns: $('wbtns'),
      pad: $('keypad'), controls: $('round-controls'), result: $('round-result'),
    };

    // Width buttons: one tap picks how sure you are. Each shows the range it
    // would give the typed guess (top) and its climb (below); before a guess
    // the top line says how sure that width is for, in everyday words.
    els.wbtnEls = S.CHIPS.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wbtn';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--c', `var(--c-${c.key})`);
      b.style.setProperty('--i', String(i));   // the guide prints the row in left to right
      b.innerHTML = `<span class="wb-word">${SURE[i]}</span><span class="wb-range"></span><b class="wb-climb"></b>`;
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
    // Desktop has no keypad: a small delete key beside the number shows that
    // a typed guess can be fixed (Backspace works too, and flashes this key).
    const del = document.getElementById('guess-del');
    if (del) del.addEventListener('click', () => press('del', del));
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
    scorePts = opts.scorePts || 0;
    isFinal = opts.index === K.CONFIG.LEGS - 1;
    ungutter();

    els.card.classList.remove('is-locked', 'is-revealed', 't-mid', 't-low', 'clued', 'show-ruler', 'paused', 'punched');
    clearPrice();
    els.card.classList.toggle('final', isFinal);
    els.band.className = 'band';
    if (els.gap) els.gap.hidden = true;
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
    // Leg 7 announces itself: FINAL LEG in ember, and the "/ 7" drops away.
    (isFinal ? [['leg-no', 'Final leg'], ['leg-cat', fact.cat]] : [['leg-no', `Leg ${opts.index + 1}`], ['leg-of', `/ ${K.CONFIG.LEGS}`], ['leg-cat', fact.cat]])
      .forEach(([c, t]) => { const s = document.createElement('span'); s.className = c; s.textContent = t; els.cat.appendChild(s); });
    els.cat.setAttribute('aria-label', `${isFinal ? 'Final leg' : `Leg ${opts.index + 1}`} of ${K.CONFIG.LEGS}, ${fact.cat}`);
    requestAnimationFrame(fitCat);
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
      ready: '<span class="ct-main">Clue</span><span class="ct-stub ct-cost">costs half</span>',
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
      c.innerHTML = '<span class="ct-main">Confirm</span><span class="ct-stub ct-cost">costs half</span>';
      c.setAttribute('aria-label', 'Tap again to use your clue. This leg pays half');
      els.hint.classList.remove('is-clue');
      els.hint.classList.add('is-cost');
      els.hint.textContent = 'Tap again to use it. This leg pays half.';
      return;
    }
    clearTimeout(clueArmTimer);
    const before = priceSnapshot();
    const stub = c.querySelector('.ct-stub');
    ctx.clueUsed = true;
    ctx.clueHere = true;
    if (stub && !K.fx.reduced()) {      // the "costs half" stub tears off, then the tag reads Clue on
      stub.classList.add('ct-torn');
      setTimeout(() => { if (c.querySelector('.ct-torn')) renderClue(); }, 280);
    } else renderClue();
    payPrice(before);
    els.hint.classList.add('swap');
    setTimeout(() => { renderHint(); els.hint.classList.remove('swap'); update(); }, 180);
    K.fx.haptic(10);
    if (ctx.onClue) ctx.onClue();
  }

  /* The clue's price, paid in front of you: each width's climb shows the old
     value struck through in ember, then flips to the halved one, left to
     right; the Lock stub goes last. update() leaves a held climb alone. */
  const held = new Set();     // width indices (and 'lock') still showing the old price
  let priceTimers = [];
  function priceSnapshot() {
    return { w: els.wbtnEls.map((b) => b.querySelector('.wb-climb').textContent), lock: state.chip == null ? null : els.lockStub.innerHTML };
  }
  function payPrice(before) {
    clearPrice();
    const calm = K.fx.reduced();
    const STRIKE = calm ? 300 : 220, STEP = calm ? 0 : 40;
    const strike = (el, html) => { el.innerHTML = html; el.classList.add('struck'); };
    const settle = (key) => {
      held.delete(key);
      update();
      const el = key === 'lock' ? els.lockStub : els.wbtnEls[key].querySelector('.wb-climb');
      el.classList.remove('struck');
      if (!calm) { el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); }
    };
    els.wbtnEls.forEach((b, i) => {
      held.add(i);
      strike(b.querySelector('.wb-climb'), `<s>${before.w[i]}</s>`);
      priceTimers.push(setTimeout(() => settle(i), STRIKE + i * STEP));
    });
    if (before.lock != null) {
      held.add('lock');
      strike(els.lockStub, before.lock.replace(/(<\/i>)(.*)$/, '$1<s>$2</s>'));
      priceTimers.push(setTimeout(() => settle('lock'), STRIKE + els.wbtnEls.length * STEP));
    }
    priceTimers.push(setTimeout(() => [...els.wbtnEls.map((b) => b.querySelector('.wb-climb')), els.lockStub].forEach((el) => el.classList.remove('flip')), 900));
  }
  function clearPrice() {
    priceTimers.forEach(clearTimeout);
    priceTimers = [];
    if (!held.size) return;
    held.clear();
    els.wbtnEls.forEach((b) => b.querySelector('.wb-climb').classList.remove('struck', 'flip'));
    els.lockStub.classList.remove('struck', 'flip');
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
    const pitched = K.CONFIG.SOUND_PITCHED;
    if (k === 'del') {
      if (pitched && e) K.audio.tick(Math.max(0, intDigits(e) - 2), true);   // one degree down, duller
      e = e.slice(0, -1);
    } else if (k === '.') {
      if (fact.scale === 'year' || e.includes('.') || e.length >= MAX_DIGITS) return refuse();
      e = (e || '0') + '.';
    } else {
      if (e.includes('.') && e.split('.')[1].length >= 3) return refuse();   // 3 decimals is plenty
      if (e.length >= MAX_DIGITS) return refuse();
      if (e === '0') e = '';
      e += k;
    }
    state.entry = e;
    K.fx.haptic(5);
    if (k !== 'del') { K.scene.flare(0.55); K.audio.tick(pitched ? intDigits(e) - 1 : undefined); }
    els.guess.classList.remove('roll');
    void els.guess.offsetWidth;
    els.guess.classList.add('roll');
    update();
    onChange(state.entry, state.chip);
  }

  /** The category is the one word that frames the question, so it never gets cut off:
      on phones the "/ 7" goes (the seven pips already count), then the tag tightens its
      letter-spacing and steps its size down until it fits (an ellipsis only as a last resort). */
  function fitCat() {
    const c = els.cat;
    if (!c) return;
    const cat = c.querySelector('.leg-cat'), no = c.querySelector('.leg-no');
    if (!cat) return;
    const clipped = () => cat.scrollWidth > cat.clientWidth + 1;
    c.style.fontSize = ''; c.style.letterSpacing = '';
    c.classList.remove('no-of', 'no-no');
    if (no && no.dataset.full) no.textContent = no.dataset.full;
    if (!clipped()) return;
    c.classList.add('no-of');                                   // 1 · the "/ 7" (the pips count)
    if (!clipped()) return;
    c.style.letterSpacing = '0.02em';                           // 2 · tighter, then smaller
    let size = parseFloat(getComputedStyle(c).fontSize);
    while (clipped() && size > 11) { size -= 0.5; c.style.fontSize = `${size}px`; }
    if (!clipped() || !no) return;
    if (els.card.classList.contains('final')) {                  // 3 · "Final leg" → "Final"
      no.dataset.full = no.dataset.full || no.textContent; no.textContent = 'Final';
      if (clipped()) c.classList.add('no-no');                  //     (the halo'd 7th pip and "Last burn" still say it)
    } else c.classList.add('no-no');                            //     or the leg number goes (dial + pips show it)
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitCat));

  /** Desktop delete key: the right range line's dashes start just after it, and a number long
      enough to crowd the right edge gets the icon-only key. Measured, never reflowed. */
  function fitDel() {
    const del = document.getElementById('guess-del');
    if (!del || !els.hi) return;
    const shown = del.offsetParent && getComputedStyle(del).display !== 'none' && !els.card.classList.contains('empty');
    if (!shown) { els.hi.style.setProperty('--del-gap', '0px'); del.classList.remove('tight'); return; }
    del.classList.remove('tight');
    const num = els.hi.querySelector('.r-num') || els.hi;
    if (del.getBoundingClientRect().right + 6 > num.getBoundingClientRect().left) del.classList.add('tight');
    const gap = Math.max(0, del.getBoundingClientRect().right + 6 - els.hi.getBoundingClientRect().left);
    els.hi.style.setProperty('--del-gap', `${Math.round(gap)}px`);
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitDel));

  /** Digits before the decimal point, at least 1 ("0.5" → 1, "12,400" → 5). */
  function intDigits(e) { return Math.max(1, String(e).split('.')[0].replace(/^0+/, '').length); }
  function refuse() {
    if (K.CONFIG.SOUND_PITCHED) K.audio.refuse();
    shake();
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
    if (e.key === 'Backspace') { press('del', document.getElementById('guess-del')); return true; }
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
    if (K.CONFIG.SOUND_PITCHED && !(K.coach && K.coach.active)) K.audio.detent(i);
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

  /* ---- the range a width gives, in words and on the buttons ---- */
  /** A range edge for a button or the readout. Full numbers with commas
      while they fit (the non-gamer asked what "k" was); 12k · 1.5M · 15B
      only when they would not. `level` 0 = full, 1 = k from 10,000, 2 = M/B. */
  function edgeShort(vMetric, level = 0) {
    if (fact.scale === 'year') return view.fmt(vMetric);
    const v = view.toDisp(vMetric);
    const g = Number(v.toPrecision(3)), a = Math.abs(g);
    if (a >= 1e9) return `${+(g / 1e9).toPrecision(3)}B`;
    if (a >= 1e6 && level >= 1) return `${+(g / 1e6).toPrecision(3)}M`;
    if (a >= 1e4 && level >= 1) return `${+(g / 1e3).toPrecision(3)}k`;
    return g.toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 2 : 1 });
  }
  /** "33–75" for a button, "7" when the width is exact on a small count;
      the fullest spelling that fits the box. */
  function rangeShort(r) {
    for (let level = 0; level <= 1; level++) {
      const lo = edgeShort(r.lo, level), hi = edgeShort(r.hi, level);
      const t = lo === hi ? lo : `${lo}–${hi}`;
      if (t.length <= 10 || level === 1) return t;
    }
    return '';
  }
  /** One readout edge: full while it fits, compact beyond six digits. */
  const edgeReadout = (vMetric) => { const t = edgeShort(vMetric, 0); return t.length <= 7 ? t : edgeShort(vMetric, 1); };
  /** The same range in a sentence: "between 33 and 75 meters" / "exactly 7 dots" / "between 1890 and 1980". */
  /** A range edge in a sentence: "1.5 million" rather than "1,500,000". */
  function edgeWords(vMetric) {
    if (fact.scale === 'year') return view.fmt(vMetric);
    const a = Math.abs(view.toDisp(vMetric));
    if (a >= 1e9) return `${+(view.toDisp(vMetric) / 1e9).toPrecision(3)} billion`;
    if (a >= 1e6) return `${+(view.toDisp(vMetric) / 1e6).toPrecision(3)} million`;
    return view.fmt(vMetric);
  }
  function rangeWords(r, noUnit) {
    const unit = view.unit && !noUnit ? ` ${view.unit}` : '';
    const lo = edgeWords(r.lo), hi = edgeWords(r.hi);
    return lo === hi ? `exactly ${lo}${unit}` : `between ${lo} and ${hi}${unit}`;
  }
  /** The ranges every width would give the current guess, for the guide's live line. null with no guess. */
  function ranges() {
    const g = guessValue();
    if (g == null) return null;
    return S.CHIPS.map((c, i) => { const r = S.range(fact, g, i); return { lo: r.lo, hi: r.hi, short: rangeShort(r), words: rangeWords(r), climb: K.units.climbText(S.kmOf(S.legPointsFor(i, Boolean(ctx.clueHere)))) }; });
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
    // The grey mark sits in the middle of your range (the scale is not always centred
    // on it: year scales stop at this year, so a fixed 50% mark drifted off the band).
    const knob = document.getElementById('knob');
    if (knob) knob.style.left = `${(((tlo + thi) / 2) * 100).toFixed(3)}%`;
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
      els.lo.innerHTML = `<span class="r-num">${edgeReadout(r.lo)}</span>`;
      els.hi.innerHTML = `<span class="r-num">${edgeReadout(r.hi)}</span>`;
      if (els.between) els.between.textContent = rangeWords(r);
    } else {
      els.lo.textContent = '—';
      els.hi.textContent = '—';
      if (els.between) els.between.textContent = '';
    }
    requestAnimationFrame(fitDel);
    els.lock.disabled = guess == null || none;
    const lockWord = isFinal ? 'Last burn' : 'Lock it in';
    els.lockMain.textContent = guess == null ? 'Type a guess' : none ? 'Pick one' : lockWord;
    if (none) {
      els.lockStub.innerHTML = '';
      els.lock.setAttribute('aria-label', 'Pick how sure you are first');
    } else {
      const bet = S.legPointsFor(state.chip, Boolean(ctx.clueHere));
      if (!held.has('lock')) els.lockStub.innerHTML = `<i class="kl-pip"></i>${K.units.climbText(S.kmOf(bet))}`;
      els.lock.setAttribute('aria-label', guess == null ? 'Type a guess first' : `${lockWord} for ${K.units.climbText(S.kmOf(bet))}`);
    }
    // Reach preview: the sky shows where this bet lands if it hits.
    K.scene.preview(guess != null && !none && !locked ? S.kmOf(scorePts + S.legPointsFor(state.chip, Boolean(ctx.clueHere))) : null,
      none ? null : `var(--c-${chip.key})`);

    // Width buttons: the chosen one lights up; each shows the range it would
    // give this guess (or what it is for, before a guess); climbs halve when
    // the clue is on.
    els.wbtnEls.forEach((b, i) => {
      const climb = K.units.climbText(S.kmOf(S.legPointsFor(i, Boolean(ctx.clueHere))));
      const r = guess != null ? S.range(fact, guess, i) : null;
      b.classList.toggle('on', i === state.chip);
      b.setAttribute('aria-checked', String(i === state.chip));
      const short = r ? rangeShort(r) : '';
      b.querySelector('.wb-range').textContent = short;
      b.classList.toggle('long', short.length >= 9);   // "144M–156M": a size down so it stays whole
      if (!held.has(i)) b.querySelector('.wb-climb').textContent = climb;
      b.setAttribute('aria-label', r ? `${S.CHIPS[i].name}: ${rangeWords(r)}, climb ${climb}` : `${S.CHIPS[i].name}: ${SURE[i]}, climb ${climb}`);
    });
  }

  /** The guided leg: the dial shows a pause glyph instead of a count. */
  function setPaused(on) {
    els.card.classList.toggle('paused', Boolean(on));
    if (on) {
      els.timerNum.textContent = '';
      els.timer.setAttribute('aria-label', 'Clock paused');
    } else {
      els.timerNum.textContent = String(lastSec);
      els.timer.setAttribute('aria-label', `${lastSec} seconds left`);
    }
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
    if (sec <= 5 && sec > 0) {
      els.timer.classList.remove('beat'); void els.timer.offsetWidth; els.timer.classList.add('beat');
      // The last five seconds: the burner gutters and the pilot pumps the valve
      // once a second; a soft clock tick steps down 5 … 1.
      if (!els.card.classList.contains('paused')) {
        if (!K.fx.reduced()) {
          if (!guttering) { guttering = true; K.scene.setFlameTarget(0.25); }
          K.scene.flare(0.6);
        }
        K.audio.countdown(sec);
      }
    }
    if (sec === 10 || sec === 5) els.timerLive.textContent = `${sec} seconds`;
  }

  /* ------------------------------------------------------------ reveal visuals */
  /** opts.punch: the ticket punch (a fresh lock with a guess, tapped or at 0 s). */
  function lockVisual(opts = {}) {
    locked = true;
    clearTimeout(clueArmTimer);
    clearPrice();
    els.card.classList.remove('punched');
    if (opts.punch) {
      void els.card.offsetWidth;   // restart the press / hole / stamp animations
      els.card.classList.add('punched');
      K.audio.punch();
    }
    els.card.classList.add('is-locked');
    els.card.classList.remove('t-mid', 't-low');
    els.timer.classList.remove('beat');
    ungutter();
    K.scene.preview(null);
  }
  function ungutter() {
    if (!guttering) return;
    guttering = false;
    if (Math.abs(K.scene.flameTarget - 0.25) < 1e-6) K.scene.setFlameTarget(REST_FLAME);
  }

  /** The ruler slides in; the needle hovers, then drops onto the answer. */
  async function dropNeedle(metricGuess, opts = {}) {
    reveal = { guess: metricGuess, chip: state.chip };
    const answerD = fact.scale === 'year' ? fact.answer : view.toDisp(fact.answer);
    // a punched guess stays on the pass for the stamp (160 ms) before the ruler takes its place
    if (els.card.classList.contains('punched') && !K.fx.reduced()) await K.fx.sleep(170);
    if (metricGuess != null) layoutRuler(metricGuess, state.chip);
    else { ruler = makeRuler(answerD); drawTicks(ruler); els.band.style.width = '0'; const k = document.getElementById('knob'); if (k) k.style.left = '50%'; }
    els.card.classList.add('show-ruler');
    placeNeedle();
    await K.fx.sleep(K.fx.reduced() ? 60 : 260);
    els.needle.hidden = false;
    els.needle.classList.add('hover');
    const hover = K.fx.reduced() ? 120 : 560;
    if (!opts.quiet) K.audio.air(hover / 1000);
    await K.fx.sleep(hover);
    els.needle.classList.remove('hover');
    els.needle.classList.add('drop');
    await K.fx.sleep(K.fx.reduced() ? 60 : 280);
    if (!opts.quiet) K.audio.knock();   // the frame it lands: a low wooden knock
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

  /** Photo finish. A hit in the outer 6 % of the range (in log space; the
      edge grace counts) is "by a hair"; a miss within 15 % of an edge (at
      least one step for whole counts and years) is "just outside".
      Returns { kind: 'hair' | 'outside', side: 'l' | 'r' } or null. */
  function photoFinish(guess, chipIdx, hit) {
    if (!fact || guess == null || chipIdx == null) return null;
    const r = S.range(fact, guess, chipIdx), a = fact.answer;
    if (!(r.hi > r.lo)) return null;                       // "exactly 7": no edges to speak of
    const linear = fact.scale === 'year' || r.lo <= 0 || a <= 0;
    if (hit) {
      const t = linear ? (a - r.lo) / (r.hi - r.lo) : Math.log(a / r.lo) / Math.log(r.hi / r.lo);
      return t < 0.06 ? { kind: 'hair', side: 'l' } : t > 0.94 ? { kind: 'hair', side: 'r' } : null;
    }
    const step = fact.scale === 'year' || fact.int ? 1 : 0;
    const near = (edge, off) => off > 0 && off <= Math.max(fact.scale === 'year' ? (r.hi - r.lo) * 0.15 : Math.abs(edge) * 0.15, step);
    if (a > r.hi && near(r.hi, a - r.hi)) return { kind: 'outside', side: 'r' };
    if (a < r.lo && near(r.lo, r.lo - a)) return { kind: 'outside', side: 'l' };
    return null;
  }

  function markOutcome(hit, chipIdx, photo) {
    els.band.classList.add(hit ? 'hit' : 'miss');
    if (hit) els.band.style.setProperty('--c', `var(--c-${S.CHIPS[chipIdx].key})`);
    if (!photo || !ruler) return;
    if (photo.kind === 'hair') els.band.classList.add('hair', `edge-${photo.side}`);
    else {
      // the gap between the band's edge and the needle, hatched in ember
      const disp = (v) => (fact.scale === 'year' ? v : view.toDisp(v));
      const r = S.range(fact, reveal.guess, chipIdx);
      const te = clamp(ruler.toT(disp(photo.side === 'r' ? r.hi : r.lo)), 0, 1);
      const tn = clamp(ruler.toT(disp(fact.answer)), 0, 1);
      if (!els.gap) { els.gap = document.createElement('div'); els.gap.className = 'gap'; els.track.insertBefore(els.gap, els.needle); }
      els.gap.style.left = `${(Math.min(te, tn) * 100).toFixed(3)}%`;
      els.gap.style.width = `${(Math.abs(tn - te) * 100).toFixed(3)}%`;
      els.gap.hidden = false;
    }
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
    verdict.textContent = hit ? (chipIdx === 4 ? 'Pinpoint' : 'Hit') : guess == null ? (timedOut ? 'Time’s up' : 'No answer') : 'Miss';
    verdict.className = `verdict ${hit ? 'is-hit' : 'is-miss'}`;
    verdict.style.setProperty('--c', hit ? `var(--c-${chip.key})` : 'var(--c-miss)');

    let d;
    const climb = ptsAfter != null ? K.units.legText(S.kmOf(ptsAfter - delta), S.kmOf(ptsAfter)) : K.units.climbText(S.kmOf(delta));
    const plain = Boolean(args.plain) && guess != null;   // first week: the rule in a sentence (the line below says "no climb")
    if (hit) d = `${climb}${clue ? ' (clue: half)' : ''}`;
    else d = guess == null ? (timedOut ? 'No climb' : 'No climb') : plain ? offByText(guess) : `No climb · ${offByText(guess)}`;
    const vd = els.result.querySelector('.verdict-delta');
    // Photo finish: "by a hair" beside the climb; "just outside" instead of the miss margin.
    const photo = args.photo;
    vd.textContent = photo && photo.kind === 'outside' ? '' : d;
    if (photo) {
      const em = document.createElement('em');
      em.className = 'vd-hair';
      em.textContent = photo.kind === 'hair' ? 'by a hair' : 'just outside';
      if (photo.kind === 'hair') vd.append(' ');
      vd.appendChild(em);
    }
    vd.classList.toggle('gain', Boolean(hit));      // the climb is the headline on a hit

    const ans = `<strong>${view.fmt(fact.answer, true)}${unit}</strong>`;
    // A hit on the edge (the half-percent grace in scoring.isHit) must never read
    // "56 m was between 56.3 and 74.4": stretch the shown range to the answer.
    const said = hit && guess != null ? { lo: Math.min(lo, fact.answer), hi: Math.max(hi, fact.answer) } : { lo, hi };
    els.result.querySelector('.result-line').innerHTML = guess == null
      ? `Answer ${ans}`
      : plain
        ? (hit
          ? `The answer, ${ans}, was ${rangeWords(said, true)}, so you climbed <strong>${climb}</strong>.`
          : `The answer, ${ans}, wasn't ${rangeWords(said, true)}, so no climb.`)
        : `Answer ${ans} · you said ${view.fmt(said.lo)}–${view.fmt(said.hi)}`;
    const hs = els.result.querySelector('.result-hind');
    const h = args.hindsight;
    hs.hidden = !h;
    if (h) {
      const name = args.plain ? SURE[h.chip] : S.CHIPS[h.chip].name;   // first week: the box's own word
      hs.style.setProperty('--c', `var(--c-${S.CHIPS[h.chip].key})`);
      // One line, same voice as the answer line: a width pip, the width, its range, the climb.
      const hr = S.range(fact, guess, h.chip);
      hs.innerHTML = `<i></i><b>${name}</b> <span class="hind-range">(${rangeShort(hr)})</span> would've ${h.hit ? 'hit too' : 'caught it'}.`;
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
    init, render, advance, setUnits, setTimer, lockVisual, dropNeedle, markOutcome, photoFinish, bandPoint, showResult,
    renderLegs, selectChip, clearChip, key, guessValue, offByText, ranges, setPaused,
    get locked() { return locked; },
    get state() { return state; },
  };
})();
