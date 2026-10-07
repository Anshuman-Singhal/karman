/* ==========================================================================
   KÁRMÁN · scene.js
   The sky world behind the interface. One requestAnimationFrame loop drives:
     • the camera (displayed altitude), eased toward the target altitude
     • the sky gradient, stars and Earth's curve, all keyed to altitude
     • world landmarks and clouds, placed at real altitudes
     • the craft (drawn by vehicle.js): placement, bob and sway
     • the altimeter rail on the left edge

   ALTITUDE → SCREEN
   Real altitude is compressed with a log curve, f(km), so the first few
   kilometres (clouds, Everest, airliners) get as much screen travel as the
   empty stretch from 50 to 100 km. f(0) = 0 and f(120) = 1.
   ========================================================================== */

K.scene = (() => {
  const SKY_MAX_KM = 120;
  const fOf = (km) => Math.log(1 + Math.max(0, km) / 1.5) / Math.log(1 + SKY_MAX_KM / 1.5);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* Sky colours by altitude: [km, top, middle, bottom]. The 0 km bottom is
     replaced by the day's weather horizon colour. */
  const SKY = [
    [0,   '#4E78B8', '#93B8E0', '#F2BE94'],
    [2,   '#3C7CD0', '#7FB2E6', '#BFDDF5'],
    [11,  '#2856AA', '#5C93DA', '#93C2EE'],
    [20,  '#1A3A88', '#3768BD', '#5E93D6'],
    [39,  '#101C52', '#213F8C', '#3B67B4'],
    [60,  '#090E2C', '#141F55', '#22397A'],
    [100, '#03040C', '#070A1F', '#0E1840'],
  ];

  /* Gore count by width chip: tighter bet, tighter stripes. */
  const GORES_BY_CHIP = [9, 12, 12, 15, 18];   // multiples of 3 for the ember-ember-paper pattern

  /* ---- state ---- */
  let W = 0, H = 0, span = 0;
  let anchorY = 0, anchorTarget = 0;   // screen y of the basket's bottom
  let balloonPx = 150;                 // rendered balloon height
  let liftPx = 0, liftFrom = 0, liftTo = 0, liftT0 = 0, liftDur = 900, liftEase = null;
  let liftResolve = null;
  /* On the ground the balloon sits lower, basket resting on the meadow.
     Lift-off raises it to its flying position while the ground falls away. */
  const GROUND_DROP = 54;
  let perch = 0, perchFrom = 0;
  /* How far the ground has dropped once airborne: the meadow ends up well
     below the card, so the take-off reads as a real climb. */
  const flyPx = () => Math.round(clamp(H * 0.34, 180, 320));
  const cam = { km: 0, from: 0, to: 0, t0: 0, dur: 1 };
  let climbResolve = null;
  let items = [];
  let crossed = new Set();
  let pbKm = 0, pbAnnounced = false;
  let weather = null;
  let onCross = () => {};
  const flame = { level: 0.2, target: 0.2, boost: 0 };
  let lastNow = 0;
  let stamped = {};

  /* ---- DOM refs ---- */
  let skyEl, starsEl, worldEl, frontEl, earthEl, rigEl, svgEl, sunEl;
  let railEl, railBug, railFill, railGhost, railTicks = [];

  /* ========================================================== world items */
  function addItem(km, html, cls, layer = worldEl) {
    const el = document.createElement('div');
    el.className = `w-item ${cls || ''}`;
    el.innerHTML = html;
    layer.appendChild(el);
    const item = { km, el };
    items.push(item);
    return item;
  }

  function cloudSVG(rand) {
    const puffs = 5 + Math.floor(rand() * 4);
    let circles = '';
    for (let i = 0; i < puffs; i++) {
      const x = 30 + (i / (puffs - 1)) * 140 + (rand() - 0.5) * 16;
      const r = 18 + rand() * 22 * (1 - Math.abs(i / (puffs - 1) - 0.5));
      circles += `<circle cx="${x.toFixed(1)}" cy="${(62 - r * 0.55).toFixed(1)}" r="${r.toFixed(1)}"/>`;
    }
    return `<svg viewBox="0 0 200 80" class="cloud-svg"><g fill="var(--cloud)">${circles}<rect x="24" y="52" width="152" height="16" rx="8"/></g><rect x="24" y="60" width="152" height="8" rx="4" fill="var(--cloud-shade)"/></svg>`;
  }

  /* The launch meadow. Drawn for a 1000×300 box where the ground line (where
     the basket rests) is y≈95 at the centre. Layers go back to front with
     atmospheric haze, so distance reads at a glance: far ridges in the day's
     horizon colour, a river catching the sky, sunlit grass up close, a mown
     launch circle, tree clumps, a windsock and a few festival balloons far off. */
  function hillsSVG() {
    const rand = K.rng.fromLabel('karman-hills');
    const ridge = (base, amp, freq, phase, jag) => {
      let d = `M0,300 L0,${base}`;
      for (let x = 0; x <= 1000; x += 20) {
        const y = base - Math.sin(x / freq + phase) * amp - Math.sin(x / (freq * 0.37) + phase * 2) * amp * 0.35 - rand() * jag;
        d += ` L${x},${y.toFixed(1)}`;
      }
      return `${d} L1000,300Z`;
    };
    // Near meadow: flat around the launch circle (x≈500), rising gently to the sides.
    let near = 'M0,300 L0,84';
    for (let x = 0; x <= 1000; x += 20) {
      const dx = (x - 500) / 500;
      const y = 95 - Math.pow(Math.abs(dx), 1.6) * 16 + Math.sin(x / 47) * 1.2;
      near += ` L${x},${y.toFixed(1)}`;
    }
    near += ' L1000,300Z';

    const tree = (x, y, s, dark) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})">
        <rect x="-0.6" y="-2" width="1.2" height="4" fill="#2A2418"/>
        <circle cx="0" cy="-5" r="4.2" fill="${dark}"/><circle cx="-2.4" cy="-3.6" r="3" fill="${dark}"/><circle cx="2.6" cy="-3.4" r="3.1" fill="${dark}"/>
        <circle cx="-1.2" cy="-6.4" r="2" fill="#6F8F52" opacity=".55"/></g>`;
    let trees = '';
    const clump = (cx, n, spread) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * spread;
        const dx = (x - 500) / 500;
        const y = 95 - Math.pow(Math.abs(dx), 1.6) * 16 + 1.5;
        trees += tree(x, y, 1.2 + rand() * 1.1, rand() < 0.5 ? '#24412F' : '#2E4F36');
      }
    };
    clump(395, 7, 60); clump(615, 6, 50); clump(250, 9, 120); clump(780, 8, 110); clump(120, 6, 80); clump(905, 6, 80);

    // Distant festival balloons over the far ridges.
    const tiny = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" opacity=".8">
        <path d="M0,-9 C6,-9 7,-3 4,1 L1.5,4 L-1.5,4 L-4,1 C-7,-3 -6,-9 0,-9Z" fill="${c}"/>
        <path d="M0,-9 C2,-9 2.4,-3 1.3,1 L0.5,4 L-0.5,4 L-1.3,1 C-2.4,-3 -2,-9 0,-9Z" fill="#F3E9D6" opacity=".7"/>
        <rect x="-1.2" y="5" width="2.4" height="2" fill="#5A3720"/></g>`;

    return `<svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMin slice" class="hills">
      <defs>
        <linearGradient id="g-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E86B4"/><stop offset=".5" stop-color="var(--horizon)" stop-opacity=".55"/><stop offset="1" stop-color="#6E86B4"/></linearGradient>
        <linearGradient id="g-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C7A6A"/><stop offset=".35" stop-color="#355E55"/><stop offset="1" stop-color="var(--hill-mid)"/></linearGradient>
        <linearGradient id="g-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FA65E"/><stop offset=".06" stop-color="#5E7F45"/><stop offset=".3" stop-color="#3A5E3F"/><stop offset=".75" stop-color="var(--hill-near)"/></linearGradient>
        <linearGradient id="g-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--haze)" stop-opacity="0"/><stop offset=".5" stop-color="var(--haze)" stop-opacity=".45"/><stop offset="1" stop-color="var(--haze)" stop-opacity="0"/></linearGradient>
        <linearGradient id="g-river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--horizon)" stop-opacity=".9"/><stop offset="1" stop-color="#9DBBE0" stop-opacity=".7"/></linearGradient>
      </defs>
      ${tiny(560, 26, 1.1, '#E2574C')}${tiny(612, 38, 0.8, '#3E78C2')}${tiny(300, 22, 1, '#F2B33D')}${tiny(720, 30, 0.9, '#6CB38E')}
      <path d="${ridge(52, 12, 120, 0.4, 3)}" fill="url(#g-far)"/>
      <rect x="0" y="48" width="1000" height="30" fill="url(#g-mist)"/>
      <path d="${ridge(74, 7, 90, 2.1, 1.5)}" fill="url(#g-mid)"/>
      <path d="M0,86 C140,80 220,92 330,85 S520,80 600,86 S800,92 1000,84 L1000,88 C800,96 700,90 600,90 S420,86 330,90 S120,86 0,90Z" fill="url(#g-river)" opacity=".75"/>
      <rect x="0" y="70" width="1000" height="22" fill="url(#g-mist)" opacity=".7"/>
      <path d="${near}" fill="url(#g-near)"/>
      <path d="M0,104 Q500,92 1000,104 M0,112 Q500,100 1000,112 M0,121 Q500,109 1000,121" stroke="#6F8F52" stroke-opacity=".18" stroke-width="1" fill="none"/>
      <ellipse cx="500" cy="96.5" rx="38" ry="4.2" fill="#A9BC72" opacity=".38"/>
      <ellipse cx="500" cy="96.5" rx="24" ry="2.6" fill="none" stroke="#E8E0C4" stroke-opacity=".35" stroke-width=".7"/>
      ${trees}
      <g transform="translate(548 96)"><line x1="0" y1="0" x2="0" y2="-20" stroke="#C9C2B4" stroke-width="1.2"/><path class="windsock" d="M0,-20 L13,-18 L13,-14.5 L0,-12.5Z" fill="var(--amber-deep)"/><path d="M4.3,-19.4 L4.3,-13.2 M8.6,-18.7 L8.6,-13.8" stroke="#F3E9D6" stroke-width="1.2"/></g>
    </svg>`;
  }

  const label = (text) => `<span class="w-label">${text}</span>`;

  /* ========================================================== sights on the way up
     Something to pass at every stage of the climb. Two kinds:
       towers  stand on the ground, their tops at their real height
               (the log camera means you pass the Pyramid's tip first)
       flyers  cross the sky at their altitude, on a loop
     Fiction is limited to public-domain legend (Babel, the beanstalk). */
  const SIGHT_INK = '#2B3858';
  const TOWERS = [
    { km: 0.139, name: 'Great Pyramid · 139 m', side: 'left', x: 4, w: 120, ar: 0.7, svg: `<svg viewBox="0 0 100 70" preserveAspectRatio="none"><path d="M0,70 L50,0 L100,70Z" fill="#C9A46A"/><path d="M50,0 L100,70 L58,70Z" fill="#A27C48"/><path d="M14,50 H86 M28,30 H72" stroke="#B48F58" stroke-width="1"/></svg>` },
    { km: 0.330, name: 'Eiffel Tower · 330 m', side: 'right', x: 6, w: 64, ar: 2.5, svg: `<svg viewBox="0 0 40 100" preserveAspectRatio="none"><path d="M20,0 L21,8 L23,30 L27,52 L33,72 L40,100 L32,100 Q20,80 8,100 L0,100 L7,72 L13,52 L17,30 L19,8Z" fill="${SIGHT_INK}"/><path d="M13,52 H27 M8,72 H32 M17,30 H23" stroke="#465679" stroke-width="2"/></svg>` },
    { km: 0.828, name: 'Burj Khalifa · 828 m', side: 'left', x: 8, w: 22, ar: 10, svg: `<svg viewBox="0 0 30 300" preserveAspectRatio="none"><path d="M15,0 L16,40 L18,80 L20,130 L23,190 L26,250 L30,300 L0,300 L4,250 L7,190 L10,130 L12,80 L14,40Z" fill="#9FB3CC"/><path d="M15,0 L16,40 L18,80 L20,130 L23,190 L26,250 L30,300 L15,300Z" fill="#7F94B0"/></svg>` },
    { km: 1.6, name: 'Tower of Babel · legend', side: 'right', x: 4, w: 80, ar: 1.6, svg: `<svg viewBox="0 0 100 160" preserveAspectRatio="none"><path d="M0,160 L8,128 L92,128 L100,160Z M10,128 L18,98 L82,98 L90,128Z M20,98 L27,70 L73,70 L80,98Z M29,70 L35,46 L65,46 L71,70Z M37,46 L42,26 L58,26 L63,46Z M44,26 L47,10 L53,10 L56,26Z" fill="#B98D5E"/><path d="M8,128 L92,98 M18,98 L82,70 M27,70 L73,46 M35,46 L65,26" stroke="#8E6A43" stroke-width="2"/><path d="M50,128 V160 M50,98 V128" stroke="#8E6A43" stroke-width="1"/></svg>` },
    { km: 2.6, name: 'The beanstalk · fairy tale', side: 'left', x: 10, w: 24, ar: 10, svg: `<svg viewBox="0 0 40 400" preserveAspectRatio="none"><path d="M20,400 C4,360 36,320 20,280 C4,240 36,200 20,160 C4,120 36,80 20,40 C14,24 22,10 20,0" fill="none" stroke="#4F8A3A" stroke-width="5"/><g fill="#6BAA4E"><ellipse cx="30" cy="340" rx="8" ry="3"/><ellipse cx="10" cy="260" rx="8" ry="3"/><ellipse cx="30" cy="180" rx="8" ry="3"/><ellipse cx="10" cy="100" rx="8" ry="3"/><ellipse cx="28" cy="30" rx="7" ry="3"/></g></svg>` },
  ];
  const plane = (fill) => `<svg viewBox="0 0 60 20"><path d="M2,10 L44,8 C52,8 58,9 58,10 C58,11 52,12 44,12 L2,10Z M24,9 L14,1 L19,1 L32,9Z M24,11 L14,19 L19,19 L32,11Z M5,10 L1,4 L4,4 L10,9Z" fill="${fill}"/></svg>`;
  const FLYERS = [
    { km: 0.6, name: 'Paraglider', dur: 70, dir: 1, w: 34, svg: `<svg viewBox="0 0 40 34"><path d="M2,8 Q20,-4 38,8 L36,11 Q20,2 4,11Z" fill="#E86A4B"/><path d="M5,10 L19,28 M35,10 L21,28 M14,6 L19,28 M26,6 L21,28" stroke="#E9EEF7" stroke-width=".6"/><circle cx="20" cy="30" r="2.6" fill="#2B3858"/></svg>` },
    { km: 7.3, name: 'Bar-headed geese · over the Himalaya', dur: 46, dir: -1, w: 54, svg: `<svg viewBox="0 0 60 24" fill="none" stroke="#24304E" stroke-width="1.6" stroke-linecap="round"><path d="M4,6 l4,3 4,-3 M16,12 l4,3 4,-3 M28,18 l4,3 4,-3 M16,2 l4,3 4,-3 M28,8 l4,3 4,-3"/></svg>` },
    { km: 11.3, name: 'Rüppell’s vulture · highest bird', dur: 58, dir: 1, w: 40, svg: `<svg viewBox="0 0 44 16"><path d="M0,9 Q10,2 20,8 L22,6 L24,8 Q34,2 44,9 Q34,7 25,11 L22,14 L19,11 Q10,7 0,9Z" fill="#3A2E28"/></svg>` },
    { km: 13.5, name: 'Business jets', dur: 30, dir: -1, w: 34, svg: plane('#DCE4F2') },
    { km: 15.5, name: 'Weather balloon', dur: 120, dir: 1, w: 18, svg: `<svg viewBox="0 0 20 40"><circle cx="10" cy="9" r="8" fill="#F4F6FA"/><path d="M10,17 V33" stroke="#F4F6FA" stroke-width=".7"/><rect x="7" y="33" width="6" height="5" fill="#E86A4B"/></svg>` },
    { km: 18, name: 'Concorde · 18 km, Mach 2', dur: 14, dir: -1, w: 58, svg: `<svg viewBox="0 0 70 16"><path d="M0,9 L10,7 L44,6 L60,2 L66,2 L60,7 L70,8 L60,9 L66,14 L60,14 L44,10 L10,10Z" fill="#F2F4F8"/></svg>` },
    { km: 21, name: 'U-2 spy plane', dur: 40, dir: 1, w: 60, svg: `<svg viewBox="0 0 70 14"><path d="M4,7 L60,6 Q66,6 68,7 Q66,8 60,8 L4,8Z M30,6.5 L8,1 L36,6.5Z M30,7.5 L8,13 L36,7.5Z M6,7 L2,3 L5,3 L9,7Z" fill="#20283E"/></svg>` },
    { km: 25.9, name: 'SR-71 Blackbird · fastest jet', dur: 9, dir: -1, w: 60, svg: `<svg viewBox="0 0 70 18"><path d="M0,9 L22,7 L40,3 L52,3 L66,8 L70,9 L66,10 L52,15 L40,15 L22,11Z" fill="#0F1422"/><path d="M50,3 L56,0 L58,3Z M50,15 L56,18 L58,15Z" fill="#0F1422"/></svg>` },
    { km: 35, name: 'Weather balloons burst · ~35 km', dur: 140, dir: 1, w: 24, svg: `<svg viewBox="0 0 30 30" stroke="#F4F6FA" stroke-width="1.4" stroke-linecap="round"><path d="M15,3 V9 M15,21 V27 M3,15 H9 M21,15 H27 M6,6 L10,10 M20,20 L24,24 M24,6 L20,10 M6,24 L10,20"/></svg>` },
    { km: 53, name: 'Highest balloon ever · 53 km', dur: 160, dir: -1, w: 22, svg: `<svg viewBox="0 0 24 50"><path d="M12,1 C22,1 23,14 16,24 L13,34 L11,34 L8,24 C1,14 2,1 12,1Z" fill="#DCE6F5" fill-opacity=".35" stroke="#F3E9D6" stroke-width=".8"/><path d="M12,34 V44" stroke="#F3E9D6" stroke-width=".6"/><rect x="9.5" y="44" width="5" height="4" fill="#FFB547"/></svg>` },
    { km: 103, name: 'ISS · orbits at ~400 km', dur: 26, dir: 1, w: 56, svg: `<svg viewBox="0 0 60 30"><rect x="4" y="13" width="52" height="3" fill="#C9D3E3"/><g fill="#1E2A55" stroke="#FFB547" stroke-width=".4"><rect x="6" y="2" width="9" height="11"/><rect x="6" y="16" width="9" height="11"/><rect x="45" y="2" width="9" height="11"/><rect x="45" y="16" width="9" height="11"/></g><rect x="24" y="10" width="12" height="9" rx="2" fill="#E9EEF7"/></svg>` },
  ];
  const BANDS = [
    { km: 70, name: 'Sprites · red lightning · 50–90 km', cls: 'sprites' },
    { km: 83, name: 'Noctilucent clouds · 83 km', cls: 'nlc' },
  ];

  function buildSights() {
    TOWERS.forEach((t) => {
      // Drawn at its natural shape; tall ones show only their top, fading into
      // the haze below, so the launch meadow stays clean.
      const natural = t.w * t.ar;
      const shown = Math.min(natural, 210);
      const pos = t.side === 'left' ? `left:${t.x}%` : `right:${t.x}%`;
      addItem(t.km, `<div class="tower ${t.side}" style="${pos};width:${t.w}px"><div class="tower-clip${shown < natural ? ' fade' : ''}" style="height:${shown.toFixed(0)}px"><span class="tower-art" style="height:${natural.toFixed(0)}px">${t.svg}</span></div>${label(t.name)}</div>`, 'sight');
    });
    // The cloud castle at the top of the beanstalk.
    addItem(2.6, `<div class="castle"><svg viewBox="0 0 120 70"><g fill="#F7F3EE"><ellipse cx="60" cy="56" rx="58" ry="12"/><ellipse cx="30" cy="50" rx="24" ry="12"/><ellipse cx="88" cy="50" rx="28" ry="13"/></g>
      <g fill="#C9CFDF"><rect x="38" y="22" width="44" height="28"/><rect x="32" y="12" width="10" height="38"/><rect x="78" y="12" width="10" height="38"/><rect x="55" y="6" width="10" height="44"/></g>
      <g fill="#8E97B3"><path d="M32,12 L37,4 L42,12Z M78,12 L83,4 L88,12Z M55,6 L60,-2 L65,6Z"/><rect x="56" y="36" width="8" height="14" rx="4"/></g></svg>${label('Castle in the clouds')}</div>`, 'sight');
    FLYERS.forEach((f, i) => {
      const delay = -((i * 13.7) % f.dur);
      addItem(f.km, `<div class="flyer ${f.dir < 0 ? 'rtl' : ''}" style="--dur:${f.dur}s;--delay:${delay.toFixed(1)}s;width:${f.w}px"><span class="flyer-art">${f.svg}</span>${label(f.name)}</div>`, 'sight');
    });
    BANDS.forEach((b) => addItem(b.km, `<div class="${b.cls}"></div>${label(b.name)}`, 'band-item'));
  }

  function buildWorld() {
    worldEl.innerHTML = '';
    frontEl.innerHTML = '';
    items = [];

    addItem(0, hillsSVG(), 'ground');
    addItem(8.849, `<div class="peak"><svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMin meet">
        <defs><linearGradient id="peak-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#DCE6F5"/><stop offset=".25" stop-color="#9DB3D4"/><stop offset="1" stop-color="#9DB3D4" stop-opacity="0"/></linearGradient></defs>
        <path d="M150,0 L196,70 L214,64 L300,420 L0,420 L86,92 L112,60Z" fill="url(#peak-fade)"/>
        <path d="M150,0 L196,70 L178,78 L160,58 L140,84 L112,60Z" fill="#F4F8FF"/></svg>${label('Everest · 8,849 m')}</div>`, 'landmark right');
    addItem(11, `<div class="plane-lane"><div class="plane"><span class="contrail"></span>
        <svg viewBox="0 0 60 20"><path d="M2,10 L44,8 C52,8 58,9 58,10 C58,11 52,12 44,12 L2,10Z M24,9 L14,1 L19,1 L32,9Z M24,11 L14,19 L19,19 L32,11Z M5,10 L1,4 L4,4 L10,9Z" fill="#E9EEF7"/></svg></div>
        ${label('Airliners · 11 km')}</div>`, 'landmark');
    addItem(20, `<div class="ozone"></div>${label('Ozone layer · 20 km')}`, 'band-item');
    buildSights();
    addItem(39, `<div class="diver"><span class="diver-trail"></span>
        <svg viewBox="0 0 20 20"><circle cx="10" cy="4" r="3" fill="#F2E6CF"/><path d="M10,7 L10,13 M10,9 L4,6 M10,9 L16,6 M10,13 L6,19 M10,13 L14,19" stroke="#F2E6CF" stroke-width="2" stroke-linecap="round"/></svg>
        ${label('Record skydive · 39 km')}</div>`, 'landmark left');
    addItem(50, `<div class="w-line"></div>${label('Stratopause · 50 km')}`, 'line-item');
    addItem(100, `<div class="w-line karman"></div><span class="w-label karman-label">Kármán line · 100 km · space</span>`, 'line-item karman-item');
    if (pbKm > 0.5) {
      addItem(pbKm, `<div class="w-line pb"></div>${label(`Your best · ${pbKm.toFixed(1)} km`)}`, 'line-item pb-item');
    }

    // Clouds: a deck around 2 km (the "cloud break") plus scattered puffs.
    const rand = K.rng.fromLabel(`karman-clouds-${weather ? weather.name : ''}-${K.game ? K.game.flightNo : 0}`);
    const count = weather ? weather.clouds : 10;
    for (let i = 0; i < count; i++) {
      const inDeck = i < Math.ceil(count * 0.55);
      const km = inDeck ? 1.45 + rand() * 1.1 : 0.5 * Math.pow(26, rand());
      const x = rand() * 100;
      const scale = 0.55 + rand() * 1.1;
      const front = inDeck && rand() < 0.4;
      const dur = 70 + rand() * 90;
      const html = `<div class="cloud" style="left:${x.toFixed(1)}%;--s:${scale.toFixed(2)};--drift:${dur.toFixed(0)}s;--dir:${rand() < 0.5 ? 1 : -1};opacity:${(0.72 + rand() * 0.25).toFixed(2)}">${cloudSVG(rand)}</div>`;
      addItem(km, html, 'cloud-item', front ? frontEl : worldEl);
    }
  }

  /* ========================================================== stars */
  function drawStars() {
    const ctx = starsEl.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    starsEl.width = Math.round(W * dpr);
    starsEl.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);
    const rand = K.rng.fromLabel('karman-stars');
    for (let i = 0; i < 220; i++) {
      const x = rand() * W, y = rand() * H;
      const r = rand() < 0.08 ? 1.4 : 0.4 + rand() * 0.7;
      ctx.globalAlpha = 0.35 + rand() * 0.65;
      ctx.fillStyle = rand() < 0.15 ? '#FFE3B8' : '#EAF0FF';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ========================================================== rail */
  const railFrac = (km) => clamp(fOf(km) / fOf(110), 0, 1);

  function buildRail() {
    const ticks = railEl.querySelector('.rail-ticks');
    ticks.innerHTML = '';
    railTicks = K.scoring.MILESTONES.map((m) => {
      const t = document.createElement('div');
      t.className = 'rail-tick';
      t.style.top = `${(1 - railFrac(m.km)) * 100}%`;
      t.innerHTML = `<i></i><span>${m.short}</span>`;
      ticks.appendChild(t);
      return { m, el: t };
    });
    railBug = railEl.querySelector('.rail-bug');
    railFill = railEl.querySelector('.rail-fill');
    railGhost = railEl.querySelector('.rail-ghost');
  }

  /* ========================================================== colours */
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(h1, h2, t) {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }

  function skyAt(km) {
    const stops = SKY.map((s, i) => (i === 0 && weather ? [s[0], s[1], s[2], weather.horizon] : s));
    const f = fOf(km);
    for (let i = 0; i < stops.length - 1; i++) {
      const fa = fOf(stops[i][0]), fb = fOf(stops[i + 1][0]);
      if (f <= fb || i === stops.length - 2) {
        const t = clamp((f - fa) / (fb - fa), 0, 1);
        return [1, 2, 3].map((j) => mix(stops[i][j], stops[i + 1][j], t));
      }
    }
    return stops[stops.length - 1].slice(1);
  }

  /* ========================================================== layout */
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    span = H * 6.2;
    balloonPx = clamp(H * 0.24, 120, 190);
    rigEl.style.height = `${balloonPx}px`;
    rigEl.style.width = `${balloonPx * 0.8}px`;
    if (!anchorTarget) anchorTarget = anchorY = H * 0.42;
    drawStars();
  }

  /** Where the basket should sit (just above the active card). */
  /* At take-off the card grows to its round size. Rather than the whole world
     sliding up to make room (and the ground then dropping away), the new perch
     is applied along the lift-off curve itself, so the climb is one motion. */
  let anchorPlan = null, liftFollow = null;
  function planAnchor(y) { anchorPlan = clamp(y, balloonPx + 70, H * 0.7); }

  function setAnchor(y, instant) {
    if (anchorPlan != null || liftFollow) { anchorPlan = clamp(y, balloonPx + 70, H * 0.7); return; }
    anchorTarget = clamp(y, balloonPx + 70, H * 0.7);
    if (instant) anchorY = anchorTarget;
  }

  /* ========================================================== frame loop */
  function frame(now) {
    const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016);
    lastNow = now;
    const calm = K.fx.reduced();

    // Camera tween (held during hitstop)
    if (!K.fx.frozen && cam.dur > 0) {
      const t = clamp((now - cam.t0) / cam.dur, 0, 1);
      const prev = cam.km;
      cam.km = lerp(cam.from, cam.to, easeInOutCubic(t));
      checkCrossings(prev, cam.km);
      if (t >= 1 && climbResolve) {
        const r = climbResolve;
        climbResolve = null;
        r();
      }
    }

    // Lift-off tween
    const lt = clamp((now - liftT0) / liftDur, 0, 1);
    const le = (liftEase || easeOutCubic)(lt);
    liftPx = lerp(liftFrom, liftTo, le);
    perch = liftTo > 0 ? lerp(perchFrom, 0, le) : lerp(perchFrom, GROUND_DROP, le);
    if (lt >= 1 && liftResolve) { const r = liftResolve; liftResolve = null; r(); }
    if (liftFollow) {
      anchorY = lerp(liftFollow.from, liftFollow.to, le);
      if (lt >= 1) liftFollow = null;
    } else anchorY += (anchorTarget - anchorY) * Math.min(1, dt * 6);

    // Sky
    const [top, mid, bot] = skyAt(cam.km);
    skyEl.style.background = `linear-gradient(to bottom, ${top} 0%, ${mid} 58%, ${bot} 100%)`;
    starsEl.style.opacity = clamp((cam.km - 26) / 40, 0, 1).toFixed(3);
    const et = clamp((cam.km - 52) / 48, 0, 1);
    earthEl.style.opacity = et.toFixed(3);
    earthEl.style.transform = `translate3d(-50%, ${((1 - et) * 38).toFixed(2)}vh, 0)`;
    sunEl.style.opacity = (1 - clamp(cam.km / 40, 0, 0.75)).toFixed(3);

    // World items
    const fc = fOf(cam.km);
    for (const it of items) {
      const y = anchorY + liftPx + (fc - fOf(it.km)) * span;
      const visible = y > -H * 0.8 && y < H * 1.8;
      if (visible !== it.visible) {
        it.el.style.visibility = visible ? 'visible' : 'hidden';
        it.visible = visible;
      }
      if (visible) it.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    }

    // Balloon: bob, spin, flame
    const bob = calm || perch > GROUND_DROP - 2 ? 0 : Math.sin(now / 900) * 3.2;
    const sway = calm ? 0 : Math.sin(now / 1500) * 0.9;
    rigEl.style.transform = `translate3d(-50%, ${(anchorY - balloonPx + bob + perch).toFixed(1)}px, 0) rotate(${sway.toFixed(2)}deg)`;

    flame.boost *= Math.pow(0.08, dt);
    flame.level += (flame.target - flame.level) * Math.min(1, dt * 8);
    const flick = calm ? 0 : (Math.random() - 0.5) * 0.12;
    const fs = clamp(flame.level + flame.boost + flick, 0.05, 2.4);
    K.vehicle.frame({ km: cam.km, dt, now, flame: fs, calm });

    // Rail
    const rf = railFrac(cam.km);
    railBug.style.top = `${((1 - rf) * 100).toFixed(2)}%`;
    railFill.style.height = `${(rf * 100).toFixed(2)}%`;
    const nextTick = railTicks.find((t) => cam.km < t.m.km);
    for (const t of railTicks) {
      t.el.classList.toggle('lit', cam.km >= t.m.km);
      t.el.classList.toggle('next', t === nextTick);
    }

    requestAnimationFrame(frame);
  }

  function checkCrossings(prev, now) {
    if (now <= prev) return;
    for (const m of K.scoring.MILESTONES) {
      if (prev < m.km && now >= m.km && !crossed.has(m.id)) {
        crossed.add(m.id);
        onCross({ type: 'milestone', milestone: m, firstTime: !stamped[m.id] });
      }
    }
    if (pbKm > 0.5 && !pbAnnounced && prev < pbKm && now > pbKm) {
      pbAnnounced = true;
      onCross({ type: 'pb', km: pbKm });
    }
  }

  /* ========================================================== public API */
  function init() {
    skyEl = document.getElementById('sky');
    starsEl = document.getElementById('stars');
    worldEl = document.getElementById('world');
    frontEl = document.getElementById('world-front');
    earthEl = document.getElementById('earth');
    sunEl = document.getElementById('sun');
    rigEl = document.getElementById('balloon-rig');
    svgEl = document.getElementById('balloon');
    railEl = document.getElementById('rail');
    K.vehicle.build(svgEl);
    buildRail();
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }

  /** Prepare the sky for a flight. Call on boot and when switching flights. */
  function reset(opts) {
    weather = opts.weather;
    pbKm = opts.pbKm || 0;
    pbAnnounced = false;
    stamped = opts.stamps || {};
    crossed = new Set(K.scoring.MILESTONES.filter((m) => (opts.km || 0) >= m.km).map((m) => m.id));
    document.documentElement.style.setProperty('--horizon', weather.horizon);
    document.documentElement.style.setProperty('--haze', weather.haze);
    buildWorld();
    railGhost.hidden = !(pbKm > 0.5);
    railGhost.style.top = `${((1 - railFrac(pbKm)) * 100).toFixed(2)}%`;
    cam.km = cam.from = cam.to = opts.km || 0;
    cam.dur = 0;
    liftFrom = liftTo = liftPx = opts.flying ? flyPx() : 0;
    perch = perchFrom = opts.flying ? 0 : GROUND_DROP;
    flame.target = opts.flying ? 0.45 : 0.18;
    setChip(K.scoring.DEFAULT_CHIP, true);
    K.vehicle.set(cam.km);
  }

  /** Ease the camera to an altitude. Resolves when it arrives. */
  function climbTo(km, { duration } = {}) {
    const dist = Math.abs(fOf(km) - fOf(cam.km));
    const dur = K.fx.reduced() ? 250 : duration || clamp(900 + dist * 4200, 900, 2600);
    cam.from = cam.km;
    cam.to = km;
    cam.t0 = performance.now();
    cam.dur = dur;
    if (km > cam.km) flame.boost = Math.max(flame.boost, 1.0);
    return new Promise((r) => { climbResolve = r; });
  }

  function setChip(idx, instant) {
    K.vehicle.setGores(GORES_BY_CHIP[idx], !instant);   // a quick twirl, then settle
    if (instant || K.vehicle.stage > 1) return;
    svgEl.classList.remove('squash');
    void svgEl.getBoundingClientRect();
    svgEl.classList.add('squash');
  }

  /**
   * Take-off: a slow heave, then the meadow falls away beneath the basket.
   * The flame stays tall for the whole climb. Resolves when the climb ends.
   */
  function liftOff() {
    if (anchorPlan != null) { liftFollow = { from: anchorY, to: anchorPlan }; anchorTarget = anchorPlan; anchorPlan = null; }
    perchFrom = perch;
    liftFrom = liftPx;
    liftTo = flyPx();
    liftT0 = performance.now();
    liftDur = K.fx.reduced() ? 250 : 2100;
    liftEase = (t) => (t < 0.18 ? 0.04 * (t / 0.18) : 0.04 + 0.96 * easeInOutCubic((t - 0.18) / 0.82));
    flame.target = 1.35;
    flame.boost = 1.6;
    K.vehicle.spin(0.9);
    svgEl.classList.remove('heave');
    void svgEl.getBoundingClientRect();
    svgEl.classList.add('heave');
    return new Promise((r) => {
      liftResolve = () => { flame.target = 0.45; r(); };
    });
  }

  function setLift(flying) {
    perchFrom = perch;
    liftFrom = liftPx;
    liftTo = flying ? flyPx() : 0;
    liftT0 = performance.now();
    liftDur = 900;
    liftEase = null;
    flame.target = flying ? 0.45 : 0.18;
  }

  /** Hold-to-launch: p ∈ [0,1]. */
  function inflate(p) {
    flame.target = 0.18 + p * 1.3;
    svgEl.style.setProperty('--inflate', p.toFixed(3));
  }

  function flare(amount = 1.4) { flame.boost = Math.max(flame.boost, amount); }
  function setFlameTarget(level) { flame.target = level; }

  /** Screen position of a point given in the craft's viewBox units. */
  function svgPoint(x, y) {
    const r = svgEl.getBoundingClientRect();
    const sx = r.width / 200, sy = r.height / 250;
    return { x: r.left + x * sx, y: r.top + y * sy, scale: sx };
  }

  /** Screen-space points on the craft, for particles and props. */
  function point(which) {
    const [x, y] = K.vehicle.anchor(which);
    return svgPoint(x, y);
  }

  function dropSandbag() {
    if (K.vehicle.stage >= 3) return;   // rockets don't carry ballast
    const p = point('basket');
    const bag = document.createElement('div');
    bag.className = 'sandbag';
    bag.style.left = `${p.x + 22 * p.scale}px`;
    bag.style.top = `${p.y - 12 * p.scale}px`;
    bag.innerHTML = '<svg viewBox="0 0 20 24"><path d="M6,4 Q10,1 14,4 L17,20 Q10,24 3,20Z" fill="#C8B48C"/><path d="M6,5 Q10,7 14,5" stroke="#6B5634" stroke-width="1.5" fill="none"/><text x="10" y="17" font-size="6" text-anchor="middle" fill="#6B5634" font-family="monospace">KG</text></svg>';
    document.getElementById('scene').appendChild(bag); // behind the card, in front of the sky
    setTimeout(() => bag.remove(), 1500);
  }

  return {
    init, reset, climbTo, setChip, setLift, liftOff, inflate, flare, setFlameTarget,
    setAnchor, planAnchor, point, svgPoint, dropSandbag, fOf, skyAt,
    /** Screen y of a given altitude right now (for ambient effects). */
    yOf: (km) => anchorY + liftPx + (fOf(cam.km) - fOf(km)) * span,
    set onCross(fn) { onCross = fn; },
    get km() { return cam.km; },
    get balloonPx() { return balloonPx; },
  };
})();
