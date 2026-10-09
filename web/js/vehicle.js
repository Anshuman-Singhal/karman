/* ==========================================================================
   KÁRMÁN · vehicle.js
   The craft you fly, drawn as one inline SVG (viewBox 0 0 200 250). It is a
   "rockoon", the real technique of lifting a rocket by balloon and firing it
   from the thin upper air, so the vehicle evolves as you climb:

     stage 0   0–15 km     hot-air balloon with a wicker basket
     stage 1   15–21 km    same balloon, basket rebuilt as a sealed gondola
     stage 2   21–45 km    thin stratospheric helium balloon, a rocket
                           assembled beneath it
     stage 3   45–100 km   the rocket drops, ignites and climbs
     stage 4   100–120 km  tower and booster gone: the crew capsule coasts
     stage 5   120 km +    the capsule unfolds its solar panels

   Each change is a short build rather than a swap, like a suit-up: parts
   slide and bolt on one at a time with small mechanical beats (≈1–1.4 s),
   timed to the K.audio.stage cues. Every part is its own group, animated
   with the Web Animations API (transform and opacity only, so it stays
   on the compositor-friendly path), and the end state of each build is
   exactly the next stage's resting look, so the hand-off is invisible.

   scene.js owns where the craft sits on screen; this file owns what it looks
   like. Each frame scene.js calls frame(), which advances the slow idle
   motion (turning gores, tapes, plume flicker) and plays the build whenever
   the altitude crosses a stage boundary. Results and reloads call set(km)
   to jump straight to the right stage with no build.

   Every colour is a literal hex (no CSS variables), so the live SVG can be
   serialised into the share image as-is.
   ========================================================================== */

