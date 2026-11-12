/* ==========================================================================
   KÁRMÁN · vehicle.js
   The craft you fly, drawn as one inline SVG (viewBox 0 0 200 250). It is a
   "rockoon", the real technique of lifting a rocket by balloon and firing it
   from the thin upper air, so the vehicle evolves as you climb:

     stage 0   0–15 km    hot-air balloon with a wicker basket
     stage 1   15–21 km   same balloon, basket swapped for a sealed gondola
     stage 2   21–45 km   thin stratospheric helium balloon carrying a rocket
     stage 3   45–100 km  the rocket drops, ignites and climbs
     stage 4   100 km +   the capsule coasts in space with its panels out

   scene.js owns where the craft sits on screen; this file owns what it looks
   like. Each frame scene.js calls frame(), which advances the slow idle
   motion (spinning gores, tapes, plume flicker) and plays a short transition
   whenever the altitude crosses a stage boundary. Results and reloads call
   set(km) to jump straight to the right stage with no transition.

   Every stage change is a short sequence of parts arriving and settling
   (about 1.2 s), not a swap: the gondola's shells slide shut round the crew,
   the rocket latches under the helium balloon, its fins unfold before the
   burn, the panels hinge out in space. Reduced motion gets a crossfade.

   Every colour is a literal hex (no CSS variables), and every texture is a
   pattern inside this SVG, so the live SVG can be serialised into the share
   image as-is.
   ========================================================================== */

