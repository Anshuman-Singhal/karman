/* ==========================================================================
   KÁRMÁN · firstclass.js
   What Unlimited pilots ("first class") get beyond the runs and the archive:

     livery     paint your envelope in Account (prefs.livery, this device)
     new runs   "+N NEW" on the menu and a stamp in the hangar when Monday's
                runs land (runsSeen, this device)
     any run    tap a hole on the run card, or type a run number, to fly it
     run log    best / average / perfect runs and a bar per run, in the Logbook

   The first-class seal on the share card lives in shareimg.js. Everything here
   reads K.access.unlimited() each time, so a revoked pass loses the perks (and
   flies Vermilion again) at once. The pure helpers at the top need no DOM.
   ========================================================================== */

K.fc = (() => {
  const LIVERIES = [
    { id: 'vermilion', name: 'Vermilion', sub: 'House' },
    { id: 'midnight', name: 'Midnight', sub: 'Night mail' },
    { id: 'airmail', name: 'Airmail', sub: 'Par avion' },
    { id: 'gold', name: 'Gold Leaf', sub: 'Charter' },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------------------------------------ pure */
  /** The livery to fly: the pilot's pick while first class, else Vermilion. */
  function liveryOf(prefs, first) {
    const id = prefs && prefs.livery;
    return first && LIVERIES.some((l) => l.id === id) ? id : 'vermilion';
  }
  /** Runs that landed since the pilot last looked and that they haven't flown, lowest first. */
  function freshRuns(total, seen, done) {
    if (seen == null || seen >= total) return [];
    const flown = new Set(done || []);
    const out = [];
    for (let k = Math.max(1, seen + 1); k <= total; k++) if (!flown.has(k)) out.push(k);
    return out;
  }
  /** The run log's numbers, from the saved runs (the latest 50) in the order flown. */
  function runLogStats(runs, done, total) {
    const list = (runs || []).filter((r) => r && r.run && Array.isArray(r.rounds) && Number.isFinite(r.alt))
      .sort((a, b) => (a.at || 0) - (b.at || 0));
    const flown = new Set([...(done || []), ...list.map((r) => r.run)].filter((k) => Number.isInteger(k) && k >= 1 && k <= total));
    if (!list.length) return { n: 0, flown: flown.size, total, list };
    const best = list.reduce((m, r) => (r.alt > m.alt ? r : m), list[0]);
    const avg = list.reduce((s, r) => s + r.alt, 0) / list.length;
    const perfect = list.filter((r) => r.rounds.length && r.rounds.every((x) => x.hit)).length;
    return { n: list.length, flown: flown.size, total, list, best, avg, perfect };
  }
  /** "12", " 12 ", "#12", "Run 12" → 12 when it's a real run; else null. */
  function parseRun(raw, total) {
    const m = String(raw == null ? '' : raw).match(/\d+/);
    const k = m ? Number(m[0]) : NaN;
    return Number.isInteger(k) && k >= 1 && k <= total ? k : null;
  }

  /* ------------------------------------------------------------ state */
  const data = () => K.storage.data;
  const on = () => Boolean(K.access && K.access.unlimited());
  const total = () => (K.game && K.game.runsTotal ? K.game.runsTotal() : ((K.SCHEDULE && K.SCHEDULE.runs) || []).length);
  const livery = () => liveryOf(data().prefs, on());
  function applyLivery() { if (K.vehicle && K.vehicle.setLivery) K.vehicle.setLivery(livery()); }

  /** Every boot: free pilots (and first loads after this shipped) count every
      run as seen, silently, so "new" only ever means new to a first-class pilot. */
  function boot() {
    const d = data(), t = total();
    if (d.runsSeen == null || !on() || d.runsSeen > t) {
      if (d.runsSeen !== t) { d.runsSeen = t; K.storage.save(true); }
    }
    applyLivery();
  }
  const fresh = () => (on() ? freshRuns(total(), data().runsSeen, data().runsDone) : []);
  function markSeen() {
    const d = data(), t = total();
    if (d.runsSeen !== t) { d.runsSeen = t; K.storage.save(true); }
  }

  /* ------------------------------------------------------------ menu */
  /** The Unlimited tile's news: a little inked ticket, "+3 | NEW". */
  function menuBadge() {
    const n = fresh().length;
    return n ? `<span class="mt-new"><b>+${n}</b><span>NEW</span><span class="sr-only"> run${n === 1 ? '' : 's'}</span></span>` : '';
  }

  /* ------------------------------------------------------------ hangar */
  const STAMP_INK = `<svg class="nr-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="nr-ink" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="1" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="15" result="w"/><feColorMatrix in="w" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.2 0 0 0 3.1" result="wm"/>
    <feComposite in="d" in2="wm" operator="in"/></filter></svg>`;
  /** What the hangar needs for this pilot: which runs are fresh, and the bits of the card. */
  function hangar() {
    const first = on(), list = fresh(), n = list.length;
    return {
      first, fresh: list,
      stamp: n ? `${STAMP_INK}<span class="nr-stamp" aria-hidden="true"><b>+${n} NEW</b><small>JUST LANDED</small></span>` : '',
      sub: n ? `Run ${list[0]} just landed` : '',
      foot: (punched, left) => (n ? `<span>${punched} PUNCHED</span><span class="nr-foot"><b>${n} FRESH</b> · ${left} TO GO</span>` : ''),
      picker: first ? `<form class="rc-pick" id="rc-pick" novalidate>
          <span class="rc-hint">Tap a hole to fly it</span>
          <label class="rc-no"><span>Fly run Nº</span><input id="rc-no" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" enterkeyhint="go" placeholder="${Math.min(12, total())}" aria-describedby="rc-hint-n"></label>
          <button type="submit" class="rc-go" aria-label="Fly this run"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
          <span class="sr-only" id="rc-hint-n">Runs 1 to ${total()}</span>
        </form>` : '',
    };
  }
  /** The run-number box: a real run flies it; anything else says what's valid. */
  function bindPicker(root, fly) {
    const form = root.querySelector('#rc-pick');
    if (!form) return;
    const input = form.querySelector('input');
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 3); form.classList.remove('bad'); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const k = parseRun(input.value, total());
      if (k) { input.blur(); fly(k); return; }
      form.classList.remove('bad'); void form.offsetWidth; form.classList.add('bad');
      K.fx.toast(`Runs go from 1 to ${total()}.`);
      input.focus();
    });
  }

  /* ------------------------------------------------------------ account: livery */
  const TICK = '<i class="liv-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></i>';
  function liveryCard() {
    if (!on()) return '';
    const cur = livery();
    const sw = LIVERIES.map((l) => `<button type="button" class="liv-sw${l.id === cur ? ' on' : ''}" data-livery="${l.id}" aria-pressed="${l.id === cur}">
        <span class="liv-win">${K.vehicle && K.vehicle.swatch ? K.vehicle.swatch(l.id) : ''}</span><b>${esc(l.name)}</b><small>${esc(l.sub)}</small>${TICK}</button>`).join('');
    return `<div class="licence liv-card">
      <div class="lic-strip">LIVERY · KÁRMÁN AIR</div>
      <p class="liv-lede">Paint your envelope.</p>
      <div class="liv-grid" role="group" aria-label="Balloon livery">${sw}</div>
      <p class="liv-note">Flies on every flight · shows on your shared cards</p>
    </div>`;
  }
  function bindLivery(root) {
    root.querySelectorAll('.liv-sw[data-livery]').forEach((b) => {
      b.onclick = () => {
        if (!on()) return;
        const id = b.dataset.livery;
        const d = data();
        d.prefs = { ...(d.prefs || {}), livery: id };
        K.storage.save(true);                      // prefs never leave this device
        applyLivery();
        root.querySelectorAll('.liv-sw[data-livery]').forEach((x) => {
          const sel = x === b;
          x.classList.toggle('on', sel);
          x.setAttribute('aria-pressed', String(sel));
        });
        if (K.audio && K.audio.tick) K.audio.tick();
      };
    });
  }

  /* ------------------------------------------------------------ logbook: run log */
  const day = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() : '');
  function chart(st) {
    const U = K.units, W = 330, H = 128, PW = W - 46, base = H - 18, top = 14;
    const ceil = Math.max(K.CONFIG.KARMAN_KM, st.best.alt) * 1.08;
    const y = (km) => base - (Math.max(0, km) / ceil) * (base - top);
    const n = st.n, slot = PW / n, bw = Math.max(2, Math.min(26, slot * 0.62));
    const labels = n <= 16;
    const bars = st.list.map((r, i) => {
      const x = i * slot + (slot - bw) / 2, isB = r === st.best, yt = Math.min(base - 2, y(r.alt));
      const h = base - yt;
      let s = `<rect x="${x.toFixed(1)}" y="${yt.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 3).toFixed(1)}" class="${isB ? 'rl-best' : 'rl-bar'}"/>`;
      if (labels || isB) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" class="rl-x${isB ? ' b' : ''}">${r.run}</text>`;
      if (isB) {
        const v = U.altShown(r.alt), inside = h > 26 && bw >= 18;
        s += `<text x="${(x + bw / 2).toFixed(1)}" y="${(inside ? yt + 17 : yt - 5).toFixed(1)}" text-anchor="middle" class="rl-v">${v}</text>`;
      }
      return s;
    }).join('');
    const yk = y(K.CONFIG.KARMAN_KM), ya = y(st.avg);
    const kl = `<line x1="0" x2="${PW}" y1="${yk.toFixed(1)}" y2="${yk.toFixed(1)}" class="rl-k"/><text x="${W}" y="${(yk + 4).toFixed(1)}" text-anchor="end" class="rl-kt">Kármán</text>`;
    const al = n > 1 ? `<line x1="0" x2="${PW}" y1="${ya.toFixed(1)}" y2="${ya.toFixed(1)}" class="rl-a"/><text x="${W}" y="${(Math.abs(ya - yk) < 12 ? ya + (ya > yk ? 12 : -6) : ya + 3.5).toFixed(1)}" text-anchor="end" class="rl-at">AVG</text>` : '';
    const label = `Altitude of your last ${n} run${n === 1 ? '' : 's'}, in the order flown. Best ${U.altText(st.best.alt)} on Run ${st.best.run}.`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><line x1="0" x2="${PW}" y1="${base}" y2="${base}" class="rl-base"/>${kl}${al}${bars}</svg>`;
  }
  function runLog() {
    if (!on()) return '';
    const d = data(), U = K.units, unit = esc(U.altUnit().toUpperCase());
    const st = runLogStats(d.runs, d.runsDone, total());
    const stat = (v, k, small = '') => `<div><b>${v}${small ? `<small>${small}</small>` : ''}</b><span>${k}</span></div>`;
    const stats = st.n
      ? stat(st.flown, 'Runs', `/${st.total}`) + stat(U.altShown(st.best.alt), 'Best', unit) + stat(U.altShown(st.avg), 'Average', unit) + stat(st.perfect, 'Perfect')
      : stat(st.flown, 'Runs', `/${st.total}`) + stat('—', 'Best') + stat('—', 'Average') + stat('—', 'Perfect');
    const body = st.n
      ? `<div class="rl-chart">${chart(st)}</div>
        <div class="rl-cap"><span>Best · <b>Run ${st.best.run}</b>${st.best.at ? ` · ${esc(day(st.best.at))}` : ''}</span><span>Last ${st.n} run${st.n === 1 ? '' : 's'}</span></div>`
      : '<p class="rl-ghost">No runs logged yet. Your first one lands here.</p>';
    return `<h3 class="lb-h">Unlimited</h3>
      <div class="licence rl-card">
        <div class="lic-strip">RUN LOG · KÁRMÁN AIR</div>
        <div class="rl-stats">${stats}</div>
        ${body}
      </div>`;
  }

  return {
    LIVERIES, liveryOf, freshRuns, runLogStats, parseRun,
    boot, applyLivery, livery, markSeen, fresh, menuBadge, hangar, bindPicker, liveryCard, bindLivery, runLog,
  };
})();
