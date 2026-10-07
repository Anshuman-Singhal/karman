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
     launch circle, tree clumps, a windsock and a few festival balloons far off.

     It is returned as three stacked sheets (far, mid, front) with identical
     geometry, so the landmarks can stand between them: the Burj far off
     behind the green ridge, the Pyramid and the Eiffel Tower on the plain
     beyond the river, their feet hidden by the meadow and its trees. */
  const GROUND_VB_Y = 95;        // the meadow line in the hills viewBox
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
      const y = GROUND_VB_Y - Math.pow(Math.abs(dx), 1.6) * 16 + Math.sin(x / 47) * 1.2;
      near += ` L${x},${y.toFixed(1)}`;
    }
    near += ' L1000,300Z';

    const tree = (x, y, s, dark) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})">
        <rect x="-0.6" y="-2" width="1.2" height="4" fill="#2A2418"/>
        <circle cx="0" cy="-5" r="4.2" fill="${dark}"/><circle cx="-2.4" cy="-3.6" r="3" fill="${dark}"/><circle cx="2.6" cy="-3.4" r="3.1" fill="${dark}"/>
        <circle cx="1.2" cy="-6.4" r="2" fill="#6F8F52" opacity=".55"/></g>`;
    let trees = '';
    const clump = (cx, n, spread) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * spread;
        const dx = (x - 500) / 500;
        const y = GROUND_VB_Y - Math.pow(Math.abs(dx), 1.6) * 16 + 1.5;
        trees += tree(x, y, 1.2 + rand() * 1.1, rand() < 0.5 ? '#24412F' : '#2E4F36');
      }
    };
    clump(395, 7, 60); clump(615, 6, 50); clump(250, 9, 120); clump(780, 8, 110); clump(120, 6, 80); clump(905, 6, 80);

    // Distant festival balloons over the far ridges.
    const tiny = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" opacity=".8">
        <path d="M0,-9 C6,-9 7,-3 4,1 L1.5,4 L-1.5,4 L-4,1 C-7,-3 -6,-9 0,-9Z" fill="${c}"/>
        <path d="M0,-9 C2,-9 2.4,-3 1.3,1 L0.5,4 L-0.5,4 L-1.3,1 C-2.4,-3 -2,-9 0,-9Z" fill="#F3E9D6" opacity=".7"/>
        <rect x="-1.2" y="5" width="2.4" height="2" fill="#5A3720"/></g>`;

    const sheet = (body) => `<svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMin slice" class="hills">${body}</svg>`;
    // Ridge geometry is drawn in this order so the seeded randomness matches the original meadow.
    const farRidge = ridge(52, 12, 120, 0.4, 3);
    const midRidge = ridge(74, 7, 90, 2.1, 1.5);
    return {
      far: sheet(`<defs>
          <linearGradient id="g-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E86B4"/><stop offset=".5" style="stop-color:var(--horizon)" stop-opacity=".55"/><stop offset="1" stop-color="#6E86B4"/></linearGradient>
          <linearGradient id="g-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--haze);stop-opacity:0"/><stop offset=".5" style="stop-color:var(--haze);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--haze);stop-opacity:0"/></linearGradient></defs>
        ${tiny(560, 26, 1.1, '#E2574C')}${tiny(612, 38, 0.8, '#3E78C2')}${tiny(300, 22, 1, '#F2B33D')}${tiny(720, 30, 0.9, '#6CB38E')}
        <path d="${farRidge}" fill="url(#g-far)"/>
        <rect x="0" y="48" width="1000" height="30" fill="url(#g-mist)"/>`),
      mid: sheet(`<defs><linearGradient id="g-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C7A6A"/><stop offset=".35" stop-color="#355E55"/><stop offset="1" stop-color="var(--hill-mid)"/></linearGradient></defs>
        <path d="${midRidge}" fill="url(#g-mid)"/>`),
      front: sheet(`<defs>
          <linearGradient id="g-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FA65E"/><stop offset=".06" stop-color="#5E7F45"/><stop offset=".3" stop-color="#3A5E3F"/><stop offset=".75" stop-color="var(--hill-near)"/></linearGradient>
          <linearGradient id="g-mist2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--haze);stop-opacity:0"/><stop offset=".55" style="stop-color:var(--haze);stop-opacity:.5"/><stop offset="1" style="stop-color:var(--haze);stop-opacity:.1"/></linearGradient>
          <linearGradient id="g-river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--horizon)" stop-opacity=".9"/><stop offset="1" stop-color="#9DBBE0" stop-opacity=".7"/></linearGradient></defs>
        <rect x="0" y="66" width="1000" height="26" fill="url(#g-mist2)" opacity=".75"/>
        <path d="M0,86 C140,80 220,92 330,85 S520,80 600,86 S800,92 1000,84 L1000,88 C800,96 700,90 600,90 S420,86 330,90 S120,86 0,90Z" fill="url(#g-river)" opacity=".75"/>
        <path d="${near}" fill="url(#g-near)"/>
        <path d="M0,104 Q500,92 1000,104 M0,112 Q500,100 1000,112 M0,121 Q500,109 1000,121" stroke="#6F8F52" stroke-opacity=".18" stroke-width="1" fill="none"/>
        <ellipse cx="500" cy="96.5" rx="38" ry="4.2" fill="#A9BC72" opacity=".38"/>
        <ellipse cx="500" cy="96.5" rx="24" ry="2.6" fill="none" stroke="#E8E0C4" stroke-opacity=".35" stroke-width=".7"/>
        ${trees}
        <g transform="translate(548 96)"><line x1="0" y1="0" x2="0" y2="-20" stroke="#C9C2B4" stroke-width="1.2"/><path class="windsock" d="M0,-20 L13,-18 L13,-14.5 L0,-12.5Z" fill="var(--amber-deep)"/><path d="M4.3,-19.4 L4.3,-13.2 M8.6,-18.7 L8.6,-13.8" stroke="#F3E9D6" stroke-width="1.2"/></g>`),
    };
  }

  /* ========================================================== captions
     Every sight carries the same caption: a dot on the object, a hairline
     leader, and a small flag of night glass on the end of it holding the
     name and its altitude. The flag always opens toward the open sky
     (dir 'r' or 'l'), so it never sits on the art it describes.
       name  short, set in small capitals
       fig   the number, in the altimeter's display face
       note  optional aside, in the serif italic */
  function cap({ name, fig = '', note = '' }, dir = 'r', lead = 14, style = '') {
    const sub = fig || note ? `<span class="cap-sub">${fig ? `<span class="cap-fig">${fig}</span>` : ''}${note ? `<span class="cap-note">${note}</span>` : ''}</span>` : '';
    return `<span class="cap cap-${dir}${lead ? '' : ' flat'}" style="--lead:${lead}px;${style}"><span class="w-label"><span class="cap-name">${name}</span>${sub}</span></span>`;
  }

  /* ========================================================== sights on the way up
     One illustration style for everything in the sky: flat shapes, the sun
     on the right (lit faces right, shade faces left, in cool shadow), and a
     wash of the day's haze toward the bottom of anything on the ground, so
     distant things recede into the horizon.
       grounded  stand on the plain, tops at their real height (the log
                 camera means you pass the Pyramid's tip first)
       legends   public-domain fiction lives on clouds, not on the ground
       flyers    cross the sky at their altitude, on a loop */
  const hazeStops = (from, to) => `<stop offset="${from}" style="stop-color:var(--haze);stop-opacity:0"/><stop offset="1" style="stop-color:var(--haze);stop-opacity:${to}"/>`;
  const splitFill = (id, x, a, b, c, d) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${2 * x}" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>`;
  const pts = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L');

  /* Great Pyramid, seen off its corner: a wide sunlit face, a narrow shaded one. */
  function pyramidSVG() {
    const ridgeX = (y) => 70 - 14 * (y - 2) / 98, rightX = (y) => 71 + 73 * (y - 2) / 98, leftX = (y) => 69 - 69 * (y - 2) / 98;
    let lit = '', shade = '';
    for (let y = 12; y < 98; y += 9.5) {
      lit += `M${ridgeX(y).toFixed(1)},${y} L${rightX(y).toFixed(1)},${y} `;
      shade += `M${leftX(y).toFixed(1)},${y} L${ridgeX(y).toFixed(1)},${y} `;
    }
    return `<svg viewBox="0 0 144 100" preserveAspectRatio="none"><defs>
      <linearGradient id="sk-pyr-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F8DBA0"/><stop offset="1" stop-color="#E2AE66"/></linearGradient>
      <linearGradient id="sk-pyr-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A3836D"/><stop offset="1" stop-color="#7F665C"/></linearGradient>
      <linearGradient id="sk-pyr-h" x1="0" y1="0" x2="0" y2="1">${hazeStops(0.5, 0.42)}</linearGradient></defs>
      <path d="M0,100 L69,2 L70,2 L56,100Z" fill="url(#sk-pyr-s)"/>
      <path d="M70,2 L71,2 L144,100 L56,100Z" fill="url(#sk-pyr-l)"/>
      <path d="${lit}" stroke="#A9834F" stroke-opacity=".32" stroke-width=".6"/>
      <path d="${shade}" stroke="#5E4C46" stroke-opacity=".3" stroke-width=".6"/>
      <path d="M70,2 L56,100" stroke="#FFF2D6" stroke-opacity=".85" stroke-width=".9"/>
      <path d="M0,100 L69,2 L71,2 L144,100Z" fill="url(#sk-pyr-h)"/></svg>`;
  }

  /* Eiffel Tower: the exponential taper of the legs, the great arch, two
     platforms and the top, with a cross-braced lattice showing through. */
  function eiffelSVG() {
    const R = [[50.35, 0], [50.7, 12], [51.2, 20], [52.6, 22], [52.6, 33], [55.4, 33], [55.4, 37.5], [53.8, 37.5]];
    for (let i = 1; i <= 14; i++) { const t = i / 14; R.push([53.8 + 13.2 * Math.pow(t, 1.8), 37.5 + 127.5 * t]); }
    R.push([71.2, 165], [71.2, 171], [68, 171]);
    for (let i = 1; i <= 6; i++) { const t = i / 6; R.push([68 + 13 * Math.pow(t, 1.25), 171 + 40 * t]); }
    R.push([86.8, 211], [86.8, 219], [82.5, 219]);
    for (let i = 1; i <= 8; i++) { const t = i / 8; R.push([82.5 + 17.5 * Math.pow(t, 1.6), 219 + 45 * t]); }
    R.push([100, 264], [88.5, 264]);
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; R.push([50 + 38.5 * Math.cos(a), 264 - 37 * Math.sin(a)]); }
    const L = R.slice(0, -1).reverse().map(([x, y]) => [100 - x, y]);
    const outline = `M${pts(R.concat(L))}Z`;
    const holes = 'M58.6,211 L56,178 L44,178 L41.4,211Z';   // the open bay between the first and second floors
    const shape = `${outline} ${holes}`;
    return `<svg viewBox="0 0 100 264" preserveAspectRatio="none"><defs>
      ${splitFill('sk-eif', 50, '#403A55', '#4C445C', '#86706A', '#987F74')}
      <pattern id="sk-eif-lat" width="4.4" height="4.4" patternUnits="userSpaceOnUse"><path d="M0,0 L4.4,4.4 M4.4,0 L0,4.4" stroke="#F4E2CF" stroke-width=".42"/></pattern>
      <linearGradient id="sk-eif-h" x1="0" y1="0" x2="0" y2="1">${hazeStops(0.45, 0.6)}</linearGradient></defs>
      <path d="${shape}" fill="url(#sk-eif)" fill-rule="evenodd"/>
      <path d="${shape}" fill="url(#sk-eif-lat)" fill-rule="evenodd" opacity=".26"/>
      <g fill="#A8948C"><rect x="13.2" y="211" width="73.6" height="3.2"/><rect x="28.8" y="165" width="42.4" height="2.6"/><rect x="44.6" y="33" width="10.8" height="1.8"/></g>
      <g fill="#2F2C45" opacity=".55"><rect x="13.2" y="218" width="73.6" height="1"/><rect x="28.8" y="170.2" width="42.4" height=".8"/></g>
      <path d="${shape}" fill="url(#sk-eif-h)" fill-rule="evenodd"/></svg>`;
  }

  /* Burj Khalifa: stepped setbacks that climb in a spiral (so the two sides
     step at different heights), then the long spire. Far off and hazy. */
  function burjSVG() {
    const steps = (base, list) => {
      const out = [[base, 540]];
      let hw = base;
      for (const [y, next] of list) { out.push([hw, y], [next, y]); hw = next; }
      return out;
    };
    const right = steps(25, [[470, 21.5], [402, 18], [338, 14.5], [276, 11], [218, 8], [168, 5.2], [130, 3.4]]);
    const left = steps(23.5, [[500, 21], [436, 18.5], [370, 15], [306, 12], [246, 9], [192, 6.2], [148, 3.4]]);
    const R = right.map(([hw, y]) => [30 + hw, y]).concat([[30.35, 0]]);
    const Lp = [[29.65, 0]].concat(left.reverse().map(([hw, y]) => [30 - hw, y]));
    const shape = `M${pts(R.concat(Lp))}Z`;
    const ledges = [470, 402, 338, 276, 218, 168].map((y) => `M30,${y} H${30 + 22}`).join(' ') + ' ' + [500, 436, 370, 306, 246, 192].map((y) => `M30,${y} H${30 - 22}`).join(' ');
    return `<svg viewBox="0 0 60 540" preserveAspectRatio="none"><defs>
      ${splitFill('sk-burj', 30, '#7F93B8', '#8DA1C3', '#B9C8DF', '#CAD6E8')}
      <clipPath id="sk-burj-c"><path d="${shape}"/></clipPath>
      <linearGradient id="sk-burj-h" x1="0" y1="0" x2="0" y2="1">${hazeStops(0.05, 0.9)}</linearGradient></defs>
      <path d="${shape}" fill="url(#sk-burj)"/>
      <g clip-path="url(#sk-burj-c)"><path d="${ledges}" stroke="#6E83A6" stroke-opacity=".45" stroke-width="1.2"/>
        <path d="M32.2,540 V136" stroke="#FFFFFF" stroke-opacity=".5" stroke-width=".9"/></g>
      <path d="${shape}" fill="url(#sk-burj-h)"/></svg>`;
  }

  /* A cloud with a sunlit top and a cool, flat underside: the same build as
     the drifting clouds, used as the footing for legends. */
  function bank(cx, by, w, seed) {
    const rand = K.rng.fromLabel(`bank-${seed}`);
    const n = 6;
    let lit = '';
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = w * (0.09 + 0.08 * (1 - Math.abs(t - 0.5) * 2)) * (0.85 + rand() * 0.3);
      const x = cx - w / 2 + r * 0.9 + t * (w - r * 1.8);
      lit += `<circle cx="${x.toFixed(1)}" cy="${(by - r * 0.62).toFixed(1)}" r="${r.toFixed(1)}"/>`;
    }
    return `<g><g fill="#FBF8F3">${lit}<rect x="${cx - w / 2}" y="${by - w * 0.09}" width="${w}" height="${w * 0.09}" rx="${w * 0.045}"/></g>
      <rect x="${cx - w / 2 + 2}" y="${by - w * 0.045}" width="${w - 4}" height="${w * 0.045}" rx="${w * 0.0225}" fill="#C7CFE2"/></g>`;
  }

  /* Tower of Babel (legend): a round, tiered ziggurat with its ramp
     spiralling up, standing on a bank of cloud. */
  function babelSVG() {
    const cx = 55, tiers = [[108, 46], [91, 39], [74, 32], [57, 25], [40, 18]];
    let body = '';
    for (const [yb, hwb] of tiers) {
      const yt = yb - 17, hwt = hwb - 3;
      body += `<path d="M${cx - hwb},${yb} L${cx - hwt},${yt} L${cx + hwt},${yt} L${cx + hwb},${yb}Z" fill="url(#sk-bab)"/>`;
      // The ramp: rising left to right across the face of each tier.
      const xl = cx - hwb + 3, xr = cx + hwt - 2;
      const rampY = (x) => (yb - 4.5) + ((yt + 1) - (yb - 4.5)) * (x - xl) / (xr - xl);
      for (let x = cx - hwt + 3; x < cx + hwt - 2; x += 5.2) {
        const top = yt + 3, bottom = Math.min(yt + 9.5, rampY(x) - 1.6);
        if (bottom - top >= 3.6) body += `<path fill="#5B4433" fill-opacity=".62" d="M${(x - 1.1).toFixed(1)},${bottom.toFixed(1)} V${(top + 1.1).toFixed(1)} A1.1,1.1 0 0 1 ${(x + 1.1).toFixed(1)},${(top + 1.1).toFixed(1)} V${bottom.toFixed(1)}Z"/>`;
      }
      body += `<path d="M${xl},${yb - 4.5} L${xr},${yt + 1} L${xr},${yt + 4.6} L${xl},${yb - 0.9}Z" fill="#EDD0A0"/>`;
      body += `<path d="M${xl},${yb - 0.9} L${xr},${yt + 4.6}" stroke="#6E5038" stroke-opacity=".45" stroke-width=".8"/>`;
      body += `<rect x="${cx - hwt - 1.4}" y="${yt - 1.6}" width="${2 * hwt + 2.8}" height="1.8" fill="#E7C893"/>`;
    }
    return `<svg viewBox="0 0 110 126"><defs>
      <linearGradient id="sk-bab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8E6E58"/><stop offset=".45" stop-color="#C29C72"/><stop offset=".78" stop-color="#E2BF8C"/><stop offset="1" stop-color="#C69C6E"/></linearGradient></defs>
      ${body}
      <path d="M${cx - 8},23 L${cx - 6.5},12 L${cx + 6.5},12 L${cx + 8},23Z" fill="url(#sk-bab)"/>
      <path d="M${cx - 7},12.2 Q${cx},2 ${cx + 7},12.2Z" fill="#B88F66"/><path d="M${cx},4.2 Q${cx + 5},6 ${cx + 6.6},12" stroke="#F0D3A0" stroke-width="1" fill="none"/>
      ${bank(55, 124, 108, 'babel')}</svg>`;
  }

  /* Castle in the clouds: two round towers with slate cones, a crenellated
     keep with a pennant, all on its own cloud. */
  function castleSVG() {
    const cren = (x0, x1, y) => { let d = ''; for (let x = x0; x < x1 - 1; x += 5) d += `M${x},${y} h3 v-3 h-3Z `; return d; };
    const tower = (x, w, y, roofH) => `
      <rect x="${x}" y="${y}" width="${w}" height="${78 - y}" fill="url(#sk-cyl)"/>
      <path d="M${x - 2},${y + 0.5} L${x + w / 2},${y - roofH} L${x + w / 2},${y + 0.5}Z" fill="#1E2A55"/>
      <path d="M${x + w / 2},${y - roofH} L${x + w + 2},${y + 0.5} L${x + w / 2},${y + 0.5}Z" fill="#3A4C85"/>
      <path d="M${x + w / 2 - 1},${y + 12} v-2.4 a1,1 0 0 1 2,0 v2.4Z M${x + w / 2 - 1},${y + 26} v-2.4 a1,1 0 0 1 2,0 v2.4Z" fill="#2A3358"/>`;
    return `<svg viewBox="0 0 140 96"><defs>
      <linearGradient id="sk-cyl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B4B7CE"/><stop offset=".45" stop-color="#E4DFD8"/><stop offset=".78" stop-color="#F8F3EA"/><stop offset="1" stop-color="#D8D3D2"/></linearGradient>
      ${splitFill('sk-wall', 70, '#C3C4D6', '#CDCDDC', '#F1EBE1', '#F6F1E8')}</defs>
      <rect x="38" y="44" width="64" height="34" fill="url(#sk-wall)"/>
      <path d="${cren(39, 102, 44)}" fill="url(#sk-wall)"/>
      <rect x="58" y="22" width="24" height="56" fill="url(#sk-wall)"/>
      <path d="${cren(58.5, 83, 22)}" fill="url(#sk-wall)"/>
      <path d="M70,22 V5" stroke="#3A4C85" stroke-width="1"/><path d="M70.5,5 L80,7.6 L70.5,10.2Z" fill="var(--amber)"/>
      <path d="M66,78 V67 a4,4 0 0 1 8,0 V78Z" fill="#2A3358"/>
      <path d="M63,36 v-3 a1.2,1.2 0 0 1 2.4,0 v3Z M74.6,36 v-3 a1.2,1.2 0 0 1 2.4,0 v3Z" fill="#2A3358"/>
      ${tower(26, 15, 30, 21)}${tower(99, 15, 26, 23)}
      ${bank(70, 95, 136, 'castle')}</svg>`;
  }

  /* The beanstalk: two stems twisting round each other, leaves alternating. */
  function beanstalkSVG() {
    const H = 280;
    const stem = (ph) => { let d = ''; for (let y = 0; y <= H; y += 6) d += `${y ? ' L' : 'M'}${(20 + 6 * Math.sin(y / 22 + ph)).toFixed(1)},${y}`; return d; };
    let leaves = '';
    for (let y = 18, i = 0; y < H - 20; y += 30, i++) {
      const s = i % 2 ? -1 : 1, x = 20 + 6 * Math.sin(y / 22);
      leaves += `<g transform="translate(${x.toFixed(1)} ${y}) scale(${s} 1) rotate(-24)"><path d="M0,0 C3,-6 11,-6 14,0 C11,4 3,4 0,0Z" fill="#5E9A43"/><path d="M0,0 C3,-6 11,-6 14,0Z" fill="#8CC062"/><path d="M1,0 H12" stroke="#3E7432" stroke-width=".6"/></g>`;
    }
    return `<svg viewBox="0 0 40 ${H}" preserveAspectRatio="xMidYMin meet"><path d="${stem(Math.PI)}" fill="none" stroke="#3F7A36" stroke-width="3.2" stroke-linecap="round"/>
      <path d="${stem(0)}" fill="none" stroke="#6FAA4C" stroke-width="2.8" stroke-linecap="round"/>${leaves}</svg>`;
  }

  /* Everest: summit pyramid with a sunlit east face and a cool north face,
     rock and snow falling away into the haze. */
  const everestSVG = () => `<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMin meet">
      <defs><linearGradient id="peak-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#B9C9E2"/><stop offset=".3" stop-color="#93A9CC"/><stop offset="1" stop-color="#93A9CC" stop-opacity="0"/></linearGradient>
        <linearGradient id="peak-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E6EDF8" stop-opacity="0"/></linearGradient></defs>
      <path d="M150,0 L172,32 L196,70 L214,62 L246,128 L300,300 L300,420 L0,420 L0,330 L58,196 L86,94 L112,60 L132,26Z" fill="url(#peak-fade)"/>
      <path d="M150,0 L172,32 L196,70 L214,62 L246,128 L222,150 L200,122 L178,150 L160,96 L150,40Z" fill="url(#peak-snow)"/>
      <path d="M150,0 L150,40 L160,96 L140,120 L120,96 L112,60 L132,26Z" fill="#C9D6EA" fill-opacity=".9"/>
      <path d="M112,60 L120,96 L100,128 L86,94Z" fill="#D7E1F0" fill-opacity=".55"/>
      <path d="M150,0 L150,40 L160,96" stroke="#FFFFFF" stroke-width="1.4" fill="none" stroke-opacity=".9"/>
      <path d="M166,60 L176,92 M190,80 L198,110 M214,84 L220,118" stroke="#9FB2D0" stroke-width="1.2" stroke-opacity=".5"/></svg>`;

  /* Aircraft are drawn in plan, nose to the right, like a spotter's card:
     the sunward half of the airframe light, the other half in shade. */
  const AIR_LIT = '#F4F6FA', AIR_SHADE = '#BAC4D6';
  const halves = (id, cy, lit = AIR_LIT, shade = AIR_SHADE) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${2 * cy}"><stop offset="0" stop-color="${lit}"/><stop offset=".5" stop-color="${lit}"/><stop offset=".5" stop-color="${shade}"/><stop offset="1" stop-color="${shade}"/></linearGradient>`;
  // Mirrors absolute "x,y" pairs across y = cy (paths passed here use absolute commands only).
  const mirrorY = (d, cy) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => `${x},${(2 * cy - y).toFixed(2).replace(/\.?0+$/, '')}`);

  function airlinerSVG(id) {
    const wing = 'M29,15.5 L18,2 L22.5,2 L38,15.5Z', tail = 'M8,15.6 L3,9.5 L6,9.5 L12.5,15.6Z', eng = 'M25,8.4 h7 a1.3,1.3 0 0 1 0,2.6 h-7Z';
    return `<svg viewBox="0 0 60 34"><defs>${halves(id, 17)}</defs><g fill="url(#${id})">
      <path d="${wing} ${mirrorY(wing, 17)} ${tail} ${mirrorY(tail, 17)}"/>
      <path d="M2,17 C2,15.8 5,15.3 9,15.3 L48,15.3 C53,15.3 57.5,16.2 58.6,17 C57.5,17.8 53,18.7 48,18.7 L9,18.7 C5,18.7 2,18.2 2,17Z"/></g>
      <path d="${eng} M25,23 h7 a1.3,1.3 0 0 1 0,2.6 h-7Z" fill="#9AA6BC"/></svg>`;
  }

  const FLYER_ART = {
    paraglider: `<svg viewBox="0 0 44 40"><defs><linearGradient id="sk-pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F3E7D0"/><stop offset=".17" stop-color="#F3E7D0"/><stop offset=".17" stop-color="#E35F3E"/><stop offset=".83" stop-color="#F07A52"/><stop offset=".83" stop-color="#F3E7D0"/><stop offset="1" stop-color="#F3E7D0"/></linearGradient></defs>
      <path d="M5,12.5 L20.4,33 M39,12.5 L23.6,33 M14,8.5 L20.6,33 M30,8.5 L23.4,33" stroke="#F3E7D0" stroke-opacity=".7" stroke-width=".45"/>
      <path d="M2,11.5 Q22,-4 42,11.5 L40,14 Q22,1.5 4,14Z" fill="url(#sk-pg)"/>
      <path d="M4,14 Q22,1.5 40,14 L39.4,15 Q22,4 4.6,15Z" fill="#9E3B28"/>
      <path d="M20,33 h4 l-0.6,4 h-2.8Z" fill="#1E2A55"/><circle cx="22" cy="32" r="1.7" fill="var(--amber)"/></svg>`,
    geese: (() => {
      // In plan from below, like the aircraft: a V of geese, necks out front.
      const wing = 'M2.6,-0.9 C4.6,-2.6 4.4,-5.6 1.6,-8 C4.4,-7.4 7.2,-5 7,-0.9Z';   // a broad, arched wing, not a swept jet wing
      const goose = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="4" cy="0" rx="4.2" ry="1.3"/><path d="M7,-0.55 L11,-0.4 L12.6,0 L11,0.4 L7,0.55Z ${wing} ${mirrorY(wing, 0)}"/></g>`;
      return `<svg viewBox="0 0 64 44"><g fill="#27304D">${goose(50, 22, 1)}${goose(38, 15, 0.95)}${goose(37, 29.5, 0.95)}${goose(26, 8.2, 0.9)}${goose(24.5, 36, 0.9)}</g></svg>`;
    })(),
    vulture: `<svg viewBox="0 0 48 18"><path d="M24,6 C20,5 14,5.5 9,7 L4,7.5 L1,9 L4,9.2 L2,10.6 L5.5,10.2 L4.5,11.8 L8.5,10.6 C14,10 19,10.2 22,11 L22.6,15 L24,16.6 L25.4,15 L26,11 C29,10.2 34,10 39.5,10.6 L43.5,11.8 L42.5,10.2 L46,10.6 L44,9.2 L47,9 L44,7.5 L39,7 C34,5.5 28,5 24,6Z" fill="#3D312B"/>
      <path d="M9.5,8.3 C14,7.4 19,7.5 22,8.3 M38.5,8.3 C34,7.4 29,7.5 26,8.3" stroke="#E6DCC8" stroke-opacity=".7" stroke-width=".6" fill="none"/><circle cx="24" cy="5.3" r="1.5" fill="#CDBFA8"/></svg>`,
    bizjet: (() => {
      const wing = 'M21,11.4 L14.5,2 L17.5,2 L27,11.4Z', tail = 'M6.5,11.6 L2.5,6.5 L4.6,6.5 L9.5,11.6Z', eng = 'M9,10 h5.6 a.8,.8 0 0 1 0,1.4 h-5.6Z';
      return `<svg viewBox="0 0 46 26"><defs>${halves('sk-bj', 13)}</defs><g fill="url(#sk-bj)"><path d="${wing} ${mirrorY(wing, 13)} ${tail} ${mirrorY(tail, 13)}"/>
        <path d="M2,13 C2,11.8 5,11.3 9,11.3 L35,11.3 C40,11.3 44,12.3 45,13 C44,13.7 40,14.7 35,14.7 L9,14.7 C5,14.7 2,14.2 2,13Z"/></g><path d="${eng} M9,14.6 h5.6 a.8,.8 0 0 1 0,1.4 h-5.6Z" fill="#A9B4C8"/></svg>`;
    })(),
    sonde: `<svg viewBox="0 0 20 44"><defs><radialGradient id="sk-sonde" cx=".62" cy=".32" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#EEF1F7"/><stop offset="1" stop-color="#C5CEDF"/></radialGradient></defs>
      <path d="M10,17.4 V38" stroke="#F4F6FA" stroke-opacity=".8" stroke-width=".55"/>
      <circle cx="10" cy="9" r="8.4" fill="url(#sk-sonde)"/><path d="M8.8,17 h2.4 l-.4,1.8 h-1.6Z" fill="#C5CEDF"/>
      <path d="M8.2,26 Q10,22.4 11.8,26Z" fill="#E35F3E"/>
      <rect x="7.4" y="37.6" width="5.2" height="4.4" rx=".6" fill="#F4F6FA"/><rect x="7.4" y="39.2" width="5.2" height="1.2" fill="#E35F3E"/></svg>`,
    concorde: (() => {
      const wing = 'M7,10.4 L7,3.4 L11,2 C20,2.6 35,6.6 50,10.4Z', eng = 'M7,7.6 h10 v1.8 h-10Z';
      return `<svg viewBox="0 0 70 22"><defs>${halves('sk-cc', 11)}</defs><g fill="url(#sk-cc)"><path d="${wing} ${mirrorY(wing, 11)}"/>
        <path d="M1,11 L8,10.3 L60,10.2 C64,10.3 68,10.7 69.6,11 C68,11.3 64,11.7 60,11.8 L8,11.7Z"/></g><path d="${eng} M7,12.6 h10 v1.8 h-10Z" fill="#A9B4C8"/></svg>`;
    })(),
    u2: (() => {
      const wing = 'M18,30.6 L17,1.5 Q17.6,0.6 19,0.6 L21.6,0.6 L22.6,30.6Z', tail = 'M5,30.8 L3.4,24.5 L5.4,24.5 L8.4,30.8Z';
      return `<svg viewBox="0 0 44 64"><defs>${halves('sk-u2', 32, '#4A5576', '#262E46')}</defs><g fill="url(#sk-u2)"><path d="${wing} ${mirrorY(wing, 32)} ${tail} ${mirrorY(tail, 32)}"/>
        <path d="M2,32 C2,30.9 5,30.4 9,30.4 L34,30.4 C39,30.4 42.4,31.3 43.4,32 C42.4,32.7 39,33.6 34,33.6 L9,33.6 C5,33.6 2,33.1 2,32Z"/></g></svg>`;
    })(),
    sr71: (() => {
      const wing = 'M27,12.4 L43,3.4 L51,3.4 L57,12.6Z', nac = 'M28,5.6 L55,5.6 L62,6.7 L55,7.8 L28,7.8Z', fin = 'M30,6.7 L25,4.2 L28,4.2 L35,6.7Z';
      return `<svg viewBox="0 0 70 30"><defs>${halves('sk-sr', 15, '#3E4660', '#262C3F')}</defs><g fill="url(#sk-sr)"><path d="${wing} ${mirrorY(wing, 15)}"/>
        <path d="M1,15 C12,14.4 24,12.6 36,12 L60,12.6 C64,13 68,14 69.4,15 C68,16 64,17 60,17.4 L36,18 C24,17.4 12,15.6 1,15Z"/>
        <path d="${nac} ${mirrorY(nac, 15)}"/></g><path d="${fin} ${mirrorY(fin, 15)}" fill="#0E121C"/>
        <path d="M36,13.4 L60,13.6" stroke="#6E7894" stroke-opacity=".5" stroke-width=".5"/></svg>`;
    })(),
    burst: `<svg viewBox="0 0 26 38"><path d="M7.6,5.4 q1.4,-3 3.4,-2 M15.4,2.6 q2.6,0 2.4,2.6 M4,9 q-1,-2.4 1.2,-3 M20,9.6 q1.6,-1.8 3,-0.4" stroke="#E9EDF5" stroke-opacity=".85" stroke-width="1.2" stroke-linecap="round" fill="none"/>
      <path d="M4,20 L13,33 M22,20 L13,33 M9,18 L13,33 M17,18 L13,33" stroke="#F4F6FA" stroke-opacity=".7" stroke-width=".45"/>
      <path d="M3,20.4 Q13,8 23,20.4Z" fill="#E35F3E"/><path d="M13,11.1 Q20,13 23,20.4 L13,20.4Z" fill="#F07A52"/>
      <rect x="10.4" y="32.6" width="5.2" height="4.4" rx=".6" fill="#F4F6FA"/><rect x="10.4" y="34.2" width="5.2" height="1.2" fill="#E35F3E"/></svg>`,
    highballoon: `<svg viewBox="0 0 24 50"><path d="M12,1 C22,1 23,14 16,24 L13,34 L11,34 L8,24 C1,14 2,1 12,1Z" fill="#DCE6F5" fill-opacity=".28" stroke="#F3E9D6" stroke-opacity=".9" stroke-width=".7"/>
      <path d="M12,1 C16,8 15.5,20 12,34 M12,1 C8,8 8.5,20 12,34" stroke="#F3E9D6" stroke-opacity=".4" stroke-width=".5" fill="none"/>
      <path d="M15,4 C18,7 18.6,12 17,16" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="1" fill="none" stroke-linecap="round"/>
      <path d="M12,34 V44" stroke="#F3E9D6" stroke-width=".6"/><rect x="9.5" y="44" width="5" height="4" rx=".6" fill="var(--amber)"/></svg>`,
    iss: (() => {
      let arrays = '';
      for (const x of [5, 12, 47, 54]) {
        for (const [y, h] of [[2, 12.6], [19.4, 12.6]]) {
          arrays += `<rect x="${x}" y="${y}" width="5.4" height="${h}" fill="url(#sk-iss)"/><path d="M${x + 2.7},${y} v${h} M${x},${y + h / 3} h5.4 M${x},${y + 2 * h / 3} h5.4" stroke="#5A4220" stroke-opacity=".55" stroke-width=".35"/>`;
        }
      }
      return `<svg viewBox="0 0 64 34"><defs><linearGradient id="sk-iss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E9C277"/><stop offset="1" stop-color="#A9782F"/></linearGradient>${halves('sk-iss-m', 17, '#F4F6FA', '#B4BED0')}</defs>
        <rect x="3" y="15.9" width="58" height="2.2" fill="#C9D2E2"/>${arrays}
        <rect x="21" y="7" width="3" height="8.6" fill="#EEF2F8"/><rect x="40" y="18.4" width="3" height="8.6" fill="#EEF2F8"/>
        <g fill="url(#sk-iss-m)"><rect x="26" y="13" width="14" height="8" rx="2"/><rect x="31" y="9" width="4" height="16" rx="1.4"/></g></svg>`;
    })(),
  };

  /* Data. fig and note go into the caption; km places the object. */
  const GROUNDED = [
    { km: 0.828, cap: { name: 'Burj Khalifa', fig: '828 m' }, cx: 27, ar: 13, plane: 'far', dir: 'r', tip: 50.6, svg: burjSVG },
    { km: 0.139, cap: { name: 'Great Pyramid', fig: '139 m' }, cx: 15, ar: 100 / 144, plane: 'mid', dir: 'r', tip: 48.6, svg: pyramidSVG },
    { km: 0.330, cap: { name: 'Eiffel Tower', fig: '330 m' }, cx: 85, ar: 2.64, plane: 'mid', dir: 'l', tip: 50.35, svg: eiffelSVG },
  ];
  const FLYERS = [
    { km: 0.6, cap: { name: 'Paraglider', fig: '0.6 km' }, dur: 70, dir: 1, w: 36, vb: [44, 40], art: 'paraglider' },
    { km: 7.3, cap: { name: 'Bar-headed geese', fig: '7.3 km', note: 'over the Himalaya' }, dur: 46, dir: -1, w: 52, vb: [64, 44], art: 'geese' },
    { km: 11.3, cap: { name: 'Rüppell’s vulture', fig: '11.3 km', note: 'highest bird' }, dur: 58, dir: 1, w: 44, vb: [48, 18], art: 'vulture' },
    { km: 13.5, cap: { name: 'Business jets', fig: '13.5 km' }, dur: 30, dir: -1, w: 38, vb: [46, 26], art: 'bizjet' },
    { km: 15.5, cap: { name: 'Weather balloon', fig: '15.5 km', note: 'rising' }, dur: 120, dir: 1, w: 16, vb: [20, 44], art: 'sonde' },
    { km: 18, cap: { name: 'Concorde', fig: '18 km', note: 'Mach 2' }, dur: 14, dir: -1, w: 62, vb: [70, 22], art: 'concorde' },
    { km: 21, cap: { name: 'U-2 spy plane', fig: '21 km' }, dur: 40, dir: 1, w: 34, vb: [44, 64], art: 'u2' },
    { km: 25.9, cap: { name: 'SR-71 Blackbird', fig: '25.9 km', note: 'fastest jet' }, dur: 9, dir: -1, w: 66, vb: [70, 30], art: 'sr71' },
    { km: 35, cap: { name: 'Weather balloons burst', fig: '~35 km' }, dur: 140, dir: 1, w: 22, vb: [26, 38], art: 'burst' },
    { km: 53, cap: { name: 'Highest balloon ever', fig: '53 km' }, dur: 160, dir: -1, w: 22, vb: [24, 50], art: 'highballoon' },
    { km: 103, cap: { name: 'Space station', fig: '~400 km', note: 'in orbit, far above' }, dur: 26, dir: 1, w: 58, vb: [64, 34], art: 'iss' },
  ];
  const BANDS = [
    { km: 70, cap: { name: 'Sprites', fig: '50–90 km', note: 'red lightning' }, cls: 'sprites' },
    { km: 83, cap: { name: 'Noctilucent clouds', fig: '83 km' }, cls: 'nlc' },
  ];

  /* Grounded landmarks are sized from the camera so their feet land exactly
     on the plain: height = distance from their real altitude down to the
     meadow line, at the current zoom. */
  let grounded = [];
  function layoutGrounded() {
    if (!W || !grounded.length) return;
    const hillsH = Math.max(H * 0.6, 320);
    const scale = Math.max(W / 1000, hillsH / 300);
    const groundPx = GROUND_VB_Y * scale - H * 0.19;   // meadow line, relative to y(0)
    for (const g of grounded) {
      const h = fOf(g.t.km) * span + groundPx + 4;      // +4: feet tucked behind the meadow
      const w = h / g.t.ar;
      g.el.style.height = `${h.toFixed(1)}px`;
      g.el.style.width = `${w.toFixed(1)}px`;
      g.el.style.left = `calc(${g.t.cx}% - ${(w / 2).toFixed(1)}px)`;
    }
  }

  function buildGround() {
    const hills = hillsSVG();
    addItem(0, hills.far, 'ground far');
    const stand = (t) => {
      const it = addItem(t.km, `<div class="grounded-frame"><div class="landmark-art">${t.svg()}</div>${cap(t.cap, t.dir, 16, `left:${t.tip}%;top:-3px`)}</div>`, `sight grounded ${t.plane}`);
      grounded.push({ t, el: it.el.firstElementChild });
    };
    GROUNDED.filter((t) => t.plane === 'far').forEach(stand);
    addItem(0, hills.mid, 'ground mid');
    GROUNDED.filter((t) => t.plane === 'mid').forEach(stand);
    addItem(0, hills.front, 'ground front');
    layoutGrounded();
  }

  function buildSights() {
    // Legends stand on clouds: Babel on its own bank, the castle on another,
    // with the beanstalk climbing up to it out of the cloud deck below.
    addItem(1.25, `<div class="legend babel"><div class="legend-art">${babelSVG()}</div>${cap({ name: 'Tower of Babel', note: 'legend' }, 'l', 14, 'left:50%;top:-2px')}</div>`, 'sight');
    addItem(2.6, `<div class="legend castle">
        <div class="stalk">${beanstalkSVG()}</div>
        <div class="stalk-foot"><svg viewBox="0 0 90 30">${bank(45, 29, 86, 'stalk')}</svg></div>
        <div class="legend-art">${castleSVG()}</div>
        ${cap({ name: 'Castle in the clouds', note: 'fairy tale' }, 'r', 14, 'left:50%;top:-82px')}</div>`, 'sight');
    FLYERS.forEach((f, i) => {
      const delay = -((i * 13.7) % f.dur);
      const h = f.w * f.vb[1] / f.vb[0];
      // The caption trails the flyer, like a towed banner.
      const dir = f.dir < 0 ? 'r' : 'l';
      addItem(f.km, `<div class="flyer ${f.dir < 0 ? 'rtl' : ''}" style="--dur:${f.dur}s;--delay:${delay.toFixed(1)}s;--rx:${(30 + (i * 23) % 50).toFixed(0)}vw;width:${f.w}px"><span class="flyer-art">${FLYER_ART[f.art]}</span>${cap(f.cap, dir, 10, `left:50%;top:${(-h / 2 - 2).toFixed(1)}px`)}</div>`, 'sight');
    });
    BANDS.forEach((b) => addItem(b.km, `<div class="${b.cls}"></div>${cap(b.cap, 'l', 0, 'left:calc(100% - var(--cap-edge))')}`, 'band-item'));
  }

  function buildWorld() {
    worldEl.innerHTML = '';
    frontEl.innerHTML = '';
    items = [];
    grounded = [];

    buildGround();
    // Clouds come first, so every sight and caption sits in front of them.
    // A deck around 2 km (the "cloud break") plus scattered puffs.
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
    addItem(8.849, `<div class="peak">${everestSVG()}${cap({ name: 'Everest', fig: '8,849 m' }, 'l', 16, 'left:50%;top:-2px')}</div>`, 'landmark right');
    addItem(11, `<div class="plane-lane"><div class="plane"><span class="contrail"></span>${airlinerSVG('sk-air')}</div>
        ${cap({ name: 'Airliners', fig: '11 km' }, 'l', 0, 'left:calc(100% - var(--cap-edge));top:50%')}</div>`, 'landmark');
    addItem(20, `<div class="ozone"></div>${cap({ name: 'Ozone layer', fig: '20 km' }, 'l', 0, 'left:calc(100% - var(--cap-edge))')}`, 'band-item');
    buildSights();
    addItem(39, `<div class="diver"><span class="diver-trail"></span>
        <svg viewBox="0 0 20 20"><circle cx="10" cy="4" r="3" fill="#F2E6CF"/><path d="M10,7 L10,13 M10,9 L4,6 M10,9 L16,6 M10,13 L6,19 M10,13 L14,19" stroke="#F2E6CF" stroke-width="2" stroke-linecap="round"/></svg>
        ${cap({ name: 'Record skydive', fig: '39 km' }, 'r', 12, 'left:0;top:-12px')}</div>`, 'landmark left');
    addItem(50, `<div class="w-line"></div>${cap({ name: 'Stratopause', fig: '50 km' }, 'l', 0, 'left:calc(100% - var(--cap-edge))')}`, 'line-item');
    addItem(100, `<div class="w-line karman"></div>${cap({ name: 'Kármán line', fig: '100 km', note: 'space begins' }, 'r', 0, 'left:50%')}`, 'line-item karman-item');
    if (pbKm > 0.5) {
      addItem(pbKm, `<div class="w-line pb"></div>${cap({ name: 'Your best', fig: `${pbKm.toFixed(1)} km` }, 'l', 0, 'left:calc(100% - var(--cap-edge))')}`, 'line-item pb-item');
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
    layoutGrounded();
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
  let tuckT = 0;
  const hits = (a, b, pad = 6) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  function tuckCaptions() {
    const dock = document.getElementById('dock');
    const dockTop = dock && !dock.hidden ? dock.getBoundingClientRect().top : Infinity;
    const env = rigEl.getBoundingClientRect();
    const balloon = { left: env.left + env.width * 0.1, right: env.right - env.width * 0.1, top: env.top, bottom: env.bottom };
    for (const it of items) {
      if (!it.visible) continue;
      const lab = it.label || (it.label = it.el.querySelector('.w-label') || false);
      if (!lab) continue;
      const r = lab.getBoundingClientRect();
      lab.classList.toggle('tucked', r.bottom > dockTop - 10 || hits(r, balloon));
    }
  }

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

    // Captions never sit on the card or across the balloon: tuck them away (5×/s is plenty)
    if (now - tuckT > 200) { tuckT = now; tuckCaptions(); }

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