K.vehicle = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const STAGES = [15, 21, 45, 100];                 // km where each stage starts
  const stageOf = (km) => STAGES.filter((s) => km >= s).length;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const f2 = (n) => n.toFixed(2);

  const C = {
    ember: '#FF6A3D', paper: '#F3E9D6', amber: '#FFB547', navy: '#1E2A55',
    night: '#0A0D1C', steel: '#3A4566', shade: '#CDBFA6', wicker: '#8A5A34',
    weave: '#6B4227', rim: '#5A3720', cream: '#FFF1C9', ink: '#22305A',
  };

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
  /* The gore seams wander a hair from row to row (seeded, never animated), so
     the stripes read as laid down by a brush rather than ruled. */
  const ENV_JIT = (() => { const r = K.rng.fromLabel('karman-gore-brush'); return ENV_YS.map(() => (r() - 0.5) * 0.7); })();
  const xOn = (phi, i) => 100 + ENV_R[i] * Math.sin(phi) + ENV_JIT[i] * Math.cos(phi);
  /* Gores stop a hair short of the silhouette: the last sliver of a gore
     turning out of view is thinner than a pixel and used to flicker. */
  const EDGE = Math.PI / 2 - 0.07;

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

  /* ---------------------------------------------------------- the pen
     A dip-pen contour: a closed ribbon round a polygon whose width swells
     and thins (w0 … w1), filled in ink. Drawn once; it never animates. */
  function penRing(points, w0, w1, rand) {
    const n = points.length, outer = [], inner = [];
    let k = rand() * 10;
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i], [px, py] = points[(i + n - 1) % n], [nx, ny] = points[(i + 1) % n];
      let tx = nx - px, ty = ny - py;
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      let ox = -ty, oy = tx;                               // a normal
      if ((x - 100) * ox + (y - 80) * oy < 0) { ox = -ox; oy = -oy; }   // pointing out from the envelope's heart
      k += 0.28 + rand() * 0.25;
      const w = w0 + (w1 - w0) * (0.5 + 0.5 * Math.sin(k));
      outer.push(`${f2(x + ox * w / 2)},${f2(y + oy * w / 2)}`);
      inner.push(`${f2(x - ox * w / 2)},${f2(y - oy * w / 2)}`);
    }
    return `M${outer.join(' L')}Z M${inner.join(' L')}Z`;
  }
  const envRing = () => {
    const pts = [];
    ENV_YS.forEach((y, i) => pts.push([100 - ENV_R[i], y]));
    for (let i = ENV_YS.length - 1; i >= 0; i--) pts.push([100 + ENV_R[i], ENV_YS[i]]);
    return penRing(pts, 0.7, 2, K.rng.fromLabel('karman-envelope-pen'));
  };
  /* The paper's tooth: a tile of specks and a few short dry strokes. */
  function paperTile(rand) {
    let dots = '', strokes = '';
    for (let i = 0; i < 26; i++) dots += `M${f2(rand() * 22)},${f2(rand() * 22)} h.5 `;
    for (let i = 0; i < 4; i++) { const x = rand() * 22, y = rand() * 22, l = 3 + rand() * 6; strokes += `M${f2(x)},${f2(y)} q${f2(l / 2)},${f2((rand() - 0.5) * 1.2)} ${f2(l)},${f2((rand() - 0.5) * 0.6)} `; }
    return `<pattern id="v-paper" width="22" height="22" patternUnits="userSpaceOnUse">
        <path d="${dots}" stroke="${C.ink}" stroke-width=".55" stroke-opacity=".16" stroke-linecap="round"/>
        <path d="${strokes}" stroke="#FFFFFF" stroke-width=".7" stroke-opacity=".3" stroke-linecap="round" fill="none"/></pattern>`;
  }
  const HATCH = `<pattern id="v-hatch" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(36)">
        <path d="M.7,0 V3.2" stroke="${C.ink}" stroke-width=".6" stroke-opacity=".5"/></pattern>`;
  const hatch = (d, op = 0.4) => `<path d="${d}" fill="url(#v-hatch)" opacity="${op}"/>`;
  const inked = (d, op = 0.55, w = 1.1) => `<path d="${d}" fill="none" stroke="${C.ink}" stroke-opacity="${op}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;

  /** A truncated-cone gondola: top width tw at y, base width bw at y + h. */
  const capsule = (cx, y, tw, bw, h) => `M${cx - tw / 2},${y} L${cx + tw / 2},${y} L${cx + bw / 2},${y + h} L${cx - bw / 2},${y + h}Z`;

  /* ---------------------------------------------------------- the capsule
     Shared by the rocket's nose section and the orbiter: a blunt dome, a
     straight body with the crew porthole in it, a separation band below.
     Drawn in rocket coordinates (y 38 … 92, body x 86 … 114). */
  const DOME = 'M86,58 C86,45 92,38 100,38 C108,38 114,45 114,58Z';
  const CBODY = 'M86,58 L114,58 L114,90 L86,90Z';
  const CAP_OUTLINE = 'M86,90 L86,58 C86,45 92,38 100,38 C108,38 114,45 114,58 L114,90Z';
  function capsuleArt() {
    return `
      <path d="${CBODY}" fill="${C.paper}"/><path d="${CBODY}" fill="url(#v-body)"/>
      <path class="v-acc-n" d="${DOME}" fill="${C.ember}"/>
      <path d="M100,38 C108,38 114,45 114,58 L106,58 C106,47 103.5,41 100,38Z" fill="${C.night}" opacity=".22"/>
      <path d="M90.5,53 C91,46 94.5,41.5 98.5,40" fill="none" stroke="${C.cream}" stroke-opacity=".85" stroke-width="1.1" stroke-linecap="round"/>
      ${hatch('M107,58 L114,58 L114,90 L107,90Z', 0.4)}
      <rect x="86" y="86.5" width="28" height="4" fill="${C.navy}"/>
      <path d="M86,58.5 H114" stroke="${C.navy}" stroke-opacity=".55" stroke-width=".9"/>
      <circle cx="100" cy="72" r="7.6" fill="${C.amber}" opacity=".28"/>
      <circle cx="100" cy="72" r="6.4" fill="${C.night}" stroke="${C.amber}" stroke-width="1.5"/>
      <path d="M95.6,70.2 A5,5 0 0 1 99.4,66.8" fill="none" stroke="${C.cream}" stroke-opacity=".7" stroke-width=".9" stroke-linecap="round"/>
      <circle cx="89" cy="62" r=".7" fill="${C.navy}" opacity=".6"/><circle cx="111" cy="62" r=".7" fill="${C.navy}" opacity=".6"/>
      <circle cx="89" cy="83" r=".7" fill="${C.navy}" opacity=".6"/><circle cx="111" cy="83" r=".7" fill="${C.navy}" opacity=".6"/>
      ${inked(CAP_OUTLINE, 0.6, 1.2)}`;
  }

  /* ---------------------------------------------------------- the paint
     The envelope's sheet. Shown from its path at once; then fetched and
     inlined as a data URL, so the share image (which serialises this SVG
     into an <img>, where external files never load) carries the paint. */
  const ENV_SRC = 'img/env.webp';
  const HELIUM_SRC = 'img/helium.webp';
  /* The gores are drawn in multiply over the cream paint: this red lands on
     the poster's vermilion (#D9452B) once the sheet shows through it. */
  const GORE_RED = '#F0563A';
  /* First-class liveries (Account → Livery). gores: the fills of gore k%3 = 0
     and 1 (k%3 = 2 is the bare painted sheet); pin: the seam pinline; nose and
     fins: the rocket's painted nose cone and its fins + band (amber where ember
     would sink into the night sky). Everyone else flies Vermilion. */
  const LIVERIES = {
    vermilion: { gores: [GORE_RED, GORE_RED], pin: C.amber, nose: C.ember, fins: C.ember },
    midnight: { gores: [C.navy, C.navy], pin: C.amber, nose: C.amber, fins: C.amber },
    airmail: { gores: [C.navy, GORE_RED], pin: C.cream, nose: C.ember, fins: C.navy, trim: '#C4402A' },   // trim: a red stripe on the fins' trailing edges
    gold: { gores: [C.amber, C.amber], pin: C.navy, nose: C.navy, fins: C.amber },
  };
  let livId = 'vermilion';
  const liv = () => LIVERIES[livId];
  function inlinePaint() {
    if (!window.fetch || !window.FileReader) return;
    svg.querySelectorAll('.v-paint').forEach((im) => {
      const src = im.getAttribute('href');
      fetch(src).then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(b);
      })).then((url) => im.setAttribute('href', url)).catch(() => {});
    });
  }

  /* ---------------------------------------------------------- state */
  let svg = null;
  let el = {};
  let stage = 0;                 // the stage currently shown (or animating to)
  let busyUntil = 0;             // transitions play one at a time
  const queue = [];
  const gores = { n: 12, phase: 0.35, spin: 0.26 };
  let tapePhase = 0;
  let lastBubble = '';
  let lastKm = 0;
  let kickT0 = 0, kickAmp = 0;   // take-off: the basket trails the envelope, then settles

  /* ---------------------------------------------------------- build */
  function build(svgEl) {
    svg = svgEl;
    const env = envelopePath();
    const gon = capsule(100, 190, 22, 36, 30);
    const shell = (side) => `
        <path d="${gon}" fill="${C.paper}"/>
        <path d="${gon}" fill="url(#v-body)"/>
        <path d="M82,220 Q100,228 118,220 L118,221.5 Q100,229.5 82,221.5Z" fill="${C.navy}"/>
        <path d="M89,190 H111" stroke="${C.navy}" stroke-opacity=".5" stroke-width=".8"/>
        ${side === 'r' ? hatch('M107,190 L111,190 L118,220 L110,220Z', 0.42) : ''}
        ${inked(gon, 0.55, 1.1)}`;
    svg.setAttribute('viewBox', '0 0 200 250');
    svg.setAttribute('xmlns', NS);
    svg.innerHTML = `
      <defs>
        <clipPath id="v-env"><path d="${env}"/></clipPath>
        <clipPath id="v-cl"><rect x="0" y="0" width="100" height="250"/></clipPath>
        <clipPath id="v-cr"><rect x="100" y="0" width="100" height="250"/></clipPath>
        ${HATCH}
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
        <linearGradient id="v-plume" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${C.cream}"/>
          <stop offset=".25" stop-color="${C.amber}"/>
          <stop offset=".7" stop-color="${C.ember}" stop-opacity=".6"/>
          <stop offset="1" stop-color="${C.ember}" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- STAGES 0–1: the hot-air balloon -->
      <g class="v-hot" style="transform-origin:100px 8px">
        <g class="v-glowwrap"><circle class="v-burnglow" cx="100" cy="162" r="30" fill="url(#v-glow)"/></g>
        <g clip-path="url(#v-env)">
          <path d="${env}" fill="${C.paper}"/>
          <!-- the painted envelope: a gouache sheet (img/env.webp) warped onto this
               silhouette; it carries the light, the shade, the hatching and the
               paper's tooth. The gores spin over it in multiply, so the paint
               shows through the vermilion and the width chips still turn the stripes. -->
          <image class="v-paint" href="${ENV_SRC}" x="0" y="0" width="200" height="160" preserveAspectRatio="none"/>
          <g class="v-gores" style="mix-blend-mode:multiply"></g>
          <g class="v-pins" fill="none" stroke="${C.amber}" stroke-width=".8" opacity=".85"></g>
          <g class="v-teeth" fill="${C.navy}" style="mix-blend-mode:multiply"></g>
        </g>
        <!-- the same hand-inked contour as the sights in the sky, in a dip pen -->
        <path d="${envRing()}" fill="${C.ink}" fill-opacity=".5" fill-rule="evenodd"/>
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
            <path d="M83,196 L117,196 L115,219 Q115,222 112,222 L88,222 Q85,222 85,219Z" fill="${C.wicker}"/>
            <g stroke="${C.weave}" stroke-width="1">
              <line x1="84" y1="204" x2="116" y2="204"/><line x1="84.5" y1="208" x2="115.5" y2="208"/>
              <line x1="85" y1="212" x2="115" y2="212"/><line x1="85" y1="216" x2="115" y2="216"/>
              <line x1="92" y1="200" x2="92" y2="221"/><line x1="100" y1="200" x2="100" y2="222"/><line x1="108" y1="200" x2="108" y2="221"/>
            </g>
            ${hatch('M106,196 L117,196 L115,219 Q115,222 112,222 L106,222Z', 0.5)}
            ${inked('M83,196 L117,196 L115,219 Q115,222 112,222 L88,222 Q85,222 85,219Z', 0.5, 1)}
            <rect x="82" y="196" width="36" height="4.5" rx="2" fill="${C.rim}"/>
          </g>
        </g>

        <!-- stage 1: ropes to a ring + sealed gondola (two shells that slide shut) -->
        <g class="v-gondola" style="transform-origin:100px 182px;opacity:0">
          <g class="v-swing2" style="transform-origin:100px 164px">
            <g class="v-grig">
              <g stroke="#2A2730" stroke-width="1" opacity=".9">
                <line x1="86" y1="162" x2="100" y2="182"/><line x1="94" y1="162" x2="100" y2="182"/>
                <line x1="106" y1="162" x2="100" y2="182"/><line x1="114" y1="162" x2="100" y2="182"/>
              </g>
              <rect x="92" y="168" width="16" height="8" rx="1.5" fill="${C.steel}"/>
              <circle cx="100" cy="182" r="2.2" fill="none" stroke="${C.steel}" stroke-width="1.4"/>
              <rect x="94" y="186" width="12" height="4.5" rx="1" fill="${C.steel}"/>
            </g>
            <g class="v-gshl" clip-path="url(#v-cl)">${shell('l')}</g>
            <g class="v-gshr" clip-path="url(#v-cr)">${shell('r')}</g>
            <line class="v-gseam" x1="100" y1="190" x2="100" y2="221" stroke="${C.cream}" stroke-width="1.4" opacity="0"/>
            <g class="v-gwin" style="transform-origin:100px 204px">
              <circle cx="100" cy="204" r="9" fill="${C.amber}" opacity=".35"/>
              <circle cx="100" cy="204" r="5.5" fill="${C.night}" stroke="${C.amber}" stroke-width="1.5"/>
              <path d="M96.4,202.6 A4,4 0 0 1 99.4,199.8" fill="none" stroke="${C.cream}" stroke-opacity=".7" stroke-width=".8" stroke-linecap="round"/>
            </g>
            <path class="v-gfrost" d="${gon}" fill="none" stroke="#fff" stroke-width="1.2" opacity="0"/>
          </g>
        </g>
      </g>

      <!-- STAGE 2: stratospheric helium balloon on a long flight line -->
      <g class="v-helium" style="transform-origin:100px 9px;opacity:0">
        <!-- the painted film (img/helium.webp), stretched to the bubble as it fills and clipped to it -->
        <clipPath id="v-hel"><path class="v-bubble-clip"/></clipPath>
        <image class="v-paint v-hpaint" href="${HELIUM_SRC}" clip-path="url(#v-hel)" preserveAspectRatio="none" opacity=".9"/>
        <path class="v-bubble" fill="#DCE6F5" fill-opacity=".08" stroke="${C.paper}" stroke-opacity=".6" stroke-width="1"/>
        <g class="v-tapes" fill="none" stroke="${C.paper}" stroke-opacity=".4" stroke-width=".8"></g>
        <g class="v-pleats" fill="none" stroke="${C.paper}" stroke-opacity=".5" stroke-width=".7"></g>
        <ellipse class="v-valve" cx="100" cy="10" rx="6" ry="2" fill="${C.amber}"/>
        <line x1="100" y1="118" x2="100" y2="150" stroke="${C.paper}" stroke-opacity=".7" stroke-width=".9"/>
        <path class="v-acc-n" d="M95,126 L105,126 L101.5,134 L98.5,134Z" fill="${C.ember}"/>
      </g>

      <!-- STAGES 2–3: the rocket (hangs small under the balloon, then flies) -->
      <g class="v-payload" style="transform-origin:100px 40px;opacity:0">
        <g class="v-tilt" style="transform-origin:100px 110px">
          <g class="v-plumewrap" style="transform-origin:100px 182px">
            <circle cx="100" cy="186" r="30" fill="url(#v-glow)" opacity=".5"/>
            <path class="v-plume-o" fill="${C.ember}" opacity=".55"/>
            <path class="v-plume-m" fill="url(#v-plume)"/>
            <path class="v-plume-c" fill="${C.cream}" opacity=".9"/>
          </g>
          <g class="v-booster" style="transform-origin:100px 130px">
            <g class="v-finl" style="transform-origin:86px 174px">
              <path class="v-acc-f" d="M86,138 L68,178 L68,186 L86,175Z" fill="${C.ember}"/>
              <path d="M86,138 L68,178 L68,186 L86,175Z" fill="${C.night}" opacity=".18"/>
              ${inked('M86,138 L68,178 L68,186 L86,175', 0.6, 1)}
              <path class="v-trim" d="M68.6,184.6 L85.6,174.2" fill="none" stroke-width="2.2" stroke-linecap="round" stroke="none"/>
            </g>
            <g class="v-finr" style="transform-origin:114px 174px">
              <path class="v-acc-f" d="M114,138 L132,178 L132,186 L114,175Z" fill="${C.ember}"/>
              ${hatch('M114,138 L132,178 L132,186 L114,175Z', 0.45)}
              ${inked('M114,138 L132,178 L132,186 L114,175', 0.6, 1)}
              <path class="v-trim" d="M131.4,184.6 L114.4,174.2" fill="none" stroke-width="2.2" stroke-linecap="round" stroke="none"/>
            </g>
            <path d="M86,92 L114,92 L114,168 L86,168Z" fill="${C.paper}"/>
            <path d="M86,92 L114,92 L114,168 L86,168Z" fill="url(#v-body)"/>
            ${hatch('M107,92 L114,92 L114,168 L107,168Z', 0.4)}
            <rect class="v-acc-f" x="86" y="150" width="28" height="8" fill="${C.ember}"/>
            <path d="M86,150 L93,158 M93,150 L100,158 M100,150 L107,158 M107,150 L114,158" stroke="${C.paper}" stroke-opacity=".55" stroke-width="1.2"/>
            <rect x="86" y="92" width="28" height="3" fill="${C.navy}"/>
            <path d="M97,144 L103,144 L103,182 L97,182Z" fill="${C.navy}"/>
            <path d="M91,168 L109,168 L113,182 L87,182Z" fill="${C.steel}"/>
            <path d="M93,172 L107,172" stroke="${C.night}" stroke-opacity=".5" stroke-width="1"/>
            ${inked('M86,168 L86,92 M114,92 L114,168 M91,168 L109,168 L113,182 L87,182Z', 0.6, 1.2)}
          </g>
          <g class="v-rcap">${capsuleArt()}</g>
          <circle class="v-flash" cx="100" cy="182" r="40" fill="#FFF6DF" opacity="0" style="transform-origin:100px 182px"/>
        </g>
      </g>

      <!-- STAGE 4: the capsule in space, panels hinged out -->
      <g class="v-orbiter" style="transform-origin:100px 120px;opacity:0">
        <g class="v-bob4" style="transform-origin:100px 126px"><g transform="translate(100 126) scale(1.3) translate(-100 -65)">
          <g class="v-wing v-wingl" style="transform-origin:86px 71px">
            <line x1="86" y1="71" x2="78" y2="71" stroke="${C.steel}" stroke-width="1.8"/>
            <rect x="36" y="65" width="42" height="12" fill="${C.navy}" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M46.5,65V77M57,65V77M67.5,65V77M36,71H78" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M36,65 H78" stroke="#FFFFFF" stroke-opacity=".35" stroke-width=".7"/>
          </g>
          <g class="v-wing v-wingr" style="transform-origin:114px 71px">
            <line x1="114" y1="71" x2="122" y2="71" stroke="${C.steel}" stroke-width="1.8"/>
            <rect x="122" y="65" width="42" height="12" fill="${C.navy}" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M132.5,65V77M143,65V77M153.5,65V77M122,71H164" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M122,65 H164" stroke="#FFFFFF" stroke-opacity=".35" stroke-width=".7"/>
          </g>
          <g class="v-antenna" style="transform-origin:100px 38px">
            <line x1="100" y1="38" x2="100" y2="24" stroke="${C.steel}" stroke-width="1.2"/>
            <circle class="v-tip" cx="100" cy="23.5" r="1.6" fill="${C.amber}"/>
          </g>
          ${capsuleArt()}
          <path d="M85,90.5 Q100,96.5 115,90.5" fill="none" stroke="${C.navy}" stroke-width="2.4" stroke-linecap="round"/>
        </g></g>
      </g>`;

    const q = (s) => svg.querySelector(s);
    el = {
      hot: q('.v-hot'), gores: q('.v-gores'), pins: q('.v-pins'), teeth: q('.v-teeth'), medal: q('.v-medal'),
      frost: q('.v-frost'), flame: q('.v-flame'), glow: q('.v-glowwrap'),
      basket: q('.v-basket'), swing: q('.v-swing'), gondola: q('.v-gondola'), swing2: q('.v-swing2'), gfrost: q('.v-gfrost'),
      grig: q('.v-grig'), gshl: q('.v-gshl'), gshr: q('.v-gshr'), gseam: q('.v-gseam'), gwin: q('.v-gwin'),
      helium: q('.v-helium'), bubble: q('.v-bubble'), bubbleClip: q('.v-bubble-clip'), hpaint: q('.v-hpaint'), tapes: q('.v-tapes'), pleats: q('.v-pleats'), valve: q('.v-valve'),
      payload: q('.v-payload'), tilt: q('.v-tilt'), plume: q('.v-plumewrap'), booster: q('.v-booster'), rcap: q('.v-rcap'),
      finl: q('.v-finl'), finr: q('.v-finr'),
      po: q('.v-plume-o'), pm: q('.v-plume-m'), pc: q('.v-plume-c'), flash: q('.v-flash'),
      orbiter: q('.v-orbiter'), bob4: q('.v-bob4'), wings: svg.querySelectorAll('.v-wing'), tip: q('.v-tip'), antenna: q('.v-antenna'),
    };
    // Pools of paths reused every frame (no DOM churn while spinning).
    el.gorePool = pool(el.gores, 30);
    el.pinPool = pool(el.pins, 10);
    el.teethPool = pool(el.teeth, 30);
    el.tapePool = pool(el.tapes, 10);
    el.pleatPool = pool(el.pleats, 3);
    inlinePaint();
    setLivery(livId);
  }

  /** Paint the craft in a livery (unknown ids fly Vermilion). */
  function setLivery(id) {
    livId = LIVERIES[id] ? id : 'vermilion';
    if (!svg) return;
    el.pins.setAttribute('stroke', liv().pin);
    // Navy paint would vanish into the night sky: it gets a cream pinline.
    const paint = (sel, c) => svg.querySelectorAll(sel).forEach((n) => {
      n.setAttribute('fill', c);
      if (c === C.navy) { n.setAttribute('stroke', '#F3E7D3'); n.setAttribute('stroke-width', '1.5'); n.setAttribute('stroke-opacity', '.6'); n.setAttribute('stroke-linejoin', 'round'); }
      else n.removeAttribute('stroke');
    });
    paint('.v-acc-n', liv().nose);
    paint('.v-acc-f', liv().fins);
    svg.querySelectorAll('.v-trim').forEach((n) => n.setAttribute('stroke', liv().trim || 'none'));
    drawEnvelope(gores.phase);
  }

  /** A still balloon on its basket in a livery, as SVG markup (the Account
      swatches): the live craft, cloned, with its own ids, gores drawn at rest. */
  let swN = 0;
  function swatch(id, viewBox = '36 -2 128 170') {
    if (!svg) return '';
    const L = LIVERIES[id] || LIVERIES.vermilion;
    const c = svg.cloneNode(true);
    c.querySelectorAll('.v-helium, .v-payload, .v-orbiter, .v-gondola, .v-glowwrap, .v-frost').forEach((n) => n.remove());
    ['.v-hot', '.v-basket', '.v-swing', '.v-flame'].forEach((s) => { const n = c.querySelector(s); if (n) n.removeAttribute('style'); });
    c.querySelectorAll('.v-paint').forEach((n) => n.setAttribute('href', ENV_SRC));
    c.querySelector('.v-pins').setAttribute('stroke', L.pin);
    const q = (s) => [...c.querySelectorAll(`${s} path`)];
    drawEnvelope(0.35, { gorePool: q('.v-gores'), pinPool: q('.v-pins'), teethPool: q('.v-teeth'), medal: c.querySelector('.v-medal') }, L, 12);
    ['id', 'class', 'style', 'width', 'height'].forEach((a) => c.removeAttribute(a));
    c.setAttribute('viewBox', viewBox);
    c.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('focusable', 'false');
    let xml = c.outerHTML;
    const k = ++swN;
    const ids = [...c.querySelectorAll('[id]')].map((n) => n.id);
    ids.forEach((i) => { xml = xml.split(`id="${i}"`).join(`id="${i}-s${k}"`).split(`#${i})`).join(`#${i}-s${k})`).split(`href="#${i}"`).join(`href="#${i}-s${k}"`); });
    return xml;
  }

  function pool(parent, n) {
    return Array.from({ length: n }, () => parent.appendChild(document.createElementNS(NS, 'path')));
  }

  /* ---------------------------------------------------------- per-stage looks */
  const PAYLOAD_HANG = 'translate(0px, 110px) scale(0.6)';      // under the helium balloon
  const PAYLOAD_FLY = 'translate(0px, 0px) scale(1)';
  const FIN_FOLDED = 'scaleX(0.08)';                              // fins lie flat until the burn
  const WING_FOLDED = ['rotate(-90deg)', 'rotate(90deg)'];        // panels lie along the capsule until space

  /** Every part that a transition may move, so show() can reset them all. */
  const MOVERS = () => [el.hot, el.basket, el.gondola, el.grig, el.gshl, el.gshr, el.gseam, el.gwin, el.helium, el.payload, el.booster, el.rcap, el.plume, el.finl, el.finr, el.orbiter, el.antenna, ...el.wings];

  /** Jump straight to the look of a stage (no animation). */
  function show(s) {
    stage = s;
    const vis = (node, on) => { node.style.opacity = on ? '1' : '0'; node.style.visibility = on ? 'visible' : 'hidden'; };
    for (const n of MOVERS()) {
      n.getAnimations().forEach((a) => a.cancel());
      n.style.transform = '';
      n.style.opacity = '';
    }
    vis(el.hot, s <= 1);
    vis(el.basket, s === 0);
    vis(el.gondola, s === 1);
    vis(el.helium, s === 2);
    vis(el.payload, s === 2 || s === 3);
    vis(el.booster, true);
    vis(el.rcap, true);
    vis(el.plume, s === 3);
    el.payload.style.transform = s === 2 ? PAYLOAD_HANG : PAYLOAD_FLY;
    el.finl.style.transform = el.finr.style.transform = s === 2 ? FIN_FOLDED : '';
    vis(el.orbiter, s === 4);
    el.gseam.setAttribute('opacity', '0');
    el.flash.setAttribute('opacity', '0');
  }

  /* ---------------------------------------------------------- transitions
     Each is a timeline of WAAPI animations with delays, about 1.2 s long:
     parts arrive, adjust and settle, in order, like a suit being put on. */
  const SETTLE = 'cubic-bezier(.16,1,.3,1)';
  const DROP = 'cubic-bezier(.55,0,1,.45)';
  /* A timeline with more than two keyframes runs on a linear clock, and
     each segment eases on its own (SETTLE unless the keyframe says otherwise),
     so the middle keyframes are honoured instead of being blown through. */
  function anim(node, frames, ms, delay = 0, easing) {
    if (frames.length > 2 && !easing) {
      easing = 'linear';
      frames = frames.map((f) => (f.easing ? f : { ...f, easing: SETTLE }));
    }
    return node.animate(frames, { duration: ms, delay, easing: easing || SETTLE, fill: 'both' });
  }
  const appear = (node) => { node.style.visibility = 'visible'; };

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
    const later = (fn, ms) => setTimeout(() => { if (stage === to) fn(); }, ms * k);

    if (from === 0 && to === 1) {                 // 15 km: the basket is sealed into a gondola
      K.audio.stage('seal');
      K.scene.flare(1.2);
      appear(el.gondola);
      el.gondola.style.opacity = '1';
      // 1. the wicker lets go and drops away
      anim(el.basket, [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(.7) translateY(14px)', opacity: 0 }], 380 * k, 0, DROP);
      // 2. the ropes gather to a ring
      anim(el.grig, [{ opacity: 0 }, { opacity: 1 }], 320 * k, 160 * k, 'ease-out');
      // 3. the two shells slide in from either side and meet
      anim(el.gshl, [{ transform: 'translate(-36px, 10px)', opacity: 0 }, { transform: 'translate(-36px, 10px)', opacity: 1, offset: 0.2 }, { transform: 'translate(0, 0)', opacity: 1 }], 560 * k, 260 * k);
      anim(el.gshr, [{ transform: 'translate(36px, 10px)', opacity: 0 }, { transform: 'translate(36px, 10px)', opacity: 1, offset: 0.2 }, { transform: 'translate(0, 0)', opacity: 1 }], 560 * k, 300 * k);
      // 4. the seam seals with a glint
      anim(el.gseam, [{ opacity: 0 }, { opacity: 0.95, offset: 0.35 }, { opacity: 0 }], 300 * k, 800 * k, 'ease-in-out');
      later(() => { const p = pt(100, 205); K.fx.embers(p.x, p.y, { count: 10, speed: 80, life: 0.6, color: C.paper }); }, 820);
      // 5. the porthole lights
      anim(el.gwin, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], 340 * k, 900 * k);
      return 1240 * k;
    }
    if (from === 1 && to === 2) {                 // 21 km: helium balloon takes over, rocket latches under it
      K.audio.stage('swap');
      appear(el.helium); appear(el.payload);
      el.helium.style.opacity = '1'; el.payload.style.opacity = '1';
      el.payload.style.transform = PAYLOAD_HANG;
      el.finl.style.transform = el.finr.style.transform = FIN_FOLDED;
      el.plume.style.visibility = 'hidden'; el.plume.style.opacity = '0';
      // 1. the hot-air envelope goes limp and folds away upward
      anim(el.hot, [
        { transform: 'scale(1, 1) translateY(0)', opacity: 1, easing: 'ease-in-out' },
        { transform: 'scale(.9, 1.05) translateY(-6px)', opacity: 1, offset: 0.4, easing: DROP },
        { transform: 'scale(.16, 1.2) translateY(-54px)', opacity: 0 },
      ], 640 * k, 0);
      // 2. the helium bubble inflates from its valve
      anim(el.helium, [{ transform: 'scale(.04)', opacity: 0, easing: 'ease-in' }, { transform: 'scale(.3)', opacity: 1, offset: 0.25, easing: 'ease-in-out' }, { transform: 'scale(1.05)', offset: 0.82 }, { transform: 'scale(1)' }], 700 * k, 320 * k);
      // 3. the rocket rises on its line and latches, with a small overshoot
      anim(el.payload, [
        { transform: 'translate(0px, 206px) scale(0.6)', opacity: 0, easing: 'linear' },
        { transform: 'translate(0px, 180px) scale(0.6)', opacity: 1, offset: 0.25, easing: 'cubic-bezier(.3,.6,.3,1)' },
        { transform: 'translate(0px, 104px) scale(0.6)', offset: 0.72, easing: 'ease-in-out' },
        { transform: 'translate(0px, 113px) scale(0.6)', offset: 0.86, easing: 'ease-in-out' },
        { transform: PAYLOAD_HANG },
      ], 600 * k, 640 * k);
      later(() => { const p = pt(100, 150); K.fx.sparks(p.x, p.y, { count: 5, speed: 70, color: C.paper }); }, 1080);
      return 1280 * k;
    }
    if (from === 2 && to === 3) {                 // 45 km: release, drop, fins out, ignition
      K.audio.stage('ignite');
      const cut = pt(100, 150);
      K.fx.sparks(cut.x, cut.y, { count: 12, speed: 150, color: C.amber });
      // 1. the line is cut: the balloon floats away, the rocket falls
      anim(el.helium, [{ transform: 'translateY(0)', opacity: 1, easing: 'ease-in' }, { transform: 'translateY(-36px)', opacity: 1, offset: 0.3, easing: DROP }, { transform: 'translateY(-300px)', opacity: 0 }], 1000 * k, 60 * k);
      anim(el.payload, [
        { transform: PAYLOAD_HANG, easing: DROP },
        { transform: 'translate(0px, 140px) scale(0.6)', offset: 0.34, easing: 'linear' },
        { transform: 'translate(0px, 146px) scale(0.62)', offset: 0.52, easing: 'cubic-bezier(.2,.7,.2,1)' },
        { transform: PAYLOAD_FLY },
      ], 1260 * k, 0);
      // 2. the fins unfold while it falls
      const fin = [{ transform: FIN_FOLDED }, { transform: 'scaleX(1.18)', offset: 0.75 }, { transform: 'scaleX(1)' }];
      anim(el.finl, fin, 340 * k, 380 * k);
      anim(el.finr, fin, 340 * k, 430 * k);
      // 3. ignition: a flash, then the plume grows and the rocket climbs to its flying position
      appear(el.plume);
      anim(el.plume, [{ transform: 'scaleY(0)', opacity: 0, easing: 'ease-out' }, { transform: 'scaleY(.5)', opacity: 1, offset: 0.3 }, { transform: 'scaleY(1)', opacity: 1 }], 420 * k, 650 * k);
      later(() => {
        const n = pt(100, 182);
        K.fx.ringBurst(n.x, n.y, '#FFD9A0');
        K.fx.embers(n.x, n.y, { count: 28, speed: 250, color: C.amber });
        K.fx.nudge();
        el.flash.animate([{ transform: 'scale(0)', opacity: 0.9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 280, easing: 'ease-out' });
      }, 650);
      return 1300 * k;
    }
    if (from === 3 && to === 4) {                 // 100 km: cut-off, separation, panels hinge out, antenna up
      K.audio.stage('separate');
      // 1. the burn ends
      anim(el.plume, [{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(.2)' }], 160 * k, 0);
      later(() => { const s = pt(100, 90); K.fx.sparks(s.x, s.y, { count: 10, speed: 130, color: C.paper }); }, 200);
      // 2. the booster falls away, tumbling
      anim(el.booster, [{ transform: 'translateY(0) rotate(0deg)', opacity: 1, easing: 'ease-in' }, { transform: 'translateY(16px) rotate(2deg)', opacity: 1, offset: 0.25, easing: DROP }, { transform: 'translateY(120px) rotate(24deg)', opacity: 0 }], 820 * k, 200 * k);
      // 3. the capsule drifts up to the centre of the frame, growing as the camera closes in
      appear(el.orbiter);
      el.orbiter.style.opacity = '1';
      el.wings[0].style.transform = WING_FOLDED[0];
      el.wings[1].style.transform = WING_FOLDED[1];
      el.antenna.style.transform = 'scaleY(0)';
      anim(el.rcap, [{ opacity: 1, easing: 'linear' }, { opacity: 1, offset: 0.4, easing: 'ease-in' }, { opacity: 0 }], 360 * k, 200 * k);
      anim(el.orbiter, [{ transform: 'translateY(-61px) scale(.77)', opacity: 0 }, { transform: 'translateY(-61px) scale(.77)', opacity: 1, offset: 0.3 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], 820 * k, 240 * k);
      // 4. the panels hinge out, one then the other, and the antenna extends
      anim(el.wings[0], [{ transform: WING_FOLDED[0] }, { transform: 'rotate(7deg)', offset: 0.78 }, { transform: 'rotate(0deg)' }], 420 * k, 860 * k);
      anim(el.wings[1], [{ transform: WING_FOLDED[1] }, { transform: 'rotate(-7deg)', offset: 0.78 }, { transform: 'rotate(0deg)' }], 420 * k, 940 * k);
      anim(el.antenna, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.15)', offset: 0.7 }, { transform: 'scaleY(1)' }], 300 * k, 1120 * k);
      return 1440 * k;
    }
    show(to);                                    // any other jump (e.g. a big climb): no ceremony
    return 0;
  }

  /** Move toward the stage for this altitude, one transition at a time. */
  function advance(km, now) {
    const want = stageOf(km);
    if (want === stage && !queue.length) return;
    if (want < stage) { queue.length = 0; show(want); return; }   // descending (dev only)
    if (now < busyUntil) return;
    const next = stage + 1 <= want ? stage + 1 : want;
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

    // Hot-air envelope: spinning gores, seam pinlines, tooth band, medallion.
    if (stage <= 1 || el.hot.style.visibility !== 'hidden') {
      if (!calm) gores.phase += dt * gores.spin;
      gores.spin += (0.26 - gores.spin) * Math.min(1, dt * 1.5);
      drawEnvelope(calm ? 0.35 : gores.phase);
      el.frost.setAttribute('opacity', clamp((km - 10) / 5, 0, 1) * 0.3);
      el.gfrost.setAttribute('opacity', clamp((km - 15) / 6, 0, 1) * 0.35);
      el.flame.style.transform = `scale(${(0.8 + flame * 0.3).toFixed(3)}, ${flame.toFixed(3)})`;
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
      if (!calm && stage === 2 && !el.payload.getAnimations().length) el.payload.style.transform = `translate(0px, 110px) scale(0.6) rotate(${(Math.sin(t * 1.05) * 1.5).toFixed(2)}deg)`;
    }

    // Rocket: flickering plume that spreads out as the air thins, slight tilt.
    if (stage === 3) {
      const f = clamp((km - 45) / 55, 0, 1);
      const jitter = calm ? 0 : Math.sin(t * 37) * 0.5;
      el.tilt.style.transform = `translateX(${jitter.toFixed(2)}px) rotate(${(f * 6).toFixed(2)}deg)`;
      drawPlume(calm ? 57 : 57 + Math.sin(t * 13) * 3 + Math.sin(t * 21) * 2 + Math.sin(t * 7.7) * 2, 1 + f * 1.2, 0.95 - f * 0.35);
    } else if (el.tilt.style.transform) {
      el.tilt.style.transform = '';
    }

    // Capsule in space: slow tilt, blinking antenna tip.
    if (stage === 4) {
      el.bob4.style.transform = calm ? '' : `rotate(${(Math.sin(t * 0.7) * 4).toFixed(2)}deg)`;
      el.tip.setAttribute('opacity', calm || (t % 1.6) > 0.12 ? '1' : '0.15');
    }
    lastKm = km;
  }

  function drawEnvelope(phase, t = el, L = liv(), N = gores.n) {
    if (!t.gorePool) return;
    const step = (Math.PI * 2) / N;
    let g = 0, p = 0, th = 0;
    const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
    const r1 = rAt(126), r2 = rAt(138);
    for (let k = 0; k < N; k++) {
      const a0 = wrap(phase + k * step);
      const b = a0 + step;
      // Clip to the visible half, a hair inside the silhouette.
      const lo = Math.max(a0, -EDGE), hi = Math.min(b, EDGE);
      const isEmber = k % 3 !== 2;
      // The cream gores are the painted sheet itself; only the ember ones are drawn.
      if (hi > lo && isEmber && g < t.gorePool.length) {
        const path = t.gorePool[g++];
        path.setAttribute('d', gorePath(lo, hi));
        path.setAttribute('fill', L.gores[k % 3]);
      }
      // Seam pinline between the two ember gores of each pair.
      if (k % 3 === 0) {
        const seam = wrap(b);
        if (Math.abs(seam) < EDGE && p < t.pinPool.length) t.pinPool[p++].setAttribute('d', meridianPath(seam));
      }
      // Tooth: one navy triangle per gore under the belly. Clipped like the
      // gores, so a tooth turns into view gradually instead of popping.
      if (hi > lo && hi - lo > 0.02 && th < t.teethPool.length) {
        const c = (lo + hi) / 2;
        t.teethPool[th++].setAttribute('d', `M${(100 + r1 * Math.sin(lo)).toFixed(2)},126 L${(100 + r1 * Math.sin(hi)).toFixed(2)},126 L${(100 + r2 * Math.sin(c)).toFixed(2)},138Z`);
      }
    }
    for (let i = g; i < t.gorePool.length; i++) t.gorePool[i].setAttribute('d', '');
    for (let i = p; i < t.pinPool.length; i++) t.pinPool[i].setAttribute('d', '');
    for (let i = th; i < t.teethPool.length; i++) t.teethPool[i].setAttribute('d', '');
    // Medallion: rides the first ember seam round the envelope.
    const theta = wrap(phase + step);
    const cs = Math.cos(theta);
    if (cs > 0.05) {
      t.medal.style.visibility = 'visible';
      t.medal.setAttribute('transform', `translate(${(100 + 62 * Math.sin(theta)).toFixed(2)} 70) scale(${cs.toFixed(3)} 1)`);
    } else t.medal.style.visibility = 'hidden';
  }

  function drawHelium(f, phase) {
    const w = lerp(26, 56, f);
    const cy = lerp(34, 58, f);
    const top = cy - w * 0.95, tail = 118;
    const ty = (k) => cy + (tail - cy) * k;
    const d = `M97,${tail} C97,${ty(0.45).toFixed(1)} ${(100 - w).toFixed(1)},${ty(0.22).toFixed(1)} ${(100 - w).toFixed(1)},${cy.toFixed(1)} `
      + `A${w.toFixed(1)},${(w * 0.95).toFixed(1)} 0 0 1 ${(100 + w).toFixed(1)},${cy.toFixed(1)} `
      + `C${(100 + w).toFixed(1)},${ty(0.22).toFixed(1)} 103,${ty(0.45).toFixed(1)} 103,${tail}Z`;
    if (d !== lastBubble) {
      lastBubble = d;
      el.bubble.setAttribute('d', d);
      el.bubbleClip.setAttribute('d', d);
      el.hpaint.setAttribute('x', (100 - w - 0.5).toFixed(1)); el.hpaint.setAttribute('y', (top - 0.5).toFixed(1));
      el.hpaint.setAttribute('width', (2 * w + 1).toFixed(1)); el.hpaint.setAttribute('height', (tail - top + 1).toFixed(1));
    }
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
    const y0 = 182;
    const shape = (w, l) => `M${100 - w},${y0} C${100 - w * 1.1},${y0 + l * 0.35} ${100 - w * 0.5},${y0 + l * 0.8} 100,${y0 + l} C${100 + w * 0.5},${y0 + l * 0.8} ${100 + w * 1.1},${y0 + l * 0.35} ${100 + w},${y0}Z`;
    el.po.setAttribute('d', shape(11 * widen, len));
    el.pm.setAttribute('d', shape(8 * widen, len * 0.8));
    el.pc.setAttribute('d', shape(4 * Math.sqrt(widen), len * 0.42));
    el.plume.style.opacity = el.plume.getAnimations().length ? el.plume.style.opacity : alpha.toFixed(2);
  }

  /* ---------------------------------------------------------- public */
  /** Jump to the right look for an altitude (boot, results, dev). */
  function set(km) {
    queue.length = 0;
    busyUntil = 0;
    lastKm = km;
    show(stageOf(km));
  }

  /** Width chips change the gore count: tighter bet, tighter stripes. */
  function setGores(n, twirl) {
    gores.n = n;
    if (twirl) gores.spin = 0.95;   // a quick turn, eased back to idle by the frame loop
  }
  const spin = (v) => { gores.spin = v; };
  /** A gentle pendulum kick to the basket (take-off). */
  const kick = (amp = 1) => { kickT0 = performance.now() / 1000; kickAmp = 3.2 * amp; };

  /** Points on the craft in viewBox units, for particles. Depends on stage. */
  function anchor(which) {
    const s = stage;
    if (which === 'burner') return s <= 1 ? [100, 166] : s === 2 ? [100, 236] : s === 3 ? [100, 184] : [100, 150];
    if (which === 'basket') return s === 0 ? [100, 222] : s === 1 ? [100, 224] : s === 2 ? [100, 236] : [100, 150];
    return s <= 1 ? [100, 70] : s === 2 ? [100, 50] : s === 3 ? [100, 70] : [100, 126];
  }

  return { build, frame, set, setGores, spin, kick, anchor, stageOf, setLivery, swatch, get livery() { return livId; }, get stage() { return stage; }, STAGES };
})();
