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
  /* The streak flame, same drawing as the top bar's pill. */
  const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5 5 5.6 5 10.5A5 5 0 0 1 7 12.6c0-2 1-3.6 2.3-4.6.1 1.7.9 3 2.2 3.4C11 8.3 11 5 12 2z"/></svg>';

  /** A round inked stamp; ink colour = tier (1 navy … 4 gold). */
  /* ---- First class marks: a two-colour rubber-stamp seal and a ticket-stub tag.
     Printed, not plated: navy ink + an amber spot colour laid slightly out of
     register, both roughened by the same paper-grain filter the eye expects
     from a hand stamp. Unique ids per call so several can live on one page. */
  let fcN = 0;
  const FC_INF = (() => { // Bernoulli lemniscate, centred on 0,0, half-width 1
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2, d = 1 + Math.sin(t) ** 2;
      pts.push([Math.cos(t) / d, (Math.sin(t) * Math.cos(t)) / d]);
    }
    return (cx, cy, w, h = w) => 'M' + pts.map(([x, y]) => `${(cx + x * w).toFixed(2)},${(cy + y * h * 1.18).toFixed(2)}`).join('L') + 'Z';
  })();
  /* Ink filter: rough edges + worn coverage. Line ink loses a few pinholes and
     thins in patches; a spot fill (spot=1) only mottles, so it never reads glossy. */
  const fcInk = (id, seed, rough = 0.6, spot = 0) => `<filter id="${id}" x="-6%" y="-6%" width="112%" height="112%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="${seed}" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="${rough}" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency="${spot ? 0.06 : 0.09}" numOctaves="2" seed="${seed + 11}" result="w"/>
      <feColorMatrix in="w" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${spot ? '-0.9 0 0 0 1.38' : '-4.2 0 0 0 3.75'}" result="wm"/>
      <feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed="${seed + 23}" result="p"/>
      <feColorMatrix in="p" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -10 0 0 0 7.9" result="pm"/>
      <feComposite in="wm" in2="pm" operator="arithmetic" k1="1" result="m"/>
      <feComposite in="d" in2="m" operator="in"/>
    </filter>`;

  const fcStar = (cx, cy, r) => 'M' + Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.42 : r;
    return `${(cx + Math.cos(a) * q).toFixed(2)},${(cy + Math.sin(a) * q).toFixed(2)}`;
  }).join('L') + 'Z';

  /** The welcome-card seal: ~72–84px. */
  function fcSeal(size = 80) {
    const k = ++fcN, a = `fcA${k}`, b = `fcB${k}`, top = `fcT${k}`, bot = `fcU${k}`;
    return `<svg class="fc-seal" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="First class">
    <defs>${fcInk(a, 3 + k, 1.2, 1)}${fcInk(b, 7 + k, 1.6)}
      <path id="${top}" d="M20,60 a40,40 0 1,1 80,0"/>
      <path id="${bot}" d="M12.2,60 a47.8,47.8 0 0,0 95.6,0"/></defs>
    <g filter="url(#${a})" transform="translate(1.1 -0.9)">
      <circle cx="60" cy="60" r="31.5" fill="#FFB547"/>
    </g>
    <g filter="url(#${b})" fill="none" stroke="#14213D">
      <circle cx="60" cy="60" r="56" stroke-width="3.2"/>
      <circle cx="60" cy="60" r="51.2" stroke-width="0.9"/>
      <circle cx="60" cy="60" r="33.5" stroke-width="1.6"/>
      <path d="${FC_INF(60, 60, 19.5)}" stroke-width="5" stroke-linejoin="round"/>
      <g fill="#14213D" stroke="none">
        <path d="${fcStar(17.4, 60.4, 3.3)}${fcStar(102.6, 60.4, 3.3)}"/>
        <text font-family="'Big Shoulders Display', 'Arial Narrow', sans-serif" font-weight="800" font-size="14.6" letter-spacing="1.7">
          <textPath href="#${top}" startOffset="50%" text-anchor="middle">FIRST CLASS</textPath></text>
        <text font-family="'IBM Plex Mono', ui-monospace, monospace" font-weight="500" font-size="8.6" letter-spacing="1.9">
          <textPath href="#${bot}" startOffset="50%" text-anchor="middle">UNLIMITED</textPath></text>
      </g>
    </g>
  </svg>`;
  }

  /** The compact tag for the licence and the account box: a little class ticket,
      amber stub with ∞, perforated, "FIRST CLASS" printed on the body. ~24px tall. */
  function fcTag(h = 24) {
    const k = ++fcN, a = `fcA${k}`, b = `fcB${k}`;
    const w = Math.round((h * 104) / 26);
    // Ticket outline with notches top and bottom at the perforation (x=27).
    const body = 'M4,1.5 H23.5 a3.5,3.5 0 0,0 7,0 H100 a2.5,2.5 0 0,1 2.5,2.5 V22 a2.5,2.5 0 0,1 -2.5,2.5 H30.5 a3.5,3.5 0 0,0 -7,0 H4 a2.5,2.5 0 0,1 -2.5,-2.5 V4 a2.5,2.5 0 0,1 2.5,-2.5Z';
    return `<svg class="fc-tag" width="${w}" height="${h}" viewBox="0 0 104 26" role="img" aria-label="First class">
    <defs>${fcInk(a, 5 + k, 0.7, 1)}${fcInk(b, 9 + k, 0.8)}<clipPath id="fcC${k}"><path d="${body}"/></clipPath></defs>
    <g filter="url(#${a})" transform="translate(0.7 -0.5)"><rect x="0" y="0" width="27" height="26" fill="#FFB547" clip-path="url(#fcC${k})"/></g>
    <g filter="url(#${b})" fill="none" stroke="#14213D">
      <path d="${body}" stroke-width="1.5"/>
      <path d="M27,6.5 V19.5" stroke-width="1.1" stroke-dasharray="1.6 1.9"/>
      <path d="${FC_INF(14, 13, 7.2)}" stroke-width="2.6" stroke-linejoin="round"/>
      <text x="65" y="18.4" text-anchor="middle" fill="#14213D" stroke="none" font-family="'Big Shoulders Display', 'Arial Narrow', sans-serif" font-weight="800" font-size="15" letter-spacing="1.4" textLength="60" lengthAdjust="spacingAndGlyphs">FIRST CLASS</text>
    </g>
  </svg>`;
  }

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
    if (name !== 'results' && K.climb) K.climb.close({ instant: true, restore: false });
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
  /** The resume tag under Menu: shown off-flight whenever an Unlimited run is parked. */
  function parked(info) {
    const tag = $('parked-tag');
    if (!tag) return;
    tag.hidden = !info;
    document.body.classList.toggle('has-parked', Boolean(info));
    if (info) {
      $('parked-leg').textContent = `Leg ${info.leg}/${K.CONFIG.LEGS}`;
      tag.setAttribute('aria-label', `Resume your Unlimited run, leg ${info.leg} of ${K.CONFIG.LEGS}`);
    }
  }
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

  /** Units toggled: everything that shows an altitude re-renders in place. */
  function refreshUnits() {
    const g = K.game;
    if (g.flightNo && current === 'home' && lastHome) home(lastHome);
    if (current === 'results' && lastRecord) results({ ...lastRecord.args });
    K.scene.refreshCaptions();
    $('alt-unit').textContent = K.units.altUnit();
    if (!$('sheet-help').hidden) renderHelp();
  }
  let lastHome = null;

  /* ------------------------------------------------------------ home */
  function home({ flight, mode = 'daily', streak, thermals, bestAlt }) {
    lastHome = { flight, mode, streak, thermals, bestAlt };
    const d = K.date.dateOfFlight(flight.n);
    const short = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const un = mode === 'unlimited';
    $('home-meta').textContent = un ? `Unlimited · Flight #${flight.flightNo || flight.run}` : mode === 'archive' ? `Archive · ${short}` : `${short} · ${flight.weather.name}`;
    // The visually hidden lead names the game for search engines and screen readers (the page's one h1).
    $('home-h').innerHTML = '<span class="sr-only">Karman, the daily number guessing game. </span>' + (un ? 'Unlimited <span>∞</span>' : `Flight <span>#${flight.n}</span>`);
    // What's at stake (v5). A pilot who has never flown gets the pitch and a time promise;
    // a returning pilot gets today's seven legs (categories only) and the streak on the line.
    const data = K.storage.data || {};
    const sk = data.streak || {};
    const isNew = sk.lastDay == null && !((data.stats && data.stats.flights) > 0);
    const lede = $('home-lede');
    lede.classList.remove('today-legs', 'print');
    if (mode === 'daily' && !isNew && flight.facts && flight.facts.length) {
      lede.classList.add('today-legs');
      lede.innerHTML = '<small>Today’s legs</small> ' + flight.facts.map((f, i) => `<span style="--i:${i}">${esc(f.cat)}</span>`).join(' ');
      if (!K.fx.reduced()) { void lede.offsetWidth; lede.classList.add('print'); }
    } else {
      lede.textContent = un ? 'Seven new questions. No streak on the line, but stamps still count.'
        : mode === 'archive' ? 'A past daily flight. It won’t touch your streak.'
        : `Seven guesses. Climb ${K.units.altText(100)} to the Kármán line, where space begins.`;
    }
    $('launch-no').textContent = un ? '∞' : `#${flight.n}`;
    const td = K.date.dateOfFlight(Math.max(1, K.game.today));
    $('leaf-m').textContent = td.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    $('leaf-d').textContent = td.getUTCDate();
    $('home-status').hidden = mode !== 'daily';
    // Never a zero: no "0 day streak · 0 thermals".
    const parts = [];
    if (!isNew && streak > 0) {
      const flownToday = sk.lastDay != null && sk.lastDay >= flight.n;
      const covering = !flownToday && sk.lastDay != null && flight.n - sk.lastDay > 1;   // a thermal is holding the streak
      const stake = flownToday ? 'flown today' : covering ? 'a thermal is covering you, fly today' : `fly today to make it ${streak + 1}`;
      parts.push(`<span class="stake">${FLAME}<span><b>Day ${streak}</b> · ${stake}</span></span>`);
    }
    if (!isNew && bestAlt > 0) parts.push(`<span>Best <b>${K.units.altText(bestAlt)}</b></span>`);
    if (!parts.length) parts.push('<span>About 3 minutes · no sign-up</span>');
    $('home-status').innerHTML = parts.join('');
    const btn = $('btn-launch');
    btn.disabled = false;
    btn.classList.remove('holding', 'fired', 'pressing', 'glint');
    if (K.ui.onHome) requestAnimationFrame(() => K.ui.onHome());
    requestAnimationFrame(fitHome);   // today's legs can run a line longer than the lede: grow the strip, never clip it   // desktop focus + idle glint (main.js)
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
      : `Today's climbs from 0 to ${K.units.altText(S.MAX_KM)}. You reached ${K.units.altText(S.kmOf(record.pts))}.`;
    return `<svg viewBox="0 0 ${HIST.w} ${HIST.h}" class="hist-svg hist-v" role="img" aria-label="${label}">
      <line x1="${HIST.axis}" x2="${HIST.axis}" y1="${HIST.top}" y2="${HIST.base}" class="h-axis"/>
      ${ticks.join('')}${karman}
      <g class="h-bars">${bars}</g>
      ${you}
    </svg>`;
  }

  /* ------------------------------------------------------------ results: passport row
     The closed passport itself: a navy cover with a gilt rule and the crest,
     today's newest stamp peeking out from the pages. The book lives in the logbook. */
  const CREST = '<svg class="pr-crest" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/><circle cx="20" cy="20" r="15" stroke-dasharray="1.2 2.1"/><path d="M20 8.5c5 0 8.4 3.8 8.4 8.2 0 4-3.6 7.2-6 9.6h-4.8c-2.4-2.4-6-5.6-6-9.6 0-4.4 3.4-8.2 8.4-8.2z"/><path d="M20 8.5c-2.4 3.6-2.6 11.6-1.2 17.8M20 8.5c2.4 3.6 2.6 11.6 1.2 17.8"/><path d="M17.6 26.3l.6 2.6M22.4 26.3l-.6 2.6"/><rect x="17.6" y="28.9" width="4.8" height="3" rx=".8"/></svg>';
  function passportRow(record, isFresh) {
    const pp = record.passport || { stamps: [], slam: null, also: [] };
    const counts = K.storage.data.stampCounts || {};
    const newOnes = pp.stamps.filter((s) => s.first || s.tierUp).length;
    const peek = pp.slam ? `<span class="pr-page" aria-hidden="true">${ink(pp.slam, S.tierIndex(counts[pp.slam] || 1), { rot: -10, slam: isFresh })}</span>` : '';
    const text = !pp.stamps.length ? 'No stamps today · clouds start at 2 km'
      : `${pp.stamps.length} stamp${pp.stamps.length === 1 ? '' : 's'} today${newOnes ? ` · <b>${newOnes} new</b>` : ''}`;
    return `<span class="pr-cover" aria-hidden="true">${CREST}</span><span class="pr-text"><span class="pr-title">Passport</span><span class="pr-sub">${text}</span></span>${peek}<span class="pr-chev" aria-hidden="true"></span>`;
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
    const pts = none ? '—' : r.delta > 0 ? K.units.legText(...S.legSpan(record.rounds, i)) : '0';
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
      <div class="ans-top"><span class="ans-no">${i + 1}</span><p class="ans-q">${esc(K.units.hint(fact.q))}</p><span class="ans-pts">${r.clue ? CLUE_SVG : ''}${pts}</span></div>
      <div class="ans-line">
        ${you}
        ${track}
        <i class="ans-pin" style="left:${L.pin.toFixed(2)}%"></i>
        ${answer}
      </div>
      <p class="ans-fact">${esc(K.units.hint(fact.card))}</p>
    </div>`;
  }

  /** Phone: one tile per leg; tap one to show its row below. Desktop shows all rows. */
  function legStrip(record) {
    const strip = $('legstrip');
    strip.innerHTML = record.rounds.map((r, i) => {
      const c = r.hit ? `var(--c-${S.CHIPS[r.chip].key})` : 'var(--c-miss)';
      const state = r.guess == null ? 'none' : r.hit ? 'hit' : 'miss';
      const pts = r.guess == null ? '—' : r.delta > 0 ? K.units.legText(...S.legSpan(record.rounds, i)).replace(/ (km|mi)$/, '') : '0';
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
    if ((!stats || !stats.players) && K.stats.down) {
      // The crowd's numbers can't be fetched right now: say so, plainly and in
      // the game's voice, with your own altitude on an empty board.
      box.dataset.kind = 'down';
      $('pctl-txt').textContent = 'The crowd chart is in the hangar for repairs. It’ll be back on the board soon.';
      box.setAttribute('aria-label', $('pctl-txt').textContent);
      chart.innerHTML = `${histogram(record, { step: 25, buckets: [] }, true)}<span class="crowd-down" aria-hidden="true">In the<br>hangar</span>`;
      chart.classList.add('is-down');
      // Put the stamp in the biggest clear gap of the chart, never over your bar,
      // its YOU tag, or the Kármán line and its label.
      requestAnimationFrame(() => {
        const st = chart.querySelector('.crowd-down');
        if (!st) return;
        const c = chart.getBoundingClientRect();
        const svg = chart.querySelector('svg');
        const s = svg ? svg.getBoundingClientRect() : c;
        const busy = [...chart.querySelectorAll('.h-you, .h-bar.mine, .h-kline, .h-karman')]
          .map((el) => el.getBoundingClientRect()).filter((r) => r.height || r.width)
          .map((r) => [r.top - c.top - 6, r.bottom - c.top + 6]).sort((a, b) => a[0] - b[0]);
        let best = null, y = s.top - c.top + 4;
        const bottom = s.bottom - c.top - 14;      // keep off the 0 tick
        for (const [a, b] of [...busy, [bottom, bottom]]) {
          if (a - y > (best ? best[1] - best[0] : 0)) best = [y, a];
          y = Math.max(y, b);
        }
        const h = st.offsetHeight;
        const mid = best ? (best[0] + best[1]) / 2 : c.height / 2;
        st.style.top = `${Math.round(Math.max(h / 2, Math.min(c.height - h / 2, mid)))}px`;
        st.classList.toggle('tight', Boolean(best) && best[1] - best[0] < h + 4);
      });
      box.hidden = false;
      const play = () => { chart.classList.add('draw'); };
      if (crowdGate) crowdGate.then(play); else play();
      return;
    }
    chart.classList.remove('is-down');
    if (!stats || !stats.players) { box.hidden = true; chart.innerHTML = ''; return; }
    const players = stats.players;
    const higher = stats.buckets.filter(([from]) => from > record.pts).reduce((a, b) => a + b[1], 0);
    const pct = K.stats.percentile(stats, record.pts);
    let kind = 'rank';
    const runNo = record.mode === 'unlimited' ? record.run : null;
    // No head count: while KÁRMÁN is small, "of today's pilots" reads better than a tiny number.
    const crowd = runNo ? 'the pilots who flew this one' : 'today’s pilots';
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
    box.hidden = false;                         // laid out now, so nothing shifts when it appears
    const el = $('pctl-txt').querySelector('.pctl-inline');
    // Landing reveal: the chart draws and the figure counts on the "compare" beat
    // (or lands drawn at once if the reveal is skipped).
    const play = (instant) => {
      chart.classList.toggle('instant', instant === true);
      void chart.offsetWidth;
      chart.classList.add('draw');
      if (instant === true || kind !== 'rank' || K.fx.reduced() || !el) { if (el) el.textContent = `${pct}%`; return; }
      const t0 = performance.now() + 150;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / 800));
        el.textContent = `${Math.round(pct * (1 - Math.pow(1 - p, 3)))}%`;
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = '0%';
      requestAnimationFrame(step);
    };
    if (crowdGate) { if (el && kind === 'rank') el.textContent = '0%'; crowdGate.then(play); } else play(false);
  }

  /** Fetch today's crowd, then show the percentile. */
  let statsTicket = 0;
  async function applyStats(record, n) {
    const mine = ++statsTicket;
    const stats = await K.stats.get(n);
    if (mine !== statsTicket) return;           // results were reopened meanwhile; the newer fetch wins
    lastStats = stats;
    renderPercentile(record, stats);
    if (K.climb) K.climb.setStats(stats);       // the climb view's summary line
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
    // the light keeps passing over the ticket (every few seconds) until it is tapped
    nudgeTimer = setTimeout(() => btn.classList.add('nudge'), 2400);   // after the landing reveal settles   // the pass never scrolls on its own: the score stays in view
    btn.addEventListener('click', () => { tag.classList.remove('in'); btn.classList.remove('nudge'); }, { once: true });
  }

  function results({ record, n, mode = 'daily', streak, thermals, streakInfo, isFresh, prevBest, nextNo }) {
    if (landingStop) landingStop();
    if (nextNo == null) nextNo = (K.game.today || n) + 1;
    lastRecord = { record, n, streak, mode, args: { record, n, mode, streak, thermals, streakInfo, isFresh: false, prevBest, nextNo } };
    $('dare-stamp').classList.remove('stamped');
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
    // Beat yesterday's daily: "↑ 12 km past yesterday" (the in-flight banner's words), under the tier
    // (read from the saved day, nothing new stored).
    let vs = '';
    const yd = mode === 'daily' && K.storage.data.days && K.storage.data.days[n - 1];
    if (yd && yd.done && (yd.mode || 'daily') === 'daily') {
      const up = K.units.altShown(record.alt) - K.units.altShown(yd.alt);
      if (up >= 1) vs = `<b>↑ ${Math.round(up)} ${K.units.altUnit()}</b> past yesterday`;
    }
    $('res-vs').innerHTML = vs;
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
    nextStub({ mode, streak, nextNo });
    if (K.climb) K.climb.set(record);          // the sky behind the pass can replay the climb
  }

  /* ------------------------------------------------------------ results: next flight
     The come-back hook as an object: tomorrow's number, a live clock (game.js
     startCountdown writes #next-clock), tomorrow's sky (deterministic, no spoiler)
     and, on the daily flight, the streak on the line. */
  function nextStub({ mode, streak, nextNo }) {
    $('next-no').textContent = `#${nextNo}`;
    const sky = K.daily.weatherFor(nextNo).name;
    $('next-sky').textContent = `Tomorrow’s sky: ${sky.charAt(0).toLowerCase()}${sky.slice(1)}`;
    const chip = $('next-streak');
    chip.hidden = !(mode === 'daily' && streak > 0);
    chip.innerHTML = chip.hidden ? '' : `${FLAME}<span aria-hidden="true">${streak} → ${streak + 1}</span><span class="sr-only">${streak}-day streak; fly tomorrow to make it ${streak + 1}</span>`;
  }

  /* ------------------------------------------------------------ results: landing reveal
     A freshly finished flight lands in beats instead of one frame (~2.4 s):
       0     the pass rises (existing screen entry)
       420   count: the altitude rolls up from 0, a soft tick every 10
       1300  name: the tier word stamps in (and a space flight's burst fires)
       1560  compare: the crowd chart draws, the percentile counts up
       1860  act: Share, the legs and the next-flight stub rise; the streak pill flips
       2400  settled
     Any pointerdown/keydown jumps to the final state without eating the event, so a
     tap on Share both skips and shares. Reduced motion: final state at once. */
  let landingStop = null;
  let crowdGate = null;
  function landing(record, { prevStreak = null, streak = 0, onStamp = null } = {}) {
    if (landingStop) landingStop();
    const s = $('screen-results'), alt = $('res-alt');
    const pill = $('btn-streak'), count = $('streak-count');
    const final = alt.textContent;
    const to = Number(final) || 0;
    let stamped = false;
    const stamp = () => { if (stamped) return; stamped = true; if (onStamp) onStamp(); };
    const flips = prevStreak != null && prevStreak !== streak;
    if (K.fx.reduced()) { stamp(); return; }

    let done = false, raf = 0, openGate = null;
    const timers = [];
    crowdGate = new Promise((r) => { openGate = r; });
    const skip = (e) => {
      if (e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return;
      finish();   // no preventDefault, no stopPropagation: the tap still lands
    };
    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', skip, true);
      document.removeEventListener('keydown', skip, true);
      alt.textContent = final;
      s.classList.remove('landing', 'l-tier', 'l-crowd', 'l-act');
      if (flips) count.textContent = streak;
      stamp();
      landingStop = null;
      crowdGate = null;
      openGate(true);
    }
    landingStop = finish;
    document.addEventListener('pointerdown', skip, true);
    document.addEventListener('keydown', skip, true);

    s.classList.add('landing');
    alt.textContent = '0';
    if (flips) count.textContent = prevStreak;
    const at = (ms, fn) => timers.push(setTimeout(() => { if (!done) fn(); }, ms));
    at(420, () => {                                     // count
      const t0 = performance.now();
      let lastStep = 0;
      const step = 10;
      const f = (now) => {
        if (done) return;
        const p = Math.min(1, (now - t0) / 880);
        const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
        alt.textContent = p < 1 ? String(v) : final;
        if (Math.floor(v / step) > lastStep) { lastStep = Math.floor(v / step); if (K.audio.tick) K.audio.tick(); }
        if (p < 1) raf = requestAnimationFrame(f);
      };
      raf = requestAnimationFrame(f);
    });
    at(1300, () => {                                    // name
      s.classList.add('l-tier');
      if (K.audio.stamp) K.audio.stamp();
      if (K.fx.nudge) K.fx.nudge();
      stamp();
    });
    at(1560, () => { s.classList.add('l-crowd'); openGate(false); });   // compare
    at(1860, () => {                                    // act
      s.classList.add('l-act');
      if (flips) {
        count.textContent = streak;
        pill.classList.remove('flip'); void pill.offsetWidth; pill.classList.add('flip');
        setTimeout(() => pill.classList.remove('flip'), 700);
      }
    });
    at(2400, finish);
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
    // Owned: just the title, centred, and UNLIMITED on the stub.
    $('keep-sub').textContent = A.unlimited() ? ''
      : A.freeRunLeft() ? 'Your first Unlimited run is free' : `Unlimited · ${K.CONFIG.PRICE} once`;
    $('keep-sub').hidden = A.unlimited();
    $('btn-keep').classList.toggle('owned', A.unlimited());
    $('keep-stub').innerHTML = A.unlimited() ? 'Unlimited'
      : A.freeRunLeft() ? 'FREE' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
  }

  /** Anything that shows locked/unlocked state, after access changes. */
  function refreshAccess() {
    paintKeep();
    if (!$('sheet-archive').hidden) renderArchive();
    if (!$('sheet-paywall').hidden && K.access.unlimited()) { closeSheet('paywall'); if (Date.now() - welcomedAt > 3000) K.fx.toast('Unlimited unlocked. Keep flying.'); }
    if (!$('sheet-account').hidden) renderAccount();
    renderMenuAcct();
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

  /* ------------------------------------------------------------ Unlimited hangar
     A boarding ticket for a run you've never flown (never a silent repeat),
     the run card (every run, the ones you've flown punched through), then a
     flight strip per run flown, newest first; tap a strip to fly it again. */
  function nextMonday() {
    const t = new Date();
    const d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() + (((8 - t.getDay()) % 7) || 7)));
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
  }
  function renderRuns() {
    const d = K.storage.data;
    const total = K.game.runsTotal(), leftList = K.game.runsLeft(), left = leftList.length;
    const done = new Set((d.runsDone || []).filter((k) => k >= 1 && k <= total));
    const byRun = new Map();
    for (const r of d.runs || []) {
      if (!r || !r.run || !r.rounds) continue;
      const was = byRun.get(r.run);
      byRun.set(r.run, {
        run: r.run, at: Math.max(r.at || 0, was ? was.at : 0), times: (was ? was.times : 0) + 1,
        best: was && (was.best.alt || 0) >= (r.alt || 0) ? was.best : r,
      });
    }
    const flown = [...byRun.values()].sort((a, b) => b.at - a.at);
    $('runs-sub').textContent = `${total} RUNS · NEW ONES EVERY MONDAY`;
    const day = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() : '');
    const ticket = left
      ? `<button type="button" class="buy-ticket runs-new" id="runs-new">
          <span class="bt-main"><span class="rn-main">Fly a new run</span><span class="rn-sub">7 questions you haven’t seen</span></span>
          <span class="bt-stub"><small>NEW</small><b>${left}</b></span></button>`
      : `<div class="runs-new runs-wait" role="status">
          <span class="bt-main"><span class="rn-main">All runs flown</span><span class="rn-sub">New runs land every Monday</span></span>
          <span class="bt-stub"><small>NEXT</small><b>${nextMonday().replace(/^(\w+) /, '$1<br>')}</b></span></div>`;
    const holes = Array.from({ length: total }, (_, i) => i + 1)
      .map((k) => `<i class="${done.has(k) ? 'on' : ''}" title="Run ${k}${done.has(k) ? ' · flown' : ''}">${k}</i>`).join('');
    const card = `<div class="licence run-card">
        <div class="lic-strip">RUN CARD · KÁRMÁN AIR</div>
        <div class="rc-holes" aria-label="${done.size} of ${total} runs flown">${holes}</div>
        <div class="rc-foot"><span>${done.size} PUNCHED</span><span>${left} TO GO</span></div>
      </div>`;
    const strips = flown.map((x) => {
      const dots = x.best.rounds.map((r) => (r.hit
        ? `<i class="${r.clue ? 'clue' : ''}" style="background:var(--c-${S.CHIPS[r.chip] ? S.CHIPS[r.chip].key : 'fair'})"></i>`
        : `<i class="m${r.clue ? ' clue' : ''}"></i>`)).join('');
      const alt = K.units.altShown(x.best.alt || 0);
      return `<li><button type="button" class="fstrip rs" data-run="${x.run}" aria-label="Fly run ${x.run} again. Best ${esc(K.units.altText(x.best.alt || 0))}.">
        <span class="fs-main"><span class="fs-id">RUN ${x.run} · ${esc(day(x.at))}${x.times > 1 ? ` · ×${x.times}` : ''}</span>
          <span class="fs-row"><span class="fs-dots">${dots}</span><span class="rs-again"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3"/><path d="M4 18.2v-4.6h4.6"/></svg>Fly again</span></span></span>
        <span class="fs-stub"><b>${alt}</b><small>${K.units.altUnit().toUpperCase()}</small></span></button></li>`;
    }).join('');
    $('runs-body').innerHTML = `${ticket}
      ${card}
      ${flown.length ? `<h3 class="lb-h">Flight strips</h3><ul class="fstrips runs-strips">${strips}</ul>
        <p class="lb-note">Tap a strip to fly that run again: the same seven questions, a fresh climb.</p>` : ''}`;
    if ($('runs-new')) $('runs-new').onclick = () => { closeSheet('runs'); setTimeout(() => K.game.keepFlying(), K.fx.reduced() ? 0 : 200); };
    $('runs-body').querySelectorAll('[data-run]').forEach((b) => {
      b.onclick = () => { closeSheet('runs'); setTimeout(() => K.game.flyRun(Number(b.dataset.run)), K.fx.reduced() ? 0 : 200); };
    });
  }

  /* ------------------------------------------------------------ welcome aboard
     Shown once, at the moment Unlimited arrives: a thank-you for buyers, a
     warm hello for pass holders, what's now theirs, and a direct line. */
  let welcomedAt = 0;
  /** kind: 'paid' | 'pass'. opts.replay: opened again from the Account box. */
  function welcome(kind, opts = {}) {
    welcomedAt = Date.now();
    if (!opts.replay) { K.storage.data.access.welcomed = true; K.storage.save(); }   // once per device
    const paid = kind === 'paid';
    const total = K.game.runsTotal(), left = K.game.runsLeft().length;
    const mail = esc(K.CONFIG.CONTACT_EMAIL);
    $('welcome-body').innerHTML = `
      <div class="wel-card">
        <div class="lic-strip">BOARDING PASS · KÁRMÁN AIR</div>
        <span class="wel-foil" aria-hidden="true">${fcSeal(80)}</span>
        <p class="wel-eyebrow">PILOT Nº ${esc(String(K.ui.pilotNo()))}</p>
        <h2 class="wel-h" id="wel-h">${paid ? 'Thank you.' : 'Welcome aboard.'}</h2>
        <p class="wel-lede">${paid ? 'Unlimited is yours, for good. Welcome to KÁRMÁN Air’s first-class cabin: a small crew of pilots with the whole sky open to them.' : 'Someone gave you a free pass: Unlimited is yours on this device. Enjoy every run.'}</p>
        <ul class="wel-perks">
          <li><i aria-hidden="true">∞</i><span><b>${left ? `${left} Unlimited runs` : 'Every Unlimited run'}</b>${left ? ' to fly' : ''}, seven new questions each. New runs land every Monday.</span></li>
          <li><i aria-hidden="true">◷</i><span><b>The whole archive.</b> Every daily flight since Flight #1, from the calendar on the home screen.</span></li>
          <li><i aria-hidden="true">✉</i><span><b>A direct line.</b> Ideas? A wrong answer? A question you’d love to see on a flight: <a href="mailto:${mail}?subject=${encodeURIComponent('KÁRMÁN Unlimited')}">${mail}</a>.</span></li>
        </ul>
      </div>
      <button type="button" class="buy-ticket wel-go" id="wel-go"><span class="bt-main">${opts.replay ? 'Fly a run' : 'Fly your first run'}</span><span class="bt-stub"><small>${left ? 'NEW' : 'RUNS'}</small><b>${left || '∞'}</b></span></button>
      <p class="wel-fine">${paid ? 'Find it any time under Menu → Unlimited.' : 'Find it any time under Menu → Unlimited.'}</p>`;
    $('wel-go').onclick = () => { closeSheet('welcome'); setTimeout(() => K.game.keepFlying(), K.fx.reduced() ? 0 : 220); };
    ['paywall', 'account', 'menu'].forEach((s) => { if (!$(`sheet-${s}`).hidden) closeSheet(s); });
    setTimeout(() => openSheet('welcome'), K.fx.reduced() ? 0 : 260);
    if (paid && !opts.replay) K.audio.stamp();
  }
  /** Pilots who had Unlimited before the welcome card existed (or bought on
      another device) see it once, the next time they open the game, never
      in the middle of a flight. */
  function maybeWelcome() {
    const a = K.storage.data.access || {};
    if (!a.unlimited || a.welcomed || current === 'round') return;
    if (document.querySelector('.sheet-wrap:not([hidden])')) return;
    welcome(a.via === 'code' ? 'pass' : 'paid');
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
      welcome('paid');
      refreshAccess();
      return;
    }
    $('btn-buy').hidden = true;
    const slot = $('gsi-slot');
    slot.hidden = false;
    slot.innerHTML = `<p class="gsi-lead">${kind === 'restore' ? 'Sign in with the Google account you bought with.' : 'Sign in with Google to pay. Your unlock and your logbook follow that account to any device.'}</p><div class="gsi-btn"></div>`;
    try {
      const token = await K.access.googleButton(slot.querySelector('.gsi-btn'));
      slot.querySelector('.gsi-lead').textContent = kind === 'restore' ? 'Looking for your purchase…' : 'Opening secure checkout…';
      const res = await K.access.buyWith(token, kind === 'restore');
      if (res === 'restored') { K.fx.toast('Purchase restored. Welcome back.'); refreshAccess(); }
      else if (res === 'none') { K.fx.toast('No purchase on that Google account. Your logbook is backed up to it now.'); renderPaywall(); renderAccount(); }
    } catch (e) {
      K.fx.toast(e && e.status === 503 ? 'Stripe is busy. Try again in a moment; you won’t be charged twice.' : 'Couldn’t reach checkout. Try again in a moment.');
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
    const pk = K.storage.data.parked && K.storage.data.parked.unlimited;
    $('mt-unlimited').outerHTML = `<span id="mt-unlimited">${cur === 'unlimited' ? '<span class="mt-meta">Flying</span>' : pk ? `<span class="mt-meta">Resume · leg ${(pk.round || 0) + 1}</span>` : A.unlimited() ? '' : A.freeRunLeft() ? '<span class="mt-meta">1 free run</span>' : price}</span>`;
    $('mt-archive').outerHTML = `<span id="mt-archive">${cur === 'archive' ? '<span class="mt-meta">Flying</span>' : A.canArchive() ? '' : price}</span>`;
    $('menu-contact').href = $('contact-link').href;
    $('btn-units').setAttribute('aria-checked', String(K.units.system() !== 'imperial'));
    $('btn-sound').setAttribute('aria-checked', String(K.audio.enabled()));
    renderResume();
    renderMenuAcct();
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
    if (name === 'account') renderAccount();
    if (name === 'help') renderHelp();
    if (name === 'archive') { calY = 0; renderArchive(); }
    if (name === 'runs') renderRuns();
    if (name === 'paywall') { renderPaywall(); try { if (!K.access.unlimited()) K.stats.event('paywall_view'); } catch (e) { /* stats never block the paywall */ } }
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

  /* ------------------------------------------------------------ account
     Status, not history: who you are, what you own, where your progress is
     kept. History lives in the logbook, one tap away. */
  const ago = (t) => {
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 50) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  function accountState() {
    const d = K.storage.data, a = d.access || {};
    const signed = Boolean(a.session && a.session !== 'dev');
    const owned = K.access.unlimited();
    const plan = owned
      ? (a.via === 'code' ? { k: 'Unlimited', v: 'Unlocked by link', tone: 'on' } : { k: 'Unlimited', v: a.paidAt ? `Owned · since ${new Date(a.paidAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Owned · one-time purchase', tone: 'on' })
      : a.pending ? { k: 'Unlimited', v: 'Payment confirming…', tone: 'wait' }
      : { k: 'Free pilot', v: K.access.freeRunLeft() ? 'Daily flight · 1 free Unlimited run left' : 'Daily flight, every day', tone: 'off' };
    const sync = d.sync && d.sync.at;
    const backup = signed ? (sync ? `Saved to your Google account · ${ago(sync)}` : 'Saving to your Google account…') : 'On this device only';
    return { d, a, signed, owned, plan, backup };
  }
  function renderMenuAcct() {
    const { a, signed, owned } = accountState();
    $('ma-badge').innerHTML = signed && a.email ? esc(a.email[0].toUpperCase()) : '<svg viewBox="0 0 24 24"><path d="M12 3.5c-4 0-6.5 2.9-6.5 6.4 0 2.7 2.2 5 3.9 6.3h5.2c1.7-1.3 3.9-3.6 3.9-6.3 0-3.5-2.5-6.4-6.5-6.4z"/><rect x="10" y="18.5" width="4" height="2.6" rx=".6"/></svg>';
    $('ma-badge').classList.toggle('on', owned);
    $('ma-title').textContent = `Pilot Nº ${K.ui.pilotNo()}`;
    $('ma-sub').textContent = [owned ? 'Unlimited' : 'Free', signed ? 'Backed up' : 'Not backed up'].join(' · ');
  }
  function renderAccount() {
    if (!$('account-body')) return;
    const { d, a, signed, owned, plan, backup } = accountState();
    const st = K.game.streakNow();
    const flown = Object.values(d.days).filter((x) => x.done).length + (d.runs || []).length;
    const stamps = S.MILESTONES.filter((m) => (d.stampCounts || {})[m.id]).length;
    const best = d.stats.bestAlt || 0;
    $('account-sub').textContent = `PILOT Nº ${K.ui.pilotNo()}`;
    const row = (k, v, tone = '') => `<div class="ac-row ${tone}"><span class="ac-k">${k}</span><span class="ac-v">${v}</span></div>`;
    const payments = K.CONFIG.PAYMENTS;
    $('account-body').innerHTML = `
      <div class="ac-card">
        <div class="lic-strip">PILOT RECORD · KÁRMÁN AIR</div>
        ${row('Google', signed ? esc(a.email || 'Signed in') : 'Not signed in')}
        ${row(plan.k, esc(plan.v), plan.tone)}
        ${row('Progress', esc(backup), signed ? 'on' : '')}
      </div>
      ${signed ? '' : `<div class="ac-cta">
        <p class="ac-lead">Back up your flights, streak and stamps to Google and pick them up on any device. Free, no purchase needed.</p>
        ${payments ? '<div class="gsi" id="ac-gsi"><div class="gsi-btn"></div></div>' : '<p class="ac-lead">Backups arrive with sign-in soon.</p>'}
      </div>`}
      <button type="button" class="ac-log" id="ac-logbook">
        <span class="ac-stats"><span><b>${flown}</b>Flights</span><span><b>${st.cur}</b>Streak</span><span><b>${best ? best.toFixed(best < 10 ? 1 : 0) : 0}</b>Best km</span><span><b>${stamps}/${S.MILESTONES.length}</b>Stamps</span></span>
        <span class="ac-go">Open logbook <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>
      </button>
      ${owned ? `<div class="ac-thanks"><span class="lic-fc" aria-hidden="true">${fcTag()}</span>
        <p>${a.via === 'code' ? 'Enjoy every run.' : 'Thank you for flying first class.'} Ideas? A wrong answer? A question you’d love to see on a flight: <a href="mailto:${esc(K.CONFIG.CONTACT_EMAIL)}?subject=${encodeURIComponent('KÁRMÁN Unlimited')}">${esc(K.CONFIG.CONTACT_EMAIL)}</a></p>
        <a class="ac-suggest" href="mailto:${esc(K.CONFIG.CONTACT_EMAIL)}?subject=${encodeURIComponent('A question for a flight')}&body=${encodeURIComponent('Question:\nAnswer (with units):\nSource link:\n')}">Suggest a question <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
        <button type="button" class="ac-welcome" id="ac-welcome">See your welcome card</button></div>` : ''}
      ${owned ? '' : `<button type="button" class="buy-ticket ac-buy" id="ac-buy"><span class="bt-main">Unlock Unlimited</span><span class="bt-stub"><b>${esc(K.CONFIG.PRICE)}</b><small>ONE-TIME</small></span></button>`}
      <div class="ac-links">
        ${signed ? '<button type="button" class="link-btn" id="ac-sync">Back up now</button>' : ''}
        ${!owned && payments ? '<button type="button" class="link-btn" id="ac-restore">Bought on another account or device? Restore</button>' : ''}
        ${signed ? '<button type="button" class="link-btn" id="ac-signout">Sign out on this device</button>' : ''}
      </div>
      <p class="pay-fine">${owned && a.via === 'stripe' ? 'Refunds: refundable if you haven’t flown an Unlimited or archive flight since buying. ' : ''}Questions or a refund? <a href="mailto:${esc(K.CONFIG.CONTACT_EMAIL)}">${esc(K.CONFIG.CONTACT_EMAIL)}</a><br>Signing out keeps everything on this device. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms</a></p>`;
    $('ac-logbook').onclick = () => { closeSheet('account'); setTimeout(() => openSheet('logbook'), K.fx.reduced() ? 0 : 200); };
    if ($('ac-welcome')) $('ac-welcome').onclick = () => welcome(a.via === 'code' ? 'pass' : 'paid', { replay: true });
    if ($('ac-buy')) $('ac-buy').onclick = () => { closeSheet('account'); setTimeout(() => openSheet('paywall'), K.fx.reduced() ? 0 : 200); };
    if ($('ac-restore')) $('ac-restore').onclick = () => { closeSheet('account'); setTimeout(() => { openSheet('paywall'); startGoogle('restore'); }, K.fx.reduced() ? 0 : 200); };
    if ($('ac-sync')) $('ac-sync').onclick = async (e) => {
      e.currentTarget.textContent = 'Backing up…';
      await K.access.afterSignIn();
      K.fx.toast(K.storage.data.sync && Date.now() - K.storage.data.sync.at < 15000 ? 'Backed up to your Google account.' : 'Couldn’t reach the cloud. Your progress is safe on this device.');
      renderAccount();
    };
    if ($('ac-signout')) $('ac-signout').onclick = () => {
      K.access.signOut();
      K.fx.toast('Signed out on this device. Your progress and unlock stay here.');
      renderAccount(); renderMenuAcct();
    };
    if ($('ac-gsi')) {
      K.access.googleButton($('ac-gsi').querySelector('.gsi-btn')).then(async (token) => {
        $('ac-gsi').innerHTML = '<p class="gsi-lead">Signing in and backing up…</p>';
        try {
          const res = await K.access.buyWith(token, true);
          K.fx.toast(res === 'restored' ? 'Signed in. Your Unlimited purchase is restored.' : 'Signed in. Your progress is backed up.');
          refreshAccess();
        } catch (err) { K.fx.toast('Couldn’t sign in just now. Try again in a moment.'); }
        renderAccount(); renderMenuAcct();
      }).catch(() => { if ($('ac-gsi')) $('ac-gsi').innerHTML = '<p class="gsi-lead">Google sign-in couldn’t load. Check your connection.</p>'; });
    }
  }

  function renderLogbook() {
    const data = K.storage.data;
    const st = K.game.streakNow();
    const counts = data.stampCounts || {};
    const days = Object.values(data.days).filter((d) => d.done).sort((a, b) => a.n - b.n);
    const since = days.length ? K.date.dateOfFlight(days[0].n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() : 'TODAY';
    const pilotNo = K.ui.pilotNo();
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
      ${K.access.unlimited() ? '<span class="lic-fc" title="Unlimited: first class">' + fcTag() + '</span>' : ''}
    </div>`;

    // Passport
    const got = S.MILESTONES.filter((m) => counts[m.id]).length;
    // The next visa reads as a goal: an amber arc filled to Best / its altitude,
    // and how far past Best it sits (the rail marks the same visa in flight).
    const goal = S.MILESTONES.find((m) => !counts[m.id]);
    const book = S.MILESTONES.map((m) => {
      const c = counts[m.id] || 0;
      const rot = (seeded(m.id) % 9);
      if (!c && m === goal) {
        const p = Math.max(0, Math.min(0.97, best / m.km));
        const gap = m.km - best;
        const gapText = K.units.altText(gap, K.units.altVal(gap) < 1 ? { decimals: 1 } : {});
        const R = 39, C = 2 * Math.PI * R;
        return `<div class="sb-item locked goal"><span class="sb-ghost">
          <svg viewBox="0 0 84 84" class="sb-goal" aria-hidden="true"><circle cx="42" cy="42" r="${R}" fill="none" stroke-width="3" stroke-linecap="round" style="--len:${(C * p).toFixed(1)};--c:${C.toFixed(1)}" transform="rotate(-90 42 42)"/></svg>
          ${kmLabel(m.km)}<small>km</small></span><span class="sb-name">${esc(m.name)}</span><span class="sb-meta sb-gap">${best > 0 ? `${esc(gapText)} past your best` : `${esc(gapText)} up`}</span></div>`;
      }
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

  return { parked, answerRow, welcome, maybeWelcome,
    init, show, topbar, setAltitude, home, results, landing, closed, prepareLaunch, dockReady, dockIn, refreshAccess, startGoogle, renderAccount,
    calStep(d) { calM += d; if (calM < 0) { calM = 11; calY -= 1; } if (calM > 11) { calM = 0; calY += 1; } renderArchive(); },
    openSheet, closeSheet, dev, anchorBalloon, renderMenu, refreshUnits,
    get lastRecord() { return lastRecord; },
    ICONS, pilotNo: () => String(Math.abs(seeded(K.storage.data.pilot || K.storage.data.device || 'x')) % 10000).padStart(4, '0'), get lastStats() { return lastStats; },
    get current() { return current; },
  };
})();