K.vehicle = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const STAGES = [15, 21, 45, 100, 120];            // km where each stage starts
  const stageOf = (km) => STAGES.filter((s) => km >= s).length;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const C = {
    ember: '#FF6A3D', paper: '#F3E9D6', amber: '#FFB547', navy: '#1E2A55',
    night: '#0A0D1C', steel: '#3A4566', shade: '#CDBFA6', wicker: '#8A5A34',
    weave: '#6B4227', rim: '#5A3720', cream: '#FFF1C9', ink: '#22305A',
    fin: '#E2543A', finShade: '#B9402C', steelLit: '#6E7896',
  };
  // The hand-inked contour shared by every hard part: drawn under the fill.
  const INKED = `stroke="${C.ink}" stroke-opacity=".6" stroke-width="1.3" stroke-linejoin="round" paint-order="stroke"`;

  /* ---------------------------------------------------------- envelope shape
     Half-width r at height y: an inverted pear with a high shoulder. A
     monotone cubic through these points keeps the silhouette smooth. */
  const R_PTS = [[8, 0], [14, 30], [26, 50], [44, 61], [62, 64], [84, 60], [106, 48], [126, 32], [142, 19], [150, 15]];
  const rAt = (() => {
    const xs = R_PTS.map((p) => p[0]), ys = R_PTS.map((p) => p[1]);
    const n = xs.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    return (y) => {
      if (y <= xs[0]) return ys[0];
      if (y >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (y > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (y - xs[i]) / h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  })();
  const ENV_YS = [];
  for (let y = 8; y <= 150; y += 3) ENV_YS.push(y);
  if (ENV_YS[ENV_YS.length - 1] !== 150) ENV_YS.push(150);
  const ENV_R = ENV_YS.map(rAt);
  const xOn = (phi, i) => 100 + ENV_R[i] * Math.sin(phi);

  function envelopePath() {
    let d = '';
    ENV_YS.forEach((y, i) => { d += `${i ? 'L' : 'M'}${(100 - ENV_R[i]).toFixed(2)},${y}`; });
    for (let i = ENV_YS.length - 1; i >= 0; i--) d += `L${(100 + ENV_R[i]).toFixed(2)},${ENV_YS[i]}`;
    return d + 'Z';
  }
  /** One gore between longitudes a and b (front half only, |φ| ≤ π/2). */
  function gorePath(a, b) {
    let d = '';
    ENV_YS.forEach((y, i) => { d += `${i ? 'L' : 'M'}${xOn(a, i).toFixed(2)},${y}`; });
    for (let i = ENV_YS.length - 1; i >= 0; i--) d += `L${xOn(b, i).toFixed(2)},${ENV_YS[i]}`;
    return d + 'Z';
  }
  function meridianPath(phi) {
    let d = '';
    ENV_YS.forEach((y, i) => { d += `${i ? 'L' : 'M'}${xOn(phi, i).toFixed(2)},${y}`; });
    return d;
  }

  /** A truncated-cone shell: top width tw at y, base width bw at y + h. */
  const capsule = (cx, y, tw, bw, h) => `M${cx - tw / 2},${y} L${cx + tw / 2},${y} L${cx + bw / 2},${y + h} L${cx - bw / 2},${y + h}Z`;

  /* ---------------------------------------------------------- the crew capsule
     Drawn once in rocket coordinates (neck top y 38, heat shield y 74.5),
     reused on the rocket and, scaled about CAP_O, as the free-flying capsule,
     so separation can carry one onto the other without a seam. The porthole
     sits on the capsule's flank, between its shingles, not on any tip. */
  const CAP_O = [100, 56], ORB_C = [100, 120], ORB_S = 1.8;
  const capsuleArt = () => `
    <rect x="94" y="38" width="12" height="8.4" rx="1.2" fill="${C.paper}" ${INKED}/>
    <rect x="94" y="38" width="12" height="8.4" rx="1.2" fill="url(#v-body)"/>
    <path d="M93,46 L107,46 L115,70 L85,70Z" fill="${C.paper}" ${INKED}/>
    <path d="M93,46 L107,46 L115,70 L85,70Z" fill="url(#v-body)"/>
    <path d="M90.6,53.6 H109.4 M88,62 H112" stroke="${C.ink}" stroke-opacity=".22" stroke-width=".6"/>
    <path d="M93.3,46.6 L86.4,69.2" stroke="#FFFFFF" stroke-opacity=".55" stroke-width=".9" stroke-linecap="round"/>
    <circle cx="100" cy="58" r="5.6" fill="${C.amber}" opacity=".18"/>
    <circle cx="100" cy="58" r="3.5" fill="${C.night}" stroke="${C.amber}" stroke-width="1.2"/>
    <path d="M98.2,56.6 Q99,55.6 100.4,55.5" stroke="${C.cream}" stroke-width=".7" fill="none" stroke-linecap="round"/>
    <path d="M84,70 L116,70 L116,72 Q116,74.5 112.5,74.5 L87.5,74.5 Q84,74.5 84,72Z" fill="${C.navy}" ${INKED}/>`;

  /* ---------------------------------------------------------- state */
  let svg = null;
  let el = {};
  let stage = 0;                 // the stage currently shown (or building toward)
  let busyUntil = 0;             // builds play one at a time
  const gores = { n: 12, phase: 0.35, spin: 0.22 };
  let tapePhase = 0;
  let kickT0 = 0, kickAmp = 0;   // take-off: the basket trails the envelope, then settles
  let tiltCur = 0, tiltV = '';   // the rocket's lean, eased (never snapped) between stages
  let blinkV = '';

  /* ---------------------------------------------------------- build */
  function build(svgEl) {
    svg = svgEl;
    const env = envelopePath();
    svg.setAttribute('viewBox', '0 0 200 250');
    svg.setAttribute('xmlns', NS);
    const gond = capsule(100, 190, 22, 36, 30);
    // A solar-panel segment: navy cells, amber leading, a cool sheen.
    const seg = (x, cls, ox) => `<g class="${cls}" style="transform-origin:${ox}px 131px">
        <rect x="${x}" y="124.2" width="15" height="13.6" fill="${C.navy}" stroke="${C.amber}" stroke-width=".6"/>
        <path d="M${x + 7.5},124.2 V137.8 M${x},131 H${x + 15}" stroke="${C.amber}" stroke-width=".45" stroke-opacity=".8"/>
        <path d="M${x + 1.5},136.4 L${x + 6},125.6" stroke="#9DB6E8" stroke-opacity=".35" stroke-width="1.2"/></g>`;
    svg.innerHTML = `
      <defs>
        <clipPath id="v-env"><path d="${env}"/></clipPath>
        <clipPath id="v-gclip"><path d="${gond}"/></clipPath>
        <linearGradient id="v-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${C.amber}" stop-opacity=".18"/>
          <stop offset=".38" stop-color="${C.amber}" stop-opacity="0"/>
          <stop offset=".6" stop-color="${C.night}" stop-opacity="0"/>
          <stop offset="1" stop-color="${C.night}" stop-opacity=".45"/>
        </linearGradient>
        <linearGradient id="v-vert" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
          <stop offset=".7" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="${C.night}" stop-opacity=".3"/>
        </linearGradient>
        <linearGradient id="v-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${C.cream}"/>
          <stop offset=".4" stop-color="${C.amber}"/>
          <stop offset=".85" stop-color="${C.ember}"/>
          <stop offset="1" stop-color="${C.ember}" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="v-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#FFD27A" stop-opacity=".9"/>
          <stop offset=".5" stop-color="${C.ember}" stop-opacity=".3"/>
          <stop offset="1" stop-color="${C.ember}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="v-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FFFFFF" stop-opacity=".35"/>
          <stop offset=".3" stop-color="${C.paper}" stop-opacity="0"/>
          <stop offset=".66" stop-color="${C.shade}" stop-opacity="0"/>
          <stop offset=".67" stop-color="${C.shade}" stop-opacity=".9"/>
          <stop offset="1" stop-color="${C.shade}" stop-opacity=".9"/>
        </linearGradient>
        <linearGradient id="v-steel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${C.steelLit}"/><stop offset=".45" stop-color="${C.steel}"/><stop offset="1" stop-color="#262E48"/>
        </linearGradient>
        <linearGradient id="v-plume" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${C.cream}"/>
          <stop offset=".25" stop-color="${C.amber}"/>
          <stop offset=".7" stop-color="${C.ember}" stop-opacity=".6"/>
          <stop offset="1" stop-color="${C.ember}" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="v-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".75"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- STAGES 0–1: the hot-air balloon -->
      <g class="v-hot" style="transform-origin:100px 8px">
        <g class="v-glowwrap"><circle class="v-burnglow" cx="100" cy="162" r="30" fill="url(#v-glow)"/></g>
        <g clip-path="url(#v-env)">
          <!-- Ember is the ground; only the paper gores are drawn over it, so
               neighbouring ember gores never leave an anti-aliased seam that
               shimmers as the envelope turns. -->
          <path d="${env}" fill="${C.ember}"/>
          <g class="v-gores" fill="${C.paper}"></g>
          <g class="v-pins" fill="none" stroke="${C.amber}" stroke-width=".8"></g>
          <g class="v-teeth" fill="${C.navy}"></g>
          <path d="${env}" fill="url(#v-vert)"/>
          <path d="${env}" fill="url(#v-shade)"/>
        </g>
        <!-- the same hand-inked contour as the sights in the sky -->
        <path d="${env}" fill="none" stroke="${C.ink}" stroke-opacity=".5" stroke-width="1.2" stroke-linejoin="round"/>
        <g class="v-medal">
          <circle r="8" fill="${C.paper}" stroke="${C.navy}" stroke-width="1.4"/>
          <path d="M-3.6,1.8 L0,-2.2 L3.6,1.8" fill="none" stroke="${C.navy}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <ellipse cx="100" cy="11" rx="12" ry="4" fill="${C.amber}" stroke="${C.navy}" stroke-width="1.5"/>
        <ellipse class="v-frost" cx="100" cy="11" rx="13.5" ry="5.2" fill="none" stroke="${C.paper}" stroke-width="1.6" opacity="0"/>
        <path d="M85,150 L115,150 L111,162 L89,162Z" fill="${C.navy}"/>
        <g class="v-flame" style="transform-origin:100px 168px">
          <path d="M100,150 C95.5,156 95,162 96,165 Q100,169.5 104,165 C105,162 104.5,156 100,150Z" fill="url(#v-flame)"/>
        </g>

        <!-- stage 0: ropes + wicker basket -->
        <g class="v-basket" style="transform-origin:100px 196px">
          <g class="v-swing" style="transform-origin:100px 164px">
            <g stroke="#2A2730" stroke-width="1" opacity=".9">
              <line x1="86" y1="162" x2="84" y2="196"/><line x1="94" y1="162" x2="92" y2="196"/>
              <line x1="106" y1="162" x2="108" y2="196"/><line x1="114" y1="162" x2="116" y2="196"/>
            </g>
            <rect x="92" y="168" width="16" height="8" rx="1.5" fill="${C.steel}"/>
            <path d="M83,196 L117,196 L115,219 Q115,222 112,222 L88,222 Q85,222 85,219Z" fill="${C.wicker}" ${INKED}/>
            <g stroke="${C.weave}" stroke-width="1">
              <line x1="84" y1="204" x2="116" y2="204"/><line x1="84.5" y1="208" x2="115.5" y2="208"/>
              <line x1="85" y1="212" x2="115" y2="212"/><line x1="85" y1="216" x2="115" y2="216"/>
              <line x1="92" y1="200" x2="92" y2="221"/><line x1="100" y1="200" x2="100" y2="222"/><line x1="108" y1="200" x2="108" y2="221"/>
            </g>
            <rect x="82" y="196" width="36" height="4.5" rx="2" fill="${C.rim}"/>
          </g>
        </g>

        <!-- stage 1: ropes to a ring + sealed gondola, built from parts -->
        <g class="v-gondola" style="opacity:0">
          <g class="v-swing2" style="transform-origin:100px 164px">
            <g class="g-ropes" stroke="#2A2730" stroke-width="1" opacity=".9">
              <line x1="86" y1="162" x2="100" y2="182" pathLength="1"/><line x1="94" y1="162" x2="100" y2="182" pathLength="1"/>
              <line x1="106" y1="162" x2="100" y2="182" pathLength="1"/><line x1="114" y1="162" x2="100" y2="182" pathLength="1"/>
            </g>
            <rect x="92" y="168" width="16" height="8" rx="1.5" fill="${C.steel}"/>
            <circle cx="100" cy="182" r="2.2" fill="none" stroke="${C.steel}" stroke-width="1.4"/>
            <rect class="g-hanger" x="94" y="185.6" width="12" height="4.6" rx="1" fill="url(#v-steel)" style="transform-origin:100px 186px"/>
            <path class="g-frame" d="${gond}" fill="${C.navy}" fill-opacity=".55" stroke="${C.ink}" stroke-width="1.3" stroke-linejoin="round" pathLength="1"/>
            <path class="g-left" d="M89,190 L100,190 L100,220 L82,220Z" fill="${C.paper}"/>
            <path class="g-right" d="M100,190 L111,190 L118,220 L100,220Z" fill="#E4D8C2"/>
            <path class="g-seam" d="M100,190.6 V219.4" stroke="${C.ink}" stroke-opacity=".3" stroke-width=".6"/>
            <path class="g-outline" d="${gond}" fill="none" ${INKED}/>
            <path class="g-rivets" d="M86.6,197 h.01 M84.8,205 h.01 M83,213 h.01 M113.4,197 h.01 M115.2,205 h.01 M117,213 h.01" stroke="${C.ink}" stroke-opacity=".45" stroke-width="1.3" stroke-linecap="round"/>
            <g class="g-port" style="transform-origin:100px 204px">
              <circle cx="100" cy="204" r="9" fill="${C.amber}" opacity=".35"/>
              <circle cx="100" cy="204" r="5.5" fill="${C.night}" stroke="${C.amber}" stroke-width="1.5"/>
              <path d="M97.6,202.2 Q98.6,201 100.4,200.8" stroke="${C.cream}" stroke-width=".8" fill="none" stroke-linecap="round"/>
            </g>
            <path class="g-skid" d="M82,220 Q100,228 118,220 L118,221.5 Q100,229.5 82,221.5Z" fill="${C.navy}" style="transform-origin:100px 222px"/>
            <g clip-path="url(#v-gclip)"><rect class="g-sheen" x="70" y="186" width="16" height="40" fill="url(#v-sheen)" opacity="0" transform="rotate(14 78 206)"/></g>
            <path class="v-gfrost" d="${gond}" fill="none" stroke="#fff" stroke-width="1.2" opacity="0"/>
          </g>
        </g>
      </g>

      <!-- STAGE 2: stratospheric helium balloon on a long flight line -->
      <g class="v-helium" style="transform-origin:100px 9px;opacity:0">
        <path class="v-bubble" fill="#DCE6F5" fill-opacity=".22" stroke="${C.paper}" stroke-opacity=".9" stroke-width="1.2"/>
        <g class="v-tapes" fill="none" stroke="${C.paper}" stroke-opacity=".4" stroke-width=".8"></g>
        <g class="v-pleats" fill="none" stroke="${C.paper}" stroke-opacity=".5" stroke-width=".7"></g>
        <ellipse class="v-valve" cx="100" cy="10" rx="6" ry="2" fill="${C.amber}"/>
        <line class="h-line" x1="100" y1="118" x2="100" y2="139" stroke="${C.paper}" stroke-opacity=".7" stroke-width=".9" pathLength="1"/>
        <path class="h-chute" d="M95.4,123 L104.6,123 L101.6,130.4 L98.4,130.4Z" fill="${C.ember}" ${INKED} style="transform-origin:100px 126px"/>
      </g>

      <!-- STAGES 2–3: the rocket. A crew capsule under an escape tower, an
           adapter, a booster with a black-and-white roll pattern, swept fins. -->
      <g class="v-payload" style="transform-origin:100px 40px;opacity:0">
        <g class="v-tilt" style="transform-origin:100px 110px">
          <g class="v-plumewrap" style="transform-origin:100px 186px">
            <circle cx="100" cy="190" r="30" fill="url(#v-glow)" opacity=".5"/>
            <path class="v-plume-o" fill="${C.ember}" opacity=".55"/>
            <path class="v-plume-m" fill="url(#v-plume)"/>
            <path class="v-plume-c" fill="${C.cream}" opacity=".9"/>
          </g>
          <g class="v-booster" style="transform-origin:100px 130px">
            <path class="r-finL" d="M87,144 L75.6,168 L74.6,180 L87,172Z" fill="${C.fin}" ${INKED} style="transform-origin:87px 160px"/>
            <path class="r-finR" d="M113,144 L124.4,168 L125.4,180 L113,172Z" fill="${C.finShade}" ${INKED} style="transform-origin:113px 160px"/>
            <path class="r-bell" d="M93.4,172.6 L106.6,172.6 L110,184.4 L90,184.4Z" fill="url(#v-steel)" ${INKED} style="transform-origin:100px 173px"/>
            <g class="r-body">
              <path d="M87,86 L113,86 L113,166 L115.4,173 L84.6,173 L87,166Z" fill="${C.paper}" ${INKED}/>
              <path d="M87,86 L113,86 L113,166 L87,166Z" fill="url(#v-body)"/>
              <path d="M87,92 H100 V100 H87Z M100,100 H113 V108 H100Z" fill="${C.navy}"/>
              <path d="M87,140 H113 V143 H87Z" fill="${C.navy}"/>
              <path d="M84.6,173 L87,166 L113,166 L115.4,173Z" fill="url(#v-steel)"/>
              <path d="M90.4,112 V160" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="1" stroke-linecap="round"/>
              <path d="M100,148 V164" stroke="${C.fin}" stroke-width="2.6"/>
            </g>
            <path class="r-finM" d="M98.6,152 L101.4,152 L101.4,182.4 L98.6,182.4Z" fill="${C.fin}" ${INKED} style="transform-origin:100px 152px"/>
            <g class="r-inter" style="transform-origin:100px 80px">
              <path d="M85,74.5 L115,74.5 L113,86 L87,86Z" fill="${C.navy}" ${INKED}/>
              <path d="M89,80.2 h.01 M95,80.2 h.01 M101,80.2 h.01 M107,80.2 h.01" stroke="${C.amber}" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="round"/>
            </g>
          </g>
          <g class="r-tower" style="transform-origin:100px 38px">
            <path d="M95.6,38 L99,22.5 M104.4,38 L101,22.5 M95.6,38 L103.2,32.4 L96.8,27.4 L101.5,23.4" fill="none" stroke="${C.steelLit}" stroke-width=".9" stroke-linejoin="round"/>
            <path d="M97.4,22.6 h5.2 l-.7,1.8 h-3.8Z" fill="${C.steel}"/>
            <path d="M98.5,13 L101.5,13 L101.5,22.6 L98.5,22.6Z" fill="${C.fin}" ${INKED}/>
            <path d="M98.5,13 L100,7.4 L101.5,13Z" fill="${C.paper}" ${INKED}/>
          </g>
          <g class="v-rcap" style="transform-origin:${CAP_O[0]}px ${CAP_O[1]}px">${capsuleArt()}</g>
          <circle class="v-flash" cx="100" cy="186" r="40" fill="#FFF6DF" opacity="0" style="transform-origin:100px 186px"/>
        </g>
      </g>

      <!-- STAGES 4–5: the capsule alone, panels stowed and then unfolded -->
      <g class="v-orbiter" style="transform-origin:100px 120px;opacity:0">
        <g class="v-bob4" style="transform-origin:100px 124px">
          <g class="o-wing">
            <rect class="o-boomL" x="71" y="129.8" width="8" height="2.4" fill="${C.steel}" style="transform-origin:79px 131px"/>
            ${seg(56, 'o-seg o-segL1', 71)}${seg(41, 'o-seg o-segL2', 56)}${seg(26, 'o-seg o-segL3', 41)}
            <rect x="121" y="129.8" width="8" height="2.4" fill="${C.steel}" class="o-boomR" style="transform-origin:121px 131px"/>
            ${seg(129, 'o-seg o-segR1', 129)}${seg(144, 'o-seg o-segR2', 144)}${seg(159, 'o-seg o-segR3', 159)}
          </g>
          <g class="o-pack" fill="${C.navy}" stroke="${C.amber}" stroke-width=".5"><rect x="74.6" y="124.6" width="4" height="12.8" rx=".6"/><rect x="121.4" y="124.6" width="4" height="12.8" rx=".6"/></g>
          <line class="o-ant1" x1="100" y1="88" x2="100" y2="77" stroke="${C.steelLit}" stroke-width="1.3" style="transform-origin:100px 88px"/>
          <line class="o-ant2" x1="100" y1="77.5" x2="100" y2="68" stroke="${C.steelLit}" stroke-width=".9" style="transform-origin:100px 77.5px"/>
          <circle class="v-tip" cx="100" cy="68" r="1.9" fill="${C.amber}"/>
          <g transform="translate(${ORB_C[0]} ${ORB_C[1]}) scale(${ORB_S}) translate(${-CAP_O[0]} ${-CAP_O[1]})">${capsuleArt()}</g>
        </g>
      </g>`;

    const q = (s) => svg.querySelector(s);
    const qa = (s) => Array.from(svg.querySelectorAll(s));
    el = {
      hot: q('.v-hot'), gores: q('.v-gores'), pins: q('.v-pins'), teeth: q('.v-teeth'), medal: q('.v-medal'),
      frost: q('.v-frost'), flame: q('.v-flame'), glow: q('.v-glowwrap'),
      basket: q('.v-basket'), swing: q('.v-swing'), gondola: q('.v-gondola'), swing2: q('.v-swing2'), gfrost: q('.v-gfrost'),
      gRopes: qa('.g-ropes line'), gHanger: q('.g-hanger'), gFrame: q('.g-frame'), gLeft: q('.g-left'), gRight: q('.g-right'),
      gSeam: q('.g-seam'), gOutline: q('.g-outline'), gRivets: q('.g-rivets'), gPort: q('.g-port'), gSkid: q('.g-skid'), gSheen: q('.g-sheen'),
      helium: q('.v-helium'), bubble: q('.v-bubble'), tapes: q('.v-tapes'), pleats: q('.v-pleats'), valve: q('.v-valve'),
      hLine: q('.h-line'), hChute: q('.h-chute'),
      payload: q('.v-payload'), tilt: q('.v-tilt'), plume: q('.v-plumewrap'), booster: q('.v-booster'), rcap: q('.v-rcap'),
      finL: q('.r-finL'), finR: q('.r-finR'), finM: q('.r-finM'), bell: q('.r-bell'), body: q('.r-body'), inter: q('.r-inter'), tower: q('.r-tower'),
      po: q('.v-plume-o'), pm: q('.v-plume-m'), pc: q('.v-plume-c'), flash: q('.v-flash'),
      orbiter: q('.v-orbiter'), bob4: q('.v-bob4'), tip: q('.v-tip'),
      booms: [q('.o-boomL'), q('.o-boomR')], segs: [1, 2, 3].map((i) => [q(`.o-segL${i}`), q(`.o-segR${i}`)]), pack: q('.o-pack'),
      ant: [q('.o-ant1'), q('.o-ant2')],
    };
    // Pools of paths reused every frame (no DOM churn while turning).
    el.gorePool = pool(el.gores, 12);
    el.pinPool = pool(el.pins, 10);
    el.teethPool = pool(el.teeth, 30);
    el.tapePool = pool(el.tapes, 10);
    el.pleatPool = pool(el.pleats, 3);
  }

  function pool(parent, n) {
    return Array.from({ length: n }, () => parent.appendChild(document.createElementNS(NS, 'path')));
  }

  /* ---------------------------------------------------------- per-stage looks */
  const PAYLOAD_HANG = 'translate(0px, 118px) scale(0.6)';      // under the helium balloon
  const PAYLOAD_FLY = 'translate(0px, 0px) scale(1)';
  // The rocket's capsule, carried onto the free-flying capsule's place and size.
  const CAP_TO_ORB = `translate(${ORB_C[0] - CAP_O[0]}px, ${ORB_C[1] - CAP_O[1]}px) scale(${ORB_S})`;

  const vis = (node, on) => { node.style.opacity = on ? '1' : '0'; node.style.visibility = on ? 'visible' : 'hidden'; };

  /** Jump straight to the look of a stage (no animation). */
  function show(s) {
    stage = s;
    // Cancel every running build (but not the root's own squash keyframes).
    svg.getAnimations({ subtree: true }).forEach((a) => { if (a.effect && a.effect.target !== svg) a.cancel(); });
    [el.hot, el.basket, el.gondola, el.helium, el.payload, el.booster, el.rcap, el.plume, el.orbiter].forEach((n) => { n.style.transform = ''; });
    vis(el.hot, s <= 1);
    vis(el.basket, s === 0);
    vis(el.gondola, s === 1);
    vis(el.helium, s === 2);
    vis(el.payload, s === 2 || s === 3);
    vis(el.booster, true);
    vis(el.rcap, true);
    vis(el.tower, true);
    vis(el.plume, s === 3);
    el.payload.style.transform = s === 2 ? PAYLOAD_HANG : PAYLOAD_FLY;
    vis(el.orbiter, s >= 4);
    // Panels: stowed in their packs at stage 4, unfolded at 5.
    const out = s >= 5;
    el.booms.forEach((b) => { b.style.transform = out ? '' : 'scaleX(0)'; });
    el.segs.forEach((pair) => pair.forEach((g) => { g.style.transform = out ? '' : 'scaleX(0)'; }));
    el.pack.style.opacity = out ? '0' : '1';
    el.ant.forEach((a) => { a.style.transform = out ? '' : 'scaleY(0)'; });
    el.flash.setAttribute('opacity', '0');
    if (s !== 3) { tiltCur = s > 3 ? 0 : tiltCur; }
  }

  /* ---------------------------------------------------------- builds */
  const SNAP = 'cubic-bezier(.2,1.5,.4,1)';           // a part lands and bolts home
  const OUT = 'cubic-bezier(.16,1,.3,1)';
  const IN = 'cubic-bezier(.55,0,1,.45)';
  const anim = (node, frames, ms, delay = 0, easing = OUT) =>
    node.animate(frames, { duration: ms, delay, easing, fill: 'both' });
  const appear = (node) => { node.style.visibility = 'visible'; node.style.opacity = '1'; };
  /** A small mechanical beat: a soft click (sound off: nothing). */
  const click = (ms) => setTimeout(() => { if (K.audio && K.audio.tick) K.audio.tick(); }, ms);
  const later = (ms, fn) => setTimeout(fn, ms);

  function play(to, quick) {
    const k = quick ? 0.6 : 1;
    const calm = K.fx.reduced();
    const from = stage;
    stage = to;
    if (calm) {
      // Reduced motion: a 200 ms crossfade between end states.
      svg.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 200 });
      setTimeout(() => show(to), 100);
      return 220;
    }
    const pt = (x, y) => K.scene.svgPoint(x, y);
    const T = (ms) => ms * k;

    if (from === 0 && to === 1) {
      /* 15 km · the basket is rebuilt as a sealed gondola: the wicker folds
         away, the ropes re-rig to a ring, a frame draws itself, two shell
         halves slide shut (the cue's thunk), the hatch drops, the skid bolts
         on, the porthole irises open, a glint of frost runs across it. */
      K.audio.stage('seal');
      const p = pt(100, 205);
      K.fx.embers(p.x, p.y, { count: 8, speed: 70, life: 0.6, color: C.paper });
      K.scene.flare(1.1);
      appear(el.gondola);
      anim(el.basket, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(5px) scale(.8, .7)', opacity: 0 }], T(320), 0, IN);
      el.gRopes.forEach((r, i) => anim(r, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], T(260), T(60 + i * 40)));
      anim(el.gHanger, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], T(160), T(200));
      anim(el.gFrame, [{ strokeDasharray: '1 1', strokeDashoffset: 1, fillOpacity: 0 }, { strokeDasharray: '1 1', strokeDashoffset: 0, fillOpacity: 0.55 }], T(380), T(80));
      anim(el.gLeft, [{ transform: 'translateX(-16px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], T(220), T(120), SNAP);
      anim(el.gRight, [{ transform: 'translateX(16px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], T(220), T(180), SNAP);
      [el.gSeam, el.gOutline, el.gRivets].forEach((n) => anim(n, [{ opacity: 0 }, { opacity: 1 }], T(120), T(380)));
      anim(el.gSkid, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], T(220), T(520), SNAP);
      anim(el.gPort, [{ transform: 'scale(0) rotate(-90deg)', opacity: 0 }, { transform: 'scale(1.18) rotate(0deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], T(320), T(700));
      anim(el.gSheen, [{ transform: 'rotate(14deg) translateX(0)', opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { transform: 'rotate(14deg) translateX(48px)', opacity: 0 }], T(420), T(980), 'ease-in-out');
      click(T(540)); click(T(760));
      later(T(820), () => { const q2 = pt(100, 204); K.fx.embers(q2.x, q2.y, { count: 5, speed: 40, life: 0.5, color: C.amber }); });
      return T(1400);
    }
    if (from === 1 && to === 2) {
      /* 21 km · the hot-air envelope gives way to a helium balloon, and a
         rocket is assembled under it section by section: capsule lowered on
         the line, adapter, booster slid up and bolted (the cue's two latch
         clicks), engine bell, fins unfolding, escape tower last. */
      K.audio.stage('swap');
      appear(el.helium); appear(el.payload);
      el.payload.style.transform = PAYLOAD_HANG;
      el.plume.style.visibility = 'hidden'; el.plume.style.opacity = '0';
      anim(el.flame, [{ transform: el.flame.style.transform || 'scale(1)' }, { transform: 'scale(0.2, 0)' }], T(160), 0, IN);
      anim(el.hot, [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(.3) translateY(-34px)', opacity: 0 }], T(520), T(60), IN);
      anim(el.helium, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.05)', opacity: 1, offset: 0.75 }, { transform: 'scale(1)', opacity: 1 }], T(520), T(140));
      anim(el.hLine, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], T(200), T(380));
      anim(el.hChute, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], T(200), T(440), SNAP);
      anim(el.rcap, [{ transform: 'translateY(-36px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], T(300), T(460), SNAP);
      anim(el.inter, [{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], T(200), T(560), SNAP);
      anim(el.body, [{ transform: 'translateY(46px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], T(300), T(600), SNAP);
      anim(el.bell, [{ transform: 'translateY(14px) scaleY(.4)', opacity: 0 }, { transform: 'translateY(0) scaleY(1)', opacity: 1 }], T(200), T(820), SNAP);
      anim(el.finM, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], T(180), T(880), SNAP);
      anim(el.finL, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], T(240), T(940), SNAP);
      anim(el.finR, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], T(240), T(980), SNAP);
      anim(el.tower, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], T(260), T(1120), SNAP);
      click(T(1000)); click(T(1240));
      return T(1450);
    }
    if (from === 2 && to === 3) {
      /* 45 km · the line is cut, the balloon sails off, the rocket falls
         clear and swings upright, ignites (the cue's held breath, then fire). */
      K.audio.stage('ignite');
      const cut = pt(100, 136);
      K.fx.sparks(cut.x, cut.y, { count: 12, speed: 150, color: C.amber });
      anim(el.hChute, [{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: 0.3 }, { transform: 'scale(1.3)' }], T(300), 0);
      anim(el.helium, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-260px)', opacity: 0 }], T(820), T(120), IN);
      anim(el.payload, [
        { transform: PAYLOAD_HANG },
        { transform: 'translate(0px, 128px) scale(0.6) rotate(-3deg)', offset: 0.35, easing: IN },
        { transform: 'translate(0px, -4px) scale(1.02) rotate(1deg)', offset: 0.8 },
        { transform: PAYLOAD_FLY },
      ], T(1000), T(120));
      appear(el.plume);
      anim(el.plume, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], T(520), T(420));
      later(T(400), () => {
        const n = pt(100, 186);
        K.fx.ringBurst(n.x, n.y, '#FFD9A0');
        K.fx.embers(n.x, n.y, { count: 24, speed: 240, color: C.amber });
        K.fx.nudge();
        el.flash.animate([{ transform: 'scale(0)', opacity: 0.9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 260, easing: 'ease-out' });
      });
      return T(1180);
    }
    if (from === 3 && to === 4) {
      /* 100 km · engine cut-off; the escape tower fires away (first pop),
         the booster falls clear (second pop), and on the chime the capsule
         glides forward to fill the frame. */
      K.audio.stage('separate');
      anim(el.plume, [{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(.2)' }], T(140), 0);
      const tw = pt(100, 30);
      K.fx.sparks(tw.x, tw.y, { count: 8, speed: 120, color: C.cream });
      anim(el.tower, [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(18px,-60px) rotate(32deg)', opacity: 0 }], T(620), 0, 'cubic-bezier(.2,.7,.4,1)');
      later(T(90), () => { const s2 = pt(100, 80); K.fx.sparks(s2.x, s2.y, { count: 10, speed: 140, color: C.paper }); });
      anim(el.booster, [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: 'translateY(8px) rotate(2deg)', opacity: 1, offset: 0.15 }, { transform: 'translateY(110px) rotate(24deg)', opacity: 0 }], T(820), T(90), IN);
      anim(el.rcap, [{ transform: 'translate(0,0) scale(1)' }, { transform: CAP_TO_ORB }], T(720), T(260), 'cubic-bezier(.45,0,.2,1)');
      later(T(940), () => {
        const a = pt(82, 128), b = pt(118, 128);
        K.fx.embers(a.x, a.y, { count: 3, speed: 40, life: 0.5, color: C.paper });
        K.fx.embers(b.x, b.y, { count: 3, speed: 40, life: 0.5, color: C.paper });
      });
      // The free capsule (identical at its resting place) takes over as the build ends.
      return T(1080);
    }
    if (from === 4 && to === 5) {
      /* 120 km · solar panels: the booms swing out of their packs, then
         each wing unfolds one segment at a time, and the antenna telescopes. */
      if (K.audio.stage) K.audio.stage('deploy');
      anim(el.pack, [{ opacity: 1 }, { opacity: 0 }], T(200), T(160));
      el.booms.forEach((b) => anim(b, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], T(200), 0, SNAP));
      el.segs.forEach((pair, i) => pair.forEach((g) => anim(g, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], T(240), T(180 + i * 190), SNAP)));
      click(T(300)); click(T(490)); click(T(680));
      anim(el.ant[0], [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], T(180), T(820), SNAP);
      anim(el.ant[1], [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], T(180), T(960), SNAP);
      later(T(1100), () => { const g = pt(30, 126); K.fx.sparks(g.x, g.y, { count: 4, speed: 30, color: C.cream }); });
      return T(1260);
    }
    show(to);                                    // any other jump: no ceremony
    return 0;
  }

  /** Move toward the stage for this altitude, one build at a time. */
  function advance(km, now) {
    const want = stageOf(km);
    if (want === stage) return;
    if (want < stage) { show(want); return; }    // descending (dev only)
    if (now < busyUntil) return;
    const next = stage + 1;
    const quick = want > next;                   // more to come: shorten this one
    const ms = play(next, quick);
    busyUntil = now + ms;
    setTimeout(() => { if (stage === next) show(next); }, ms + 40);
  }

  /* ---------------------------------------------------------- per frame */
  function frame({ km, dt, now, flame, calm }) {
    if (!svg) return;
    advance(km, now);
    const t = now / 1000;

    // Hot-air envelope: turning gores, seam pinlines, tooth band, medallion.
    if (stage <= 1 || el.hot.style.visibility !== 'hidden') {
      if (!calm) gores.phase += dt * gores.spin;
      gores.spin += (0.22 - gores.spin) * Math.min(1, dt * 1.5);
      drawEnvelope(calm ? 0.35 : gores.phase);
      el.frost.setAttribute('opacity', (clamp((km - 10) / 5, 0, 1) * 0.3).toFixed(2));
      el.gfrost.setAttribute('opacity', (clamp((km - 15) / 6, 0, 1) * 0.35).toFixed(2));
      if (!el.flame.getAnimations().length) el.flame.style.transform = `scale(${(0.8 + flame * 0.3).toFixed(3)}, ${flame.toFixed(3)})`;
      el.glow.style.opacity = clamp(flame / 1.4, 0, 1).toFixed(3);
      if (!calm) {
        let k = 0;
        if (kickT0) {
          const tau = now / 1000 - kickT0;
          if (tau > 6) kickT0 = 0;
          else k = kickAmp * Math.exp(-tau * 0.9) * Math.sin(tau * 3.1 + 0.3) - kickAmp * Math.sin(0.3) * Math.exp(-tau * 4);
        }
        el.swing.style.transform = `rotate(${(Math.sin(t * 2.03) * 2 + k).toFixed(2)}deg)`;
        el.swing2.style.transform = `rotate(${(Math.sin(t * 2.03) * 1).toFixed(2)}deg)`;
      }
    }

    // Helium balloon: fills out as the air thins.
    if (stage === 2 || el.helium.style.visibility === 'visible') {
      if (!calm) tapePhase += dt * ((Math.PI * 2) / 40);
      drawHelium(ease(clamp((km - 21) / 24, 0, 1)), tapePhase);
      if (!calm && stage === 2 && now > busyUntil) el.payload.style.transform = `${PAYLOAD_HANG} rotate(${(Math.sin(t * 1.05) * 1.5).toFixed(2)}deg)`;
    }

    // Rocket: a lean that grows as it arcs over, eased so separation never snaps it upright.
    const f = clamp((km - 45) / 55, 0, 1);
    const lean = stage === 3 ? f * 6 : 0;
    tiltCur += (lean - tiltCur) * Math.min(1, dt * 2.5);
    if (stage === 3 || stage === 4) {
      const jitter = calm || stage !== 3 ? 0 : Math.sin(t * 37) * 0.6;
      const tv = `translateX(${jitter.toFixed(2)}px) rotate(${tiltCur.toFixed(2)}deg)`;
      if (tv !== tiltV) { tiltV = tv; el.tilt.style.transform = tv; }
    } else if (tiltV) { tiltV = ''; el.tilt.style.transform = ''; }
    if (stage === 3) drawPlume(calm ? 57 : 57 + Math.sin(t * 13) * 3 + Math.sin(t * 21) * 2 + Math.sin(t * 7.7) * 2, 1 + f * 1.2, 0.95 - f * 0.35);

    // Capsule in space: a slow drift in attitude; once the panels are out, a blinking beacon.
    if (stage >= 4) {
      el.bob4.style.transform = calm ? '' : `rotate(${(Math.sin(t * 0.7) * 3.5).toFixed(2)}deg)`;
      const b = stage >= 5 && !calm && (t % 1.6) < 0.12 ? '0.15' : stage >= 5 ? '1' : '0.45';
      if (b !== blinkV) { blinkV = b; el.tip.setAttribute('opacity', b); }
    }
  }

  /* The envelope's paper gores over its ember ground. Every shape is clipped
     to the visible half and shrinks smoothly to nothing at the limb, so as
     the envelope turns nothing pops in or out. */
  function drawEnvelope(phase) {
    const N = gores.n, step = (Math.PI * 2) / N, H = Math.PI / 2;
    let g = 0, p = 0, th = 0;
    const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
    const r1 = rAt(126), r2 = rAt(138);
    for (let k = 0; k < N; k++) {
      const a0 = wrap(phase + k * step), a1 = a0 + step;
      const lo = Math.max(a0, -H), hi = Math.min(a1, H);
      if (hi <= lo) continue;
      if (k % 3 === 2 && g < el.gorePool.length) el.gorePool[g++].setAttribute('d', gorePath(lo, hi));
      // Seam pinline between the two ember gores of each pair.
      if (k % 3 === 0 && a1 < H && p < el.pinPool.length) el.pinPool[p++].setAttribute('d', meridianPath(a1));
      // Tooth: one navy triangle per gore under the belly, clipped like the gore.
      if (th < el.teethPool.length) {
        const c = clamp(a0 + step / 2, lo, hi);
        el.teethPool[th++].setAttribute('d', `M${(100 + r1 * Math.sin(lo)).toFixed(2)},126 L${(100 + r1 * Math.sin(hi)).toFixed(2)},126 L${(100 + r2 * Math.sin(c)).toFixed(2)},138Z`);
      }
    }
    for (let i = g; i < el.gorePool.length; i++) el.gorePool[i].setAttribute('d', '');
    for (let i = p; i < el.pinPool.length; i++) el.pinPool[i].setAttribute('d', '');
    for (let i = th; i < el.teethPool.length; i++) el.teethPool[i].setAttribute('d', '');
    // Medallion: rides the first ember seam round the envelope.
    const theta = wrap(phase + step);
    const cs = Math.cos(theta);
    if (cs > 0.02) {
      el.medal.style.visibility = 'visible';
      el.medal.setAttribute('transform', `translate(${(100 + 62 * Math.sin(theta)).toFixed(2)} 70) scale(${cs.toFixed(3)} 1)`);
    } else el.medal.style.visibility = 'hidden';
  }

  function drawHelium(f, phase) {
    const w = lerp(26, 56, f);
    const cy = lerp(34, 58, f);
    const top = cy - w * 0.95, tail = 118;
    const ty = (k) => cy + (tail - cy) * k;
    el.bubble.setAttribute('d', `M97,${tail} C97,${ty(0.45).toFixed(1)} ${(100 - w).toFixed(1)},${ty(0.22).toFixed(1)} ${(100 - w).toFixed(1)},${cy.toFixed(1)} `
      + `A${w.toFixed(1)},${(w * 0.95).toFixed(1)} 0 0 1 ${(100 + w).toFixed(1)},${cy.toFixed(1)} `
      + `C${(100 + w).toFixed(1)},${ty(0.22).toFixed(1)} 103,${ty(0.45).toFixed(1)} 103,${tail}Z`);
    el.valve.setAttribute('cy', top.toFixed(1));
    // Load tapes: meridians from the apex to the tail, turning slowly.
    let u = 0;
    for (let k = 0; k < 10; k++) {
      const a = phase + (k * Math.PI * 2) / 10;
      if (Math.cos(a) <= 0) continue;
      const s = Math.sin(a);
      el.tapePool[u++].setAttribute('d', `M100,${top.toFixed(1)} C${(100 + s * w * 1.25).toFixed(1)},${(top + w * 0.2).toFixed(1)} ${(100 + s * w * 1.1).toFixed(1)},${ty(0.25).toFixed(1)} ${(100 + s * 3).toFixed(1)},${tail}`);
    }
    for (let i = u; i < el.tapePool.length; i++) el.tapePool[i].setAttribute('d', '');
    // Pleats in the slack tail (fade as it fills).
    el.pleatPool.forEach((pth, i) => {
      const x = 100 + (i - 1) * 2.2;
      pth.setAttribute('d', `M${x},${ty(0.5).toFixed(1)} L${x},${(tail - 2).toFixed(1)}`);
      pth.setAttribute('opacity', (1 - f).toFixed(2));
    });
  }

  function drawPlume(len, widen, alpha) {
    const y0 = 184;
    const shape = (w, l) => `M${100 - w},${y0} C${100 - w * 1.1},${y0 + l * 0.35} ${100 - w * 0.5},${y0 + l * 0.8} 100,${y0 + l} C${100 + w * 0.5},${y0 + l * 0.8} ${100 + w * 1.1},${y0 + l * 0.35} ${100 + w},${y0}Z`;
    el.po.setAttribute('d', shape(10 * widen, len));
    el.pm.setAttribute('d', shape(7.4 * widen, len * 0.8));
    el.pc.setAttribute('d', shape(3.8 * Math.sqrt(widen), len * 0.42));
    el.plume.style.opacity = el.plume.getAnimations().length ? el.plume.style.opacity : alpha.toFixed(2);
  }

  /* ---------------------------------------------------------- public */
  /** Jump to the right look for an altitude (boot, results, dev). */
  function set(km) {
    busyUntil = 0;
    tiltCur = stageOf(km) === 3 ? clamp((km - 45) / 55, 0, 1) * 6 : 0;
    show(stageOf(km));
  }

  /** Width chips change the gore count: tighter bet, tighter stripes. */
  function setGores(n, twirl) {
    gores.n = n;
    if (twirl) gores.spin = 1.1;
  }
  const spin = (v) => { gores.spin = v; };
  /** A gentle pendulum kick to the basket (take-off). */
  const kick = (amp = 1) => { kickT0 = performance.now() / 1000; kickAmp = 3.2 * amp; };

  /** Points on the craft in viewBox units, for particles. Depends on stage. */
  function anchor(which) {
    const s = stage;
    if (which === 'burner') return s <= 1 ? [100, 166] : s === 2 ? [100, 244] : s === 3 ? [100, 186] : [100, 154];
    if (which === 'basket') return s === 0 ? [100, 222] : s === 1 ? [100, 224] : s === 2 ? [100, 244] : [100, 154];
    return s <= 1 ? [100, 70] : s === 2 ? [100, 50] : s === 3 ? [100, 70] : [100, 120];
  }

  return { build, frame, set, setGores, spin, kick, anchor, stageOf, get stage() { return stage; }, STAGES };
})();
