/* ==========================================================================
   KÁRMÁN · ui.js
   Screens other than the round card: home (flight plan), results (score,
   today's pilots, the answers, share tickets, passport row), the logbook and
   help sheets, the top bar, and the dev strip.
   Rendering only; game.js decides when each one appears.
   ========================================================================== */

K.ui = (() => {
  const S = K.scoring;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const kmLabel = (km) => (km % 1 ? km.toFixed(1) : String(km));

  const SCREENS = ['home', 'round', 'results', 'closed'];
  let current = null;
  let odo;

  /* Line icons for stamps (24×24, stroke = currentColor). */
  const ICONS = {
    clouds: '<path d="M6 17h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 6 17z"/>',
    everest: '<path d="M2 20 9.5 7l3 5 2.5-3.5L22 20z"/><path d="m8 9.6 1.5 1.4 1.5-1"/>',
    airliners: '<path d="M2 13.5 22 10M10 12.2 6.5 5H9l5 6.6M10.6 13.1 7.5 19H10l4.6-6.6M3.5 13.3 2 10h2l2 3"/>',
    ozone: '<path d="M2 9c3-2 5-2 8 0s5 2 8 0 3-1 4-1M2 14c3-2 5-2 8 0s5 2 8 0 3-1 4-1"/>',
    skydive: '<circle cx="12" cy="5" r="2"/><path d="M12 7v6M12 9 6 6.5M12 9l6-2.5M12 13l-4 6M12 13l4 6"/>',
    stratopause: '<path d="M2 15h20"/><circle cx="12" cy="8" r="3"/><path d="M12 2.5v1.5M6.5 8H5M19 8h-1.5"/>',
    karman: '<path d="M2 21a14 14 0 0 1 20 0"/><path d="M15 4l.9 2.2L18 7l-2.1.8L15 10l-.9-2.2L12 7l2.1-.8z"/>',
  };
  const icon = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
  const milestone = (id) => S.MILESTONES.find((m) => m.id === id);

  /** A round inked stamp; ink colour = tier (1 navy … 4 gold). */
  function ink(id, tier, opts = {}) {
    const m = milestone(id);
    const rot = opts.rot != null ? opts.rot : -6;
    return `<span class="ink t${Math.max(1, tier)} ${opts.big ? 'big' : ''} ${opts.slam ? 'slammed' : ''}" style="--r:${rot}deg" title="${esc(m.name)}">
      ${icon(id)}<b>${esc(m.short)}</b></span>`;
  }

  /* ------------------------------------------------------------ screens
     The gondola card stays put; screens crossfade inside it. */
  function show(name) {
    SCREENS.forEach((s) => {
      const el = $(`screen-${s}`);
      if (s === name) {
        el.hidden = false;
        el.classList.remove('leaving', 'leaving-slow');
        void el.offsetWidth;
        el.classList.add('entering');
        setTimeout(() => el.classList.remove('entering'), 420);
        el.scrollTop = 0;
      } else if (!el.hidden) {
        el.classList.add('leaving');
        setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 180);
      }
    });
    current = name;
    document.body.dataset.screen = name;
    if (name !== 'results' && K.climb) K.climb.close({ instant: true });
    setTimeout(anchorBalloon, 360); // after any dock resize (desktop results)
    requestAnimationFrame(anchorBalloon);
  }

  /** Take-off: grow the card to its round size NOW and aim the balloon at its
      final perch, so the climb is the only movement (no settle afterwards). */
  /* Take-off choreography: the home card slides away, the balloon has the sky to
     itself for the lift-off, then the question card rises into place. */
  function prepareLaunch() {
    const dock = $('dock');
    // Measure where the round card's top edge will be, without showing it.
    dock.style.transition = 'none';
    document.body.dataset.screen = 'round';
    const finalTop = dock.getBoundingClientRect().top;
    document.body.dataset.screen = 'home';
    void dock.offsetHeight;
    dock.style.transition = '';
    $('screen-home').classList.add('leaving-slow');
    dock.classList.add('away');
    K.scene.planAnchor(finalTop - 10);
  }
  /** After lift-off: size the card for the round while it's off-screen… */
  function dockReady() {
    const dock = $('dock');
    dock.style.transition = 'none';
    document.body.dataset.screen = 'round';
    void dock.offsetHeight;
    dock.style.transition = '';
  }
  /** …then let it rise. */
  function dockIn() {
    const dock = $('dock');
    if (!dock.classList.contains('away')) return Promise.resolve();
    dock.classList.remove('away');
    return new Promise((done) => setTimeout(done, K.fx.reduced() ? 0 : 420));
  }

  /** The home strip never scrolls: if its content is taller than the dock
      (narrow phone, big text setting), grow the dock to fit instead. */
  function fitHome() {
    const s = $('screen-home'), dock = $('dock');
    if (s.hidden) return;
    dock.style.removeProperty('--home-fit');
    requestAnimationFrame(() => {
      const extra = s.scrollHeight - s.clientHeight;
      if (extra > 0) { dock.style.setProperty('--home-fit', `${dock.offsetHeight + extra}px`); anchorBalloon(true); }
    });
  }

  /** Keep the basket just above the gondola. */
  function anchorBalloon(instant) {
    const dock = $('dock');
    if (dock.classList.contains('away')) return;   // mid take-off: the lift plan owns the balloon
    // Where the card's top edge rests, ignoring any slide (translate) in progress,
    // so the balloon never chases a card that is still moving.
    const parent = dock.offsetParent;
    const top = (parent ? parent.getBoundingClientRect().top : 0) + dock.offsetTop;
    K.scene.setAnchor(top - 10, instant === true);
  }

  /* ------------------------------------------------------------ top bar */
  function topbar({ n, mode, streak }) {
    $('flight-no').textContent = mode === 'unlimited' ? '∞' : n > 0 ? `#${n}` : '';
    $('streak-count').textContent = streak;
    $('btn-streak').classList.toggle('lit', streak > 0);
    $('btn-streak').setAttribute('aria-label', `${streak}-day streak. What is this?`);
  }

  /** Altimeter: km on the rolling odometer, points underneath. */
  function setAltitude(pts, opts) {
    odo.set(K.units.altNum(S.kmOf(pts)), opts);
    $('alt-unit').textContent = K.units.altUnit();
  }

  /* ------------------------------------------------------------ home */
  function home({ flight, mode = 'daily', streak, thermals, bestAlt }) {
    const d = K.date.dateOfFlight(flight.n);
    const short = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const un = mode === 'unlimited';
    $('home-meta').textContent = un ? `Unlimited · Flight #${flight.flightNo || flight.run}` : mode === 'archive' ? `Archive · ${short}` : `${short} · ${flight.weather.name}`;
    $('home-h').innerHTML = un ? 'Unlimited <span>∞</span>' : `Flight <span>#${flight.n}</span>`;
    $('home-lede').textContent = un ? 'Seven new questions. No streak on the line, but stamps still count.'
      : mode === 'archive' ? 'A past daily flight. It won’t touch your streak.'
      : `Seven guesses. Climb ${K.units.altText(100)} to the Kármán line, where space begins.`;
    $('launch-no').textContent = un ? '∞' : `#${flight.n}`;
    const td = K.date.dateOfFlight(Math.max(1, K.game.today));
    $('leaf-m').textContent = td.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    $('leaf-d').textContent = td.getUTCDate();
    $('home-status').hidden = mode !== 'daily';
    const parts = [`<span><b>${streak}</b> day streak</span>`, `<span title="Streak savers: earn one every 7 days in a row; each covers one missed day"><b>${thermals}</b> thermal${thermals === 1 ? '' : 's'}</span>`];
    if (bestAlt > 0) parts.push(`<span>Best <b>${K.units.altText(bestAlt)}</b></span>`);
    $('home-status').innerHTML = parts.join('');
    const btn = $('btn-launch');
    btn.disabled = false;
    btn.classList.remove('holding', 'fired');
  }

  /* ------------------------------------------------------------ results: today's pilots
     The live histogram of today's flights, printed on the paper pass as a
     vertical altitude chart: altitude runs UP the axis (0 at the bottom,
     the 140 km ceiling at the top, a tick every 20), and each 5 km band's
     bar runs LEFT → RIGHT for how many pilots landed in it. Your band is
     amber with a small YOU flag at its end; the Kármán line is ruled across
     at 100 km. Rebuilt every time results open, so a pilot who comes back
     later in the day sees the crowd as it is now. */
  const HIST = { w: 150, h: 216, top: 10, base: 206, axis: 28, right: 146, flag: 28, bin: 25 };
  const binsN = () => Math.ceil(S.MAX_PTS / HIST.bin);           // 28 bands of 5 km
  function binOf(pts) { return clamp(Math.floor(pts / HIST.bin), 0, binsN() - 1); }

  function histogram(record, stats, alone) {
    const bins = binsN();
    const counts = new Array(bins).fill(0);
    for (const [from, c] of stats.buckets) counts[binOf(from + stats.step / 2)] += c;   // re-bin any server step by bucket centre
    const mine = binOf(record.pts);
    if (!counts[mine]) counts[mine] = 1;        // you're in today's crowd even if the server hasn't counted you yet
    const peak = Math.max(1, ...counts);
    const span = HIST.base - HIST.top;
    const bandH = span / bins;
    const yOf = (km) => HIST.base - (km / S.MAX_KM) * span;
    const x0 = HIST.axis + 1.5;
    const maxW = HIST.right - x0 - HIST.flag - 6;                 // room for the YOU flag past the longest bar
    const W = (c) => (alone ? 36 : c ? Math.max(2.5, (c / peak) * maxW) : 0);
    const f1 = (v) => v.toFixed(1);

    const bars = counts.map((c, i) => {
      if (!c && i !== mine) return '';
      const w = i === mine ? Math.max(W(c), 7) : W(c);
      const y = yOf((i + 1) * (S.MAX_KM / bins)) + 0.8;
      return `<rect x="${f1(x0)}" y="${f1(y)}" width="${f1(w)}" height="${f1(bandH - 1.6)}" rx="1" class="h-bar${i === mine ? ' mine' : ''}" style="--i:${i}"/>`;
    }).join('');

    // Axis: a rule up the left, a tick and a number every 20 (km or miles).
    const imperial = K.units.system() === 'imperial';
    const toKm = (v) => (imperial ? v / 0.621371 : v);
    const maxDisp = K.units.altVal(S.MAX_KM);
    const ticks = [];
    const vals = [];
    for (let v = 0; v <= maxDisp; v += 20) vals.push(v);
    // the ceiling is always labelled; a regular tick crowding it (80 vs 87 mi) steps aside
    if (maxDisp - vals[vals.length - 1] < 12) vals.pop();
    if (vals[vals.length - 1] !== Math.round(maxDisp)) vals.push(Math.round(maxDisp));
    for (const v of vals) {
      const y = yOf(toKm(v));
      ticks.push(`<line x1="${HIST.axis - 3}" x2="${HIST.axis}" y1="${f1(y)}" y2="${f1(y)}" class="h-tickline"/><text x="${HIST.axis - 6}" y="${f1(y + 3.2)}" text-anchor="end" class="h-num">${v}</text>`);
    }
    // The Kármán line, ruled across at 100 km; the word steps aside if your band is there.
    const yk = yOf(K.CONFIG.KARMAN_KM || 100);
    const kBand = binOf(S.ptsOf(100));
    const kWord = Math.abs(mine - kBand) <= 1 ? '' : `<text x="${HIST.right}" y="${f1(yk - 3.5)}" text-anchor="end" class="h-karman">Kármán line</text>`;
    const karman = `<line x1="${HIST.axis}" x2="${HIST.right}" y1="${f1(yk)}" y2="${f1(yk)}" class="h-kline"/>${kWord}`;

    // YOU: a small ink flag just past your bar, pointing back at it.
    const bw = Math.max(W(counts[mine]), 7);
    const cy = yOf((mine + 0.5) * (S.MAX_KM / bins));
    const fx = x0 + bw + 6;
    const you = `<g class="h-you">
        <path d="M${f1(fx - 3.5)} ${f1(cy)}l3.5 -3.5v7z" class="h-flag"/>
        <rect x="${f1(fx)}" y="${f1(cy - 7)}" width="${HIST.flag}" height="14" rx="2.5" class="h-flag"/>
        <text x="${f1(fx + HIST.flag / 2)}" y="${f1(cy + 3.2)}" text-anchor="middle" class="h-youlabel">YOU</text>
      </g>`;

    const label = alone ? `Only your flight so far today: ${K.units.altText(S.kmOf(record.pts))}.`
      : `Today's climbs from 0 to ${K.units.altText(S.MAX_KM)} across ${stats.players.toLocaleString('en-US')} pilots. You reached ${K.units.altText(S.kmOf(record.pts))}.`;
    return `<svg viewBox="0 0 ${HIST.w} ${HIST.h}" class="hist-svg hist-v" role="img" aria-label="${label}">
      <line x1="${HIST.axis}" x2="${HIST.axis}" y1="${HIST.top}" y2="${HIST.base}" class="h-axis"/>
      ${ticks.join('')}${karman}
      <g class="h-bars">${bars}</g>
      ${you}
    </svg>`;
  }

  /* ------------------------------------------------------------ results: passport row
     One tappable row instead of a whole page; the book lives in the logbook. */
  function passportRow(record, isFresh) {
    const pp = record.passport || { stamps: [], slam: null, also: [] };
    const counts = K.storage.data.stampCounts || {};
    const newOnes = pp.stamps.filter((s) => s.first || s.tierUp).length;
    const chip = pp.slam ? ink(pp.slam, S.tierIndex(counts[pp.slam] || 1), { rot: -8, slam: isFresh }) : '';
    const text = !pp.stamps.length ? 'No stamps today · clouds start at 2 km'
      : `${pp.stamps.length} stamp${pp.stamps.length === 1 ? '' : 's'} today${newOnes ? ` · <b>${newOnes} new</b>` : ''}`;
    return `${chip}<span class="pr-text"><span class="pr-title">Passport</span><span>${text}</span></span><span class="pr-chev" aria-hidden="true">›</span>`;
  }

  /* ------------------------------------------------------------ results: answers
     Each leg is one row: the question, then ONE number line that holds both
     stories. Your range is a bar on the line in your width's colour, with
     YOUR GUESS marked in its middle and written ABOVE the line. The true
     ANSWER is a white pin written BELOW the line. Pin on the bar = a hit. */
  const CLUE_SVG = '<svg viewBox="0 0 24 24" class="ans-clue" aria-label="Clue used"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';

  /** Compact numbers for range ends and the scale: 3 significant figures, k/M/B. */
  function compact(v) {
    const a = Math.abs(v);
    const sig = (x) => String(Number(x.toPrecision(3)));
    if (a >= 1e9) return `${sig(v / 1e9)}B`;
    if (a >= 1e6) return `${sig(v / 1e6)}M`;
    if (a >= 1e4) return `${sig(v / 1e3)}k`;
    return Number(v.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 2 : 1 });
  }
  const yearTxt = (y) => (y < 0 ? `${Math.abs(Math.round(y))} BC` : String(Math.round(y)));

  /** Place range + answer on one track. Returns percentages (0–100). */
  function lineLayout(fact, v, r) {
    const isYear = fact.scale === 'year';
    const ans = isYear ? fact.answer : v.toDisp(fact.answer);
    if (r.guess == null) return { none: true, pin: 50, ans };
    const lo = isYear ? r.lo : v.toDisp(r.lo), hi = isYear ? r.hi : v.toDisp(r.hi);
    const dmin = Math.min(lo, ans), dmax = Math.max(hi, ans);
    const useLog = !isYear && dmin > 0 && dmax / dmin > 10;
    const T = useLog ? Math.log : (x) => x;
    const span = T(dmax) - T(dmin) || 1;
    const pos = (x) => 15 + (70 * (T(x) - T(dmin))) / span;
    const inv = useLog ? Math.exp : (x) => x;
    const axisLo = inv(T(dmin) - (span * 15) / 70), axisHi = inv(T(dmax) + (span * 15) / 70);
    let a = pos(lo), b = pos(hi), pin = pos(ans), g = pos(isYear ? r.guess : v.toDisp(r.guess));
    if (b - a < 1.5) { const c = (a + b) / 2; a = c - 0.75; b = c + 0.75; }
    const gap = ans > hi ? pin - b : ans < lo ? a - pin : 0;   // in % of the track
    // Far miss: break the axis so the range stays readable.
    if (gap > 48) {
      const off = isYear
        ? `${Math.round(Math.abs(ans - r.guess))} yrs off`
        : `${(Math.max(ans / v.toDisp(r.guess), v.toDisp(r.guess) / ans)).toPrecision(2).replace(/\.0$/, '')}× off`;
      return ans > hi
        ? { a: 15, b: 36, g: 25.5, pin: 85, gapFrom: 44, gapTo: 80, off, lo, hi, ans }
        : { a: 64, b: 85, g: 74.5, pin: 15, gapFrom: 20, gapTo: 56, off, lo, hi, ans };
    }
    return { a, b, g, pin, lo, hi, ans, axisLo: isYear ? Math.round(axisLo) : axisLo, axisHi: isYear ? Math.round(axisHi) : axisHi };
  }

  function answerRow(record, i, opts = {}) {
    const r = record.rounds[i];
    const fact = K.game.factById(r.id);
    if (!fact) return '';
    const v = K.units.view(fact);
    const isYear = fact.scale === 'year';
    const none = r.guess == null;
    const state = none ? 'none' : r.hit ? 'hit' : 'miss';
    const color = `var(--c-${S.CHIPS[r.chip].key})`;
    const L = lineLayout(fact, v, r);
    const pts = none ? '—' : r.delta > 0 ? K.units.climbText(S.kmOf(r.delta)) : '0';
    const ansTxt = isYear ? yearTxt(fact.answer) : v.fmt(fact.answer, true);
    const unit = !isYear && v.unit ? `<small>${esc(v.unit)}</small>` : '';
    const side = (p) => (p < 18 ? 'l' : p > 82 ? 'r' : 'c');
    const guessTxt = none ? '' : isYear ? yearTxt(r.guess) : v.fmt(r.guess);

    let track = '<i class="ans-track"></i>';
    let you = '<span class="ans-you none c" style="left:50%">No guess</span>';
    if (!L.none) {
      if (L.off) {
        track = `<i class="ans-track" style="left:0;right:${100 - L.gapFrom}%"></i><i class="ans-track dash" style="left:${L.gapFrom}%;right:${100 - L.gapTo}%"></i><i class="ans-track" style="left:${L.gapTo}%;right:0"></i>`
          + `<span class="ans-off" style="left:${((L.gapFrom + L.gapTo) / 2).toFixed(1)}%">${esc(L.off)}</span>`;
      }
      track += `<i class="ans-range" style="left:${L.a.toFixed(2)}%;width:${(L.b - L.a).toFixed(2)}%"></i><i class="ans-gmark" style="left:${L.g.toFixed(2)}%"></i>`;
      you = `<span class="ans-you ${side(L.g)}" style="left:${L.g.toFixed(2)}%"><em>You</em>${guessTxt}</span>`;
      // Your range's two ends, just outside the bar on the line itself
      const fmt = (x) => (isYear ? yearTxt(x) : compact(x));
      track += `<span class="ans-end lo" style="right:${(100 - L.a + 1.2).toFixed(2)}%">${fmt(L.lo)}</span><span class="ans-end hi" style="left:${(L.b + 1.2).toFixed(2)}%">${fmt(L.hi)}</span>`;
      // The scale's ends, faint, at the edges of the line
      if (!L.off) track += `<span class="ans-axis l">${fmt(L.axisLo)}</span><span class="ans-axis r">${fmt(L.axisHi)}</span>`;
    }
    const answer = `<span class="ans-val ${side(L.pin)}" style="left:${L.pin.toFixed(2)}%"><em>Answer</em>${ansTxt}${unit}</span>`;

    return `<div class="ans ${state}" style="--c:${color};--i:${opts.order != null ? opts.order : i}" data-leg="${i}">
      <div class="ans-top"><span class="ans-no">${i + 1}</span><p class="ans-q">${esc(fact.q)}</p><span class="ans-pts">${r.clue ? CLUE_SVG : ''}${pts}</span></div>
      <div class="ans-line">
        ${you}
        ${track}
        <i class="ans-pin" style="left:${L.pin.toFixed(2)}%"></i>
        ${answer}
      </div>
      <p class="ans-fact">${esc(fact.card)}</p>
    </div>`;
  }

  /** Phone: one tile per leg; tap one to show its row below. Desktop shows all rows. */
  function legStrip(record) {
    const strip = $('legstrip');
    strip.innerHTML = record.rounds.map((r, i) => {
      const c = r.hit ? `var(--c-${S.CHIPS[r.chip].key})` : 'var(--c-miss)';
      const state = r.guess == null ? 'none' : r.hit ? 'hit' : 'miss';
      const pts = r.guess == null ? '—' : r.delta > 0 ? K.units.climbText(S.kmOf(r.delta)).replace(/ (km|mi)$/, '') : '0';
      return `<button type="button" class="leg-tile ${state}" role="tab" aria-selected="false" data-i="${i}" style="--c:${c};--i:${i}">
        <span class="lt-no">${i + 1}</span><span class="lt-glyph"></span><span class="lt-pts">${pts}</span></button>`;
    }).join('');
    const detail = $('leg-detail');
    detail.innerHTML = '';
    detail.classList.remove('open');
    strip.querySelectorAll('.leg-tile').forEach((t) => {
      t.onclick = () => {
        const i = Number(t.dataset.i);
        const wasOpen = t.classList.contains('open');
        strip.querySelectorAll('.leg-tile').forEach((x) => { x.classList.remove('open'); x.setAttribute('aria-selected', 'false'); });
        if (wasOpen) { detail.classList.remove('open'); return; }
        t.classList.add('open');
        t.setAttribute('aria-selected', 'true');
        detail.innerHTML = `<div>${answerRow(record, i, { order: 0 })}</div>`;
        detail.classList.remove('open');
        void detail.offsetWidth;
        detail.classList.add('open');
        $('legstrip-note').hidden = true;
      };
    });
  }

  let lastStats = null;

  /** Today's pilots: one sentence (with a figure) over the live histogram.
      Never shows a number it can't stand behind:
        no stats (offline, Unlimited, no backend)  → nothing at all
        only you so far                            → your single bar, "first pilot up"
        0 points                                   → "grounded", no figure, chart kept   */
  function renderPercentile(record, stats) {
    const box = $('pctl');
    const chart = $('crowd-chart');
    chart.classList.remove('draw');
    if (!stats || !stats.players) { box.hidden = true; chart.innerHTML = ''; return; }
    const players = stats.players;
    const many = players.toLocaleString('en-US');
    const higher = stats.buckets.filter(([from]) => from > record.pts).reduce((a, b) => a + b[1], 0);
    const pct = K.stats.percentile(stats, record.pts);
    let kind = 'rank';
    const runNo = record.mode === 'unlimited' ? record.run : null;
    const crowd = runNo ? `the <b>${many}</b> pilots who flew this one` : `today’s <b>${many}</b> pilots`;
    // One sentence, one size: the figure is bold ink, never a different face.
    let txt = `Higher than <b class="pctl-inline">${pct}%</b> of ${crowd}.`;
    let said = txt.replace(/<[^>]+>/g, '');
    if (players <= 1) { kind = 'first'; txt = said = runNo ? 'You’re the first pilot to fly this one. Check back later to see how you compare.' : 'You’re the first pilot up today. Check back later to see how you compare.'; }
    else if (record.pts === 0) { kind = 'grounded'; txt = said = runNo ? 'Grounded on this run. Keep flying.' : 'Grounded today. The meadow resets at midnight.'; }
    else if (higher === 0) { txt = `Nobody flew higher. You topped ${crowd}.`; said = txt.replace(/<[^>]+>/g, ''); }
    box.dataset.kind = kind;
    box.setAttribute('aria-label', said);
    $('pctl-txt').innerHTML = txt + (stats.sample ? ' <span class="sample">Sample</span>' : '');
    chart.innerHTML = histogram(record, stats, kind === 'first');
    box.hidden = false;
    void chart.offsetWidth;
    chart.classList.add('draw');
    if (kind === 'rank' && !K.fx.reduced()) {
      const el = $('pctl-txt').querySelector('.pctl-inline');
      if (!el) return;
      const t0 = performance.now() + 150;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / 800));
        el.textContent = `${Math.round(pct * (1 - Math.pow(1 - p, 3)))}%`;
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = '0%';
      requestAnimationFrame(step);
    }
  }

  /** Fetch today's crowd, then show the percentile. */
  let statsTicket = 0;
  async function applyStats(record, n) {
    const mine = ++statsTicket;
    const stats = await K.stats.get(n);
    if (mine !== statsTicket) return;           // results were reopened meanwhile; the newer fetch wins
    lastStats = stats;
    renderPercentile(record, stats);
  }

  /* ------------------------------------------------------------ results */
  let lastRecord = null;
  /** After a fresh flight: the share ticket gives two small bumps and a paper tag
      says what it's for, then everything settles. Once per landing, no modal. */
  let nudgeTimer = 0;
  function nudgeShare(on) {
    const btn = $('btn-share'), tag = $('share-nudge');
    clearTimeout(nudgeTimer);
    btn.classList.remove('nudge'); tag.classList.remove('in');
    if (!on) return;
    nudgeTimer = setTimeout(() => {
      btn.classList.add('nudge');   // the pass never scrolls on its own: the score stays in view
      nudgeTimer = setTimeout(() => tag.classList.remove('in'), 6000);
    }, 1800);
    btn.addEventListener('click', () => { tag.classList.remove('in'); btn.classList.remove('nudge'); }, { once: true });
  }

  function results({ record, n, mode = 'daily', streak, thermals, streakInfo, isFresh, prevBest }) {
    lastRecord = { record, n, streak, mode };
    $('res-eyebrow').textContent = mode === 'unlimited' ? `Unlimited · Flight #${record.flightNo || record.run || ''}`
      : `${mode === 'archive' ? 'Archive · ' : ''}Flight #${n} · ${dayMonth(K.date.dateOfFlight(n))}`;
    $('btn-today').hidden = mode === 'daily';
    const subj = encodeURIComponent(`KÁRMÁN ${mode === 'unlimited' ? 'Unlimited' : `#${n}`}`);
    $('contact-link').href = `mailto:${K.CONFIG.CONTACT_EMAIL}?subject=${subj}`;
    paintKeep();
    $('res-alt').textContent = K.units.altNum(record.alt, 0);
    $('res-unit').textContent = K.units.altUnit();
    $('res-tier').textContent = S.tierName(record.alt);
    $('res-mrz').innerHTML = mrz(record, n, mode);
    $('pctl').hidden = true;
    $('crowd-chart').innerHTML = '';      // the chart is rebuilt when today's stats arrive

    // At most one short line of personal news.
    const prevBestPts = S.ptsOf(prevBest || 0);
    let note = '';
    if (prevBestPts > 0 && record.pts > prevBestPts) note = 'New personal best.';
    else if (isFresh && streakInfo && streakInfo.carried) note = 'A thermal saved your streak.';
    else if (isFresh && streakInfo && streakInfo.earnedThermal) note = 'Thermal earned.';
    $('res-note').textContent = note;

    $('ticket-stub').innerHTML = `<small>#${n}</small>${K.units.altText(record.alt).toUpperCase()}`;
    $('passport-row').innerHTML = passportRow(record, isFresh);
    legStrip(record);
    $('legstrip-note').hidden = false;

    const hits = record.rounds.filter((r) => r.hit).length;
    $('recap-count').innerHTML = `<b>${hits}</b> of ${record.rounds.length} hit`;
    const recap = $('recap');
    recap.innerHTML = record.rounds.map((_, i) => answerRow(record, i)).join('');
    recap.classList.toggle('reveal-seq', Boolean(isFresh));
    nudgeShare(isFresh && mode !== 'archive');
    if (mode === 'archive') { statsTicket++; $('pctl').hidden = true; lastStats = null; }
    else applyStats(record, mode === 'unlimited' ? `r${record.run}` : n);

    $('res-streak').textContent = `${streak}-day streak · ${thermals} thermal${thermals === 1 ? '' : 's'}`;
    if (K.climb) K.climb.set(record);          // the sky behind the pass can replay the climb
  }

  /** "8 October": the flight's date without the weekday. */
  const dayMonth = (d) => `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`;

  /** Two passport-style MRZ lines for the foot of the pass (44 chars each, '<' as filler). */
  function mrz(record, n, mode) {
    const fill = (t) => (t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9<]/g, '<') + '<'.repeat(44)).slice(0, 44);
    const d = K.date.dateOfFlight(n);
    const day = `${String(d.getUTCDate()).padStart(2, '0')}${'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.substr(d.getUTCMonth() * 3, 3)}${String(d.getUTCFullYear()).slice(2)}`;
    const head = mode === 'unlimited' ? `P<KARMAN<<UNLIMITED<FLIGHT<${record.flightNo || record.run || 1}` : `P<KARMAN<<FLIGHT<${n}<<${day}`;
    const hits = record.rounds.filter((r) => r.hit).length;
    const body = `${String(Math.round(record.alt)).padStart(3, '0')}KM<<${record.alt.toFixed(1).replace('.', '<')}KM<<${S.tierName(record.alt).toUpperCase()}<<${hits}<${record.rounds.length}`;
    const esc = (t) => t.replace(/</g, '&lt;');
    return `<span>${esc(fill(head))}</span><span>${esc(fill(body))}</span>`;
  }

  /* ------------------------------------------------------------ keep flying */
  function paintKeep() {
    const A = K.access;
    $('keep-sub').textContent = A.unlimited() ? '7 new questions' : A.freeRunLeft() ? 'Your first Unlimited run is free' : `Unlimited · ${K.CONFIG.PRICE} once`;
    $('keep-stub').innerHTML = A.unlimited() ? '∞' : A.freeRunLeft() ? 'FREE' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
  }

  /** Anything that shows locked/unlocked state, after access changes. */
  function refreshAccess() {
    paintKeep();
    if (!$('sheet-archive').hidden) renderArchive();
    if (!$('sheet-paywall').hidden && K.access.unlimited()) { closeSheet('paywall'); K.fx.toast('Unlimited unlocked. Keep flying.'); }
  }

  /* ------------------------------------------------------------ archive calendar */
  let calY = 0, calM = 0;
  function renderArchive() {
    const data = K.storage.data;
    const today = K.game.today;
    const L = K.CONFIG.LAUNCH;
    if (!calY) { const t = K.date.dateOfFlight(Math.max(1, today)); calY = t.getUTCFullYear(); calM = t.getUTCMonth(); }
    const first = new Date(Date.UTC(calY, calM, 1));
    $('cal-month').textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const launchMonth = L.y * 12 + (L.m - 1), shown = calY * 12 + calM;
    const t = K.date.dateOfFlight(Math.max(1, today));
    $('cal-prev').disabled = shown <= launchMonth;
    $('cal-next').disabled = shown >= t.getUTCFullYear() * 12 + t.getUTCMonth();
    const days = new Date(Date.UTC(calY, calM + 1, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const open = K.access.canArchive();
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="cal-dow">${d}</span>`).join('');
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const fn = Math.round((Date.UTC(calY, calM, d) - Date.UTC(L.y, L.m - 1, L.d)) / 864e5) + 1;
      const exists = fn >= 1 && fn <= today && K.daily.get(fn);
      const rec = data.days[fn] && data.days[fn].done ? data.days[fn] : null;
      if (!exists) { cells += `<span class="cal-day off">${d}</span>`; continue; }
      const cls = ['cal-day', fn === today ? 'today' : '', rec ? 'played' : '', !rec && fn !== today && !open ? 'locked' : ''].join(' ');
      const sub = rec ? `<small>${K.units.altText(rec.alt || S.kmOf(rec.pts))}</small>` : fn === today ? '<small>Today</small>' : !open ? '<small class="lock"></small>' : '<small>#' + fn + '</small>';
      cells += `<button type="button" class="${cls}" data-n="${fn}"><b>${d}</b>${sub}</button>`;
    }
    $('cal-grid').innerHTML = cells;
    $('cal-key').textContent = open ? 'Tap any day to fly it. Archive flights don’t affect your streak.' : 'Played days show your score. Unlock Unlimited to fly any past day.';
    $('cal-grid').querySelectorAll('button[data-n]').forEach((b) => {
      b.onclick = () => { closeSheet('archive'); setTimeout(() => K.game.playDay(Number(b.dataset.n)), 200); };
    });
  }

  /* ------------------------------------------------------------ paywall */
  function renderPaywall() {
    $('pay-price').textContent = K.CONFIG.PRICE;
    $('gsi-slot').hidden = true;
    $('btn-buy').hidden = false;
    $('code-form').hidden = true;
  }

  async function startGoogle(kind) {
    const C = K.CONFIG;
    if (!C.PAYMENTS) {
      if (!C.DEV || K.LIVE) { K.fx.toast('Payments are coming soon.'); return; }   // never simulate on the real site
      if (kind === 'restore') { K.fx.toast('Dev mode: no purchase to restore.'); return; }
      K.access.simulatePurchase();               // dev: pretend Stripe said yes
      K.fx.toast('Dev mode: purchase simulated.');
      refreshAccess();
      return;
    }
    $('btn-buy').hidden = true;
    const slot = $('gsi-slot');
    slot.hidden = false;
    slot.innerHTML = '';
    try {
      const token = await K.access.googleButton(slot);
      const res = await K.access.buyWith(token);
      if (res === 'restored') { K.fx.toast('Purchase restored. Welcome back.'); refreshAccess(); }
    } catch (e) {
      K.fx.toast('Couldn’t reach checkout. Try again in a moment.');
      renderPaywall();
    }
  }

  /* ------------------------------------------------------------ closed */
  function closed({ kind, n }) {
    if (kind === 'prelaunch') {
      $('closed-title').textContent = 'First flight soon';
      $('closed-copy').textContent = `KÁRMÁN launches on ${K.date.formatLong(K.date.dateOfFlight(1))}. One flight a day, the same for everyone.`;
    } else {
      $('closed-title').textContent = 'The hangar is restocking';
      $('closed-copy').textContent = `Flight #${n} isn't loaded yet. Every question is used only once, so there is no replay today. Check back soon.`;
    }
  }

  /* ------------------------------------------------------------ menu */
  let menuTimer = 0;
  const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
  function renderMenu() {
    const g = K.game, A = K.access;
    const cur = g.mode === 'unlimited' ? 'unlimited' : g.mode === 'archive' ? 'archive' : 'today';
    document.querySelectorAll('.menu-tile[data-menu]').forEach((t) => t.removeAttribute('aria-current'));
    document.querySelector(`.menu-tile[data-menu="${cur}"]`).setAttribute('aria-current', 'page');
    const flying = current === 'round' && g.phase;
    $('mt-today').textContent = cur === 'today' ? (flying ? 'Flying' : current === 'results' ? 'Landed' : 'Now') : `#${g.today}`;
    const price = '';   // no prices on the menu: the unlock page says it
    const un = document.querySelector('.menu-tile[data-menu="unlimited"]');
    const ar = document.querySelector('.menu-tile[data-menu="archive"]');
    un.classList.remove('locked');   // tiles look the same either way; the unlock page explains
    ar.classList.remove('locked');
    $('mt-unlimited').outerHTML = `<span id="mt-unlimited">${cur === 'unlimited' ? '<span class="mt-meta">Flying</span>' : A.unlimited() ? '' : A.freeRunLeft() ? '<span class="mt-meta">1 free run</span>' : price}</span>`;
    $('mt-archive').outerHTML = `<span id="mt-archive">${cur === 'archive' ? '<span class="mt-meta">Flying</span>' : A.canArchive() ? '' : price}</span>`;
    $('menu-contact').href = $('contact-link').href;
    $('btn-units').setAttribute('aria-checked', String(K.units.system() !== 'imperial'));
    $('btn-sound').setAttribute('aria-checked', String(K.audio.enabled()));
    renderResume();
  }
  /** "Flight #4 in progress · Leg 3 of 7 · 18 s left", ticking while the menu is open. */
  function renderResume() {
    const g = K.game;
    const btn = $('menu-resume');
    const on = current === 'round' && (g.phase === 'round' || g.phase === 'reveal');
    btn.hidden = !on;
    if (!on) return;
    const total = K.CONFIG.ROUND_SECONDS;
    const left = g.remaining();
    const sec = left == null ? 0 : Math.ceil(left);
    $('mr-title').textContent = g.mode === 'unlimited' ? 'Unlimited run' : `Flight #${g.flightNo} in progress`;
    $('mr-sub').textContent = g.phase === 'reveal' ? `Leg ${g.leg + 1} of ${K.CONFIG.LEGS} · answer waiting`
      : `Leg ${g.leg + 1} of ${K.CONFIG.LEGS} · ${sec} s left`;
    $('mr-sec').textContent = g.phase === 'reveal' ? '✓' : String(sec);
    btn.style.setProperty('--left', g.phase === 'reveal' ? '1' : (left / total).toFixed(3));
    btn.classList.toggle('t-mid', g.phase === 'round' && sec <= 15 && sec > 5);
    btn.classList.toggle('t-low', g.phase === 'round' && sec <= 5);
  }

  /* ------------------------------------------------------------ sheets */
  function openSheet(name) {
    const el = $(`sheet-${name}`);
    if (name === 'logbook') renderLogbook();
    if (name === 'help') renderHelp();
    if (name === 'archive') { calY = 0; renderArchive(); }
    if (name === 'paywall') renderPaywall();
    if (name === 'menu') { renderMenu(); menuTimer = setInterval(renderResume, 250); $('btn-menu').setAttribute('aria-expanded', 'true'); }
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('open');
    document.body.classList.add('sheet-open');
    // Focus the sheet itself (keyboard users tab from there) so no button wears a focus ring on open.
    const sheet = el.querySelector('.sheet');
    sheet.setAttribute('tabindex', '-1');
    sheet.scrollTop = 0;
    sheet.focus({ preventScroll: true });
  }
  function closeSheet(name) {
    const el = $(`sheet-${name}`);
    if (name === 'menu') { clearInterval(menuTimer); $('btn-menu').setAttribute('aria-expanded', 'false'); }
    el.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => { el.hidden = true; }, 320);
  }

  /** Help copy comes from the scoring constants so it can never drift.
      The ticket's stub says where closing it takes you. */
  function renderHelp() {
    $('help-space').textContent = `Every hit lifts you. ${K.units.altText(100)} up is the Kármán line, where space begins; ${K.units.altText(S.MAX_KM)} is the ceiling.`;
    $('help-ladder').innerHTML = S.CHIPS.map((c) => `<span class="lad" style="--c:var(--c-${c.key})"><b>${K.units.climbText(c.km)}</b><i></i><em>${c.name}</em></span>`).join('');
    const g = K.game;
    const flying = current === 'round' && g.phase;
    const [small, big] = flying ? ['Back to', `Leg ${g.leg + 1}`]
      : current === 'results' ? ['Back to', 'Log']
      : ['Gate', g.mode === 'unlimited' ? '∞' : `#${g.flightNo || g.today || 1}`];
    $('help-stub').innerHTML = `<small>${small}</small><b>${esc(big)}</b>`;
  }

  /* ------------------------------------------------------------ logbook
     A pilot's folio: a licence card, the passport page, an instrument
     calibration strip and the last seven flights as little ticket stubs. */
  const CAL_TARGET = [85, 70, 50, 30, 15];          // a sensible hit rate for each width
  const seeded = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
  const balloonGlyph = (on) => `<svg viewBox="0 0 16 20" class="th${on ? ' on' : ''}" aria-hidden="true"><path d="M8 1C4 1 1.5 4 1.5 7.5c0 3 2.6 5.6 4.6 7.2h3.8c2-1.6 4.6-4.2 4.6-7.2C14.5 4 12 1 8 1z"/><rect x="5.6" y="15.8" width="4.8" height="3" rx=".8"/></svg>`;

  function gauge(km) {
    // 270° arc: 0 km at the bottom-left, 100 km at the bottom-right (log-ish like the sky).
    const f = Math.min(1, K.scene.fOf(km) / K.scene.fOf(100));
    const r = 34, c = 2 * Math.PI * r, arc = c * 0.75;
    return `<svg viewBox="0 0 84 84" class="lic-gauge" aria-hidden="true">
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(30,42,85,.15)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${arc} ${c}" transform="rotate(135 42 42)"/>
      <circle class="lic-fill" cx="42" cy="42" r="${r}" fill="none" stroke="#FFB547" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(arc * f).toFixed(1)} ${c}" transform="rotate(135 42 42)"/>
    </svg>`;
  }

  function renderLogbook() {
    const data = K.storage.data;
    const st = K.game.streakNow();
    const counts = data.stampCounts || {};
    const days = Object.values(data.days).filter((d) => d.done).sort((a, b) => a.n - b.n);
    const since = days.length ? K.date.dateOfFlight(days[0].n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() : 'TODAY';
    const pilotNo = String(Math.abs(seeded(data.device || 'x')) % 10000).padStart(4, '0');
    $('logbook-sub').textContent = `PILOT Nº ${pilotNo} · SINCE ${since}`;

    // Licence
    const best = data.stats.bestAlt || 0;
    const top = [...S.MILESTONES].reverse().find((m) => counts[m.id]);
    const licence = `<div class="licence">
      <div class="lic-strip">PILOT LICENCE · KÁRMÁN AIR</div>
      <div class="lic-body">
        <div class="lic-g">${gauge(best)}<div class="lic-gv">${best ? `<b>${best.toFixed(best < 10 ? 1 : 0)}</b><span>BEST KM</span>` : '<b>0</b><span>GROUNDED</span>'}</div></div>
        <div class="lic-grid">
          <div><b>${data.stats.flights || '—'}</b><span>Flights</span></div>
          <div><b>${st.cur || '—'}</b><span>Streak</span></div>
          <div><b>${data.streak.best || '—'}</b><span>Longest</span></div>
          <div><span class="ths">${balloonGlyph(data.streak.thermals >= 1)}${balloonGlyph(data.streak.thermals >= 2)}</span><span>Thermals</span></div>
        </div>
      </div>
      ${top ? `<div class="lic-seal">${ink(top.id, S.tierIndex(counts[top.id]), { rot: 12 })}</div>` : ''}
    </div>`;

    // Passport
    const got = S.MILESTONES.filter((m) => counts[m.id]).length;
    const book = S.MILESTONES.map((m) => {
      const c = counts[m.id] || 0;
      const rot = (seeded(m.id) % 9);
      if (!c) return `<div class="sb-item locked"><span class="sb-ghost">${kmLabel(m.km)}<small>km</small></span><span class="sb-name">${esc(m.name)}</span></div>`;
      const tier = S.tierIndex(c), next = S.nextTier(c);
      const prevAt = S.STAMP_TIERS[tier - 1].at;
      const prog = next ? (c - prevAt) / (next.at - prevAt) : 1;
      const R = 39, C = 2 * Math.PI * R;
      return `<div class="sb-item"><span class="sb-stamp">
          <svg viewBox="0 0 84 84" class="sb-ring" aria-hidden="true"><circle cx="42" cy="42" r="${R}" fill="none" stroke="rgba(30,42,85,.12)" stroke-width="3"/>
          <circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--ink-${Math.min(5, tier + (next ? 1 : 0))})" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(C * prog).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/></svg>
          ${ink(m.id, tier, { rot })}</span>
        <span class="sb-name">${esc(m.name)}</span><span class="sb-meta">${next ? `${c} / ${next.at}` : `${c} · ${S.STAMP_TIERS[4].name.toUpperCase()}`}</span></div>`;
    }).join('');
    const legend = S.STAMP_TIERS.map((t, i) => `<span><i style="background:var(--ink-${i + 1})"></i>${t.name} ${t.at}+</span>`).join('');
    const passport = `<div class="pp-page">
      <div class="pp-head"><span>VISAS</span><span>${got} / ${S.MILESTONES.length}</span></div>
      ${got ? '' : '<p class="pp-empty">Your first stamp is 2 km up.</p>'}
      <div class="stamp-book">${book}</div>
      <div class="pp-legend">${legend}</div>
      <button type="button" class="pp-stamp" id="btn-pp-share" aria-label="Copy your passport as an image">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs><path id="pp-arc" d="M18,50 a32,32 0 1,1 64,0"/><path id="pp-arc2" d="M22,52 a28,28 0 0,0 56,0"/></defs>
          <circle cx="50" cy="50" r="46" class="pps-ring"/><circle cx="50" cy="50" r="39" class="pps-ring thin"/>
          <text class="pps-txt"><textPath href="#pp-arc" startOffset="50%" text-anchor="middle">COPY · SHARE</textPath></text>
          <text class="pps-txt"><textPath href="#pp-arc2" startOffset="50%" text-anchor="middle">PASSPORT</textPath></text>
          <path d="M41 41h16v16H41zM45 37h14a2 2 0 0 1 2 2v14" class="pps-ico"/>
        </svg>
      </button>
    </div>`;

    // Calibration
    let verdict = '', worst = 0;
    const calib = S.CHIPS.map((c, i) => {
      const [h, a] = data.stats.chip[i] || [0, 0];
      const pct = a ? Math.round((h / a) * 100) : 0;
      if (a >= 3) {
        const d = pct - CAL_TARGET[i];
        if (Math.abs(d) > Math.abs(worst) && Math.abs(d) >= 20) {
          worst = d;
          verdict = d > 0
            ? `${c.name} lands ${pct}% of the time. You're underselling yourself${i < 4 ? `; try ${S.CHIPS[i + 1].name}.` : '.'}`
            : `${c.name} lands only ${pct}%. You're overreaching${i > 0 ? `; try ${S.CHIPS[i - 1].name}.` : '.'}`;
        }
      }
      return `<div class="cal-row${a ? '' : ' unused'}" style="--c:var(--c-${c.key})">
        <span class="cal-name"><i></i>${c.name}</span>
        <span class="cal-track"><i class="cal-fill" style="width:${a ? pct : 0}%"></i><i class="cal-tick" style="left:${CAL_TARGET[i]}%"></i></span>
        <span class="cal-val">${a ? `<b>${pct}%</b><small>${h}/${a}</small>` : '<b>—</b>'}</span></div>`;
    }).join('');
    if (!verdict) verdict = data.stats.flights ? 'The tick on each line is a healthy hit rate for that width.' : 'Fly a few flights to calibrate your instruments.';

    // Flight strips
    const strips = days.slice(-7).reverse().map((d) => {
      const date = K.date.dateOfFlight(d.n).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
      const dots = d.rounds.map((r) => (r.hit
        ? `<i class="${r.clue ? 'clue' : ''}" style="background:var(--c-${S.CHIPS[r.chip].key})"></i>`
        : `<i class="m${r.clue ? ' clue' : ''}"></i>`)).join('');
      const crossed = S.MILESTONES.some((m) => d.maxAlt >= m.km);
      return `<li class="fstrip"><span class="fs-main"><span class="fs-id">#${d.n} · ${date}</span><span class="fs-dots">${dots}</span></span>
        <span class="fs-stub"><b>${(d.alt || 0).toFixed(1)}</b><small>KM${crossed ? ' ✦' : ''}</small></span></li>`;
    }).join('');

    $('logbook-body').innerHTML = `
      ${licence}
      <h3 class="lb-h">Passport</h3>
      ${passport}
      <h3 class="lb-h">Instrument calibration</h3>
      <div class="cal">${calib}</div>
      <p class="lb-note">${esc(verdict)}</p>
      <h3 class="lb-h">Flight strips</h3>
      <ul class="fstrips">${strips || '<li class="fstrip ghost"><span class="fs-main"><span class="fs-id">NO FLIGHTS LOGGED</span></span><span class="fs-stub"></span></li>'}</ul>`;
  }

  /* ------------------------------------------------------------ dev strip */
  function dev({ n, onFlight, onWipe }) {
    const el = $('dev');
    if (!K.CONFIG.DEV) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>Dev</span><button type="button" data-d="-1" aria-label="Previous flight">‹</button><b>#${n}</b>` +
      `<button type="button" data-d="1" aria-label="Next flight">›</button><button type="button" class="wipe">Wipe save</button>`;
    el.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => onFlight(n + Number(b.dataset.d)); });
    const wipe = el.querySelector('.wipe');
    wipe.onclick = () => {
      if (wipe.dataset.armed) { onWipe(); return; }
      wipe.dataset.armed = '1';
      wipe.textContent = 'Tap again to wipe';
      setTimeout(() => { delete wipe.dataset.armed; wipe.textContent = 'Wipe save'; }, 2500);
    };
  }

  function init() {
    odo = new K.fx.Odometer($('odo'));
    odo.set('0.0', { instant: true });
    // The card resizes with a transition (results are taller on desktop): re-seat the balloon once it settles.
    $('dock').addEventListener('transitionend', (e) => { if (e.target.id === 'dock' && e.propertyName === 'height') anchorBalloon(); });
    // Phones size the round card by its content (a clue can add two lines mid-leg): re-seat the balloon when it grows.
    if (window.ResizeObserver) new ResizeObserver(() => { if (current === 'round' && !$('dock').classList.contains('away')) anchorBalloon(); }).observe($('dock'));
    document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeSheet(b.dataset.close); });
    document.querySelectorAll('.sheet-wrap').forEach((w) => {
      w.addEventListener('click', (e) => { if (e.target === w) closeSheet(w.id.replace('sheet-', '')); });
    });
    window.addEventListener('resize', () => { fitHome(); anchorBalloon(true); });
    if (document.fonts) document.fonts.ready.then(fitHome);
  }

  return {
    init, show, topbar, setAltitude, home, results, closed, prepareLaunch, dockReady, dockIn, refreshAccess, startGoogle,
    calStep(d) { calM += d; if (calM < 0) { calM = 11; calY -= 1; } if (calM > 11) { calM = 0; calY += 1; } renderArchive(); },
    openSheet, closeSheet, dev, anchorBalloon, renderMenu,
    get lastRecord() { return lastRecord; },
    ICONS, pilotNo: () => String(Math.abs(seeded(K.storage.data.device || 'x')) % 10000).padStart(4, '0'), get lastStats() { return lastStats; },
    get current() { return current; },
  };
})();
