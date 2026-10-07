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

   Every colour is a literal hex (no CSS variables), so the live SVG can be
   serialised into the share image as-is.
   ========================================================================== */

K.vehicle = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const STAGES = [15, 21, 45, 100];                 // km where each stage starts
  const stageOf = (km) => STAGES.filter((s) => km >= s).length;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const C = {
    ember: '#FF6A3D', paper: '#F3E9D6', amber: '#FFB547', navy: '#1E2A55',
    night: '#0A0D1C', steel: '#3A4566', shade: '#CDBFA6', wicker: '#8A5A34',
    weave: '#6B4227', rim: '#5A3720', cream: '#FFF1C9',
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

  /** A truncated-cone capsule: top width tw at y, base width bw at y + h. */
  const capsule = (cx, y, tw, bw, h) => `M${cx - tw / 2},${y} L${cx + tw / 2},${y} L${cx + bw / 2},${y + h} L${cx - bw / 2},${y + h}Z`;

  /* ---------------------------------------------------------- state */
  let svg = null;
  let el = {};
  let stage = 0;                 // the stage currently shown (or animating to)
  let busyUntil = 0;             // transitions play one at a time
  const queue = [];
  const gores = { n: 12, phase: 0.35, spin: 0.26 };
  let tapePhase = 0;
  let lastKm = 0;

  /* ---------------------------------------------------------- build */
  function build(svgEl) {
    svg = svgEl;
    const env = envelopePath();
    svg.setAttribute('viewBox', '0 0 200 250');
    svg.setAttribute('xmlns', NS);
    svg.innerHTML = `
      <defs>
        <clipPath id="v-env"><path d="${env}"/></clipPath>
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
          <g class="v-gores"></g>
          <g class="v-pins" fill="none" stroke="${C.amber}" stroke-width=".8"></g>
          <g class="v-teeth" fill="${C.navy}"></g>
          <path d="${env}" fill="url(#v-vert)"/>
          <path d="${env}" fill="url(#v-shade)"/>
          <path d="M70,30 Q66,50 72,70 L78,70 Q72,50 76,30Z" fill="${C.paper}" opacity=".35"/>
        </g>
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
            <rect x="82" y="196" width="36" height="4.5" rx="2" fill="${C.rim}"/>
          </g>
        </g>

        <!-- stage 1: ropes to a ring + sealed gondola -->
        <g class="v-gondola" style="transform-origin:100px 182px;opacity:0">
          <g class="v-swing2" style="transform-origin:100px 164px">
            <g stroke="#2A2730" stroke-width="1" opacity=".9">
              <line x1="86" y1="162" x2="100" y2="182"/><line x1="94" y1="162" x2="100" y2="182"/>
              <line x1="106" y1="162" x2="100" y2="182"/><line x1="114" y1="162" x2="100" y2="182"/>
            </g>
            <rect x="92" y="168" width="16" height="8" rx="1.5" fill="${C.steel}"/>
            <circle cx="100" cy="182" r="2.2" fill="none" stroke="${C.steel}" stroke-width="1.4"/>
            <rect x="94" y="186" width="12" height="4.5" rx="1" fill="${C.steel}"/>
            <path d="${capsule(100, 190, 22, 36, 30)}" fill="${C.paper}"/>
            <path d="${capsule(100, 190, 22, 36, 30)}" fill="url(#v-body)"/>
            <path d="M82,220 Q100,228 118,220 L118,221.5 Q100,229.5 82,221.5Z" fill="${C.navy}"/>
            <circle cx="100" cy="204" r="9" fill="${C.amber}" opacity=".35"/>
            <circle cx="100" cy="204" r="5.5" fill="${C.night}" stroke="${C.amber}" stroke-width="1.5"/>
            <path class="v-gfrost" d="${capsule(100, 190, 22, 36, 30)}" fill="none" stroke="#fff" stroke-width="1.2" opacity="0"/>
          </g>
        </g>
      </g>

      <!-- STAGE 2: stratospheric helium balloon on a long flight line -->
      <g class="v-helium" style="transform-origin:100px 9px;opacity:0">
        <path class="v-bubble" fill="#DCE6F5" fill-opacity=".22" stroke="${C.paper}" stroke-opacity=".9" stroke-width="1.2"/>
        <g class="v-tapes" fill="none" stroke="${C.paper}" stroke-opacity=".4" stroke-width=".8"></g>
        <g class="v-pleats" fill="none" stroke="${C.paper}" stroke-opacity=".5" stroke-width=".7"></g>
        <ellipse class="v-valve" cx="100" cy="10" rx="6" ry="2" fill="${C.amber}"/>
        <line x1="100" y1="118" x2="100" y2="150" stroke="${C.paper}" stroke-opacity=".7" stroke-width=".9"/>
        <path d="M95,126 L105,126 L101.5,134 L98.5,134Z" fill="${C.ember}"/>
      </g>

      <!-- STAGES 2–3: the rocket (hangs small under the balloon, then flies) -->
      <g class="v-payload" style="transform-origin:100px 40px;opacity:0">
        <g class="v-tilt" style="transform-origin:100px 110px">
          <g class="v-plumewrap" style="transform-origin:100px 186px">
            <circle cx="100" cy="190" r="30" fill="url(#v-glow)" opacity=".5"/>
            <path class="v-plume-o" fill="${C.ember}" opacity=".55"/>
            <path class="v-plume-m" fill="url(#v-plume)"/>
            <path class="v-plume-c" fill="${C.cream}" opacity=".9"/>
          </g>
          <g class="v-booster" style="transform-origin:100px 130px">
            <path d="M89,150 L76,180 L89,176Z M111,150 L124,180 L111,176Z" fill="${C.ember}"/>
            <rect x="89" y="88" width="22" height="88" fill="${C.paper}"/>
            <rect x="89" y="88" width="22" height="88" fill="url(#v-body)"/>
            <rect x="89" y="100" width="22" height="4" fill="${C.navy}"/>
            <rect x="89" y="160" width="22" height="4" fill="${C.navy}"/>
            <rect x="98" y="150" width="4" height="26" fill="${C.ember}"/>
            <path d="M94,176 L106,176 L110,186 L90,186Z" fill="${C.steel}"/>
            <path d="M83,80 L117,80 L111,88 L89,88Z" fill="${C.navy}"/>
          </g>
          <g class="v-rcap">
            <path d="M91,40 Q100,33 109,40 L117,80 L83,80Z" fill="${C.paper}"/>
            <path d="M91,40 Q100,33 109,40 L117,80 L83,80Z" fill="url(#v-body)"/>
            <circle cx="100" cy="60" r="4.2" fill="${C.night}" stroke="${C.amber}" stroke-width="1.3"/>
            <path d="M83,80 Q100,85 117,80" fill="none" stroke="${C.navy}" stroke-width="2"/>
          </g>
          <circle class="v-flash" cx="100" cy="186" r="40" fill="#FFF6DF" opacity="0" style="transform-origin:100px 186px"/>
        </g>
      </g>

      <!-- STAGE 4: the capsule in space -->
      <g class="v-orbiter" style="transform-origin:100px 120px;opacity:0">
        <g class="v-bob4" style="transform-origin:100px 120px"><g transform="translate(100 124) scale(1.3) translate(-100 -120)">
          <g class="v-wing" style="transform-origin:80px 120px">
            <line x1="74" y1="120" x2="82" y2="120" stroke="${C.steel}" stroke-width="2"/>
            <rect x="30" y="113" width="44" height="14" fill="${C.navy}" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M41,113V127M52,113V127M63,113V127M30,120H74" stroke="${C.amber}" stroke-width=".6"/>
          </g>
          <g class="v-wing" style="transform-origin:120px 120px">
            <line x1="118" y1="120" x2="126" y2="120" stroke="${C.steel}" stroke-width="2"/>
            <rect x="126" y="113" width="44" height="14" fill="${C.navy}" stroke="${C.amber}" stroke-width=".6"/>
            <path d="M137,113V127M148,113V127M159,113V127M126,120H170" stroke="${C.amber}" stroke-width=".6"/>
          </g>
          <line class="v-antenna" x1="100" y1="98" x2="100" y2="80" stroke="${C.steel}" stroke-width="1.2" style="transform-origin:100px 98px"/>
          <circle class="v-tip" cx="100" cy="80" r="1.8" fill="${C.amber}"/>
          <path d="M88,98 Q100,92 112,98 L120,142 L80,142Z" fill="${C.paper}"/>
          <path d="M88,98 Q100,92 112,98 L120,142 L80,142Z" fill="url(#v-body)"/>
          <path d="M88,98 L80,142" stroke="${C.amber}" stroke-width="1.4" opacity=".7"/>
          <circle cx="100" cy="116" r="5" fill="${C.night}" stroke="${C.amber}" stroke-width="1.4"/>
          <path d="M80,142 Q100,148 120,142" fill="none" stroke="${C.navy}" stroke-width="2.4"/>
        </g></g>
      </g>`;

    const q = (s) => svg.querySelector(s);
    el = {
      hot: q('.v-hot'), gores: q('.v-gores'), pins: q('.v-pins'), teeth: q('.v-teeth'), medal: q('.v-medal'),
      frost: q('.v-frost'), flame: q('.v-flame'), glow: q('.v-glowwrap'),
      basket: q('.v-basket'), swing: q('.v-swing'), gondola: q('.v-gondola'), swing2: q('.v-swing2'), gfrost: q('.v-gfrost'),
      helium: q('.v-helium'), bubble: q('.v-bubble'), tapes: q('.v-tapes'), pleats: q('.v-pleats'), valve: q('.v-valve'),
      payload: q('.v-payload'), tilt: q('.v-tilt'), plume: q('.v-plumewrap'), booster: q('.v-booster'), rcap: q('.v-rcap'),
      po: q('.v-plume-o'), pm: q('.v-plume-m'), pc: q('.v-plume-c'), flash: q('.v-flash'),
      orbiter: q('.v-orbiter'), bob4: q('.v-bob4'), wings: svg.querySelectorAll('.v-wing'), tip: q('.v-tip'), antenna: q('.v-antenna'),
    };
    // Pools of paths reused every frame (no DOM churn while spinning).
    el.gorePool = pool(el.gores, 30);
    el.pinPool = pool(el.pins, 10);
    el.teethPool = pool(el.teeth, 30);
    el.tapePool = pool(el.tapes, 10);
    el.pleatPool = pool(el.pleats, 3);
  }

  function pool(parent, n) {
    return Array.from({ length: n }, () => parent.appendChild(document.createElementNS(NS, 'path')));
  }

  /* ---------------------------------------------------------- per-stage looks */
  const PAYLOAD_HANG = 'translate(0px, 110px) scale(0.6)';      // under the helium balloon
  const PAYLOAD_FLY = 'translate(0px, 0px) scale(1)';

  /** Jump straight to the look of a stage (no animation). */
  function show(s) {
    stage = s;
    const vis = (node, on) => { node.style.opacity = on ? '1' : '0'; node.style.visibility = on ? 'visible' : 'hidden'; };
    [el.hot, el.basket, el.gondola, el.helium, el.payload, el.booster, el.rcap, el.plume, el.orbiter].forEach((n) => {
      n.getAnimations().forEach((a) => a.cancel());
      n.style.transform = '';
    });
    el.wings.forEach((w) => { w.getAnimations().forEach((a) => a.cancel()); w.style.transform = ''; });
    vis(el.hot, s <= 1);
    vis(el.basket, s === 0);
    vis(el.gondola, s === 1);
    vis(el.helium, s === 2);
    vis(el.payload, s === 2 || s === 3);
    vis(el.booster, true);
    vis(el.rcap, true);
    vis(el.plume, s === 3);
    el.payload.style.transform = s === 2 ? PAYLOAD_HANG : PAYLOAD_FLY;
    vis(el.orbiter, s === 4);
    el.flash.setAttribute('opacity', '0');
  }

  /* ---------------------------------------------------------- transitions */
  const anim = (node, frames, ms, delay = 0, easing = 'cubic-bezier(.16,1,.3,1)') =>
    node.animate(frames, { duration: ms, delay, easing, fill: 'forwards' });
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

    if (from === 0 && to === 1) {                 // 15 km: the basket is sealed into a gondola
      K.audio.stage('seal');
      const p = pt(100, 205);
      K.fx.embers(p.x, p.y, { count: 14, speed: 90, life: 0.7, color: C.paper });
      K.scene.flare(1.3);
      appear(el.gondola);
      anim(el.basket, [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 0 }], 300 * k, 120 * k, 'cubic-bezier(.55,0,1,.45)');
      anim(el.gondola, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], 400 * k, 160 * k);
      return 720 * k;
    }
    if (from === 1 && to === 2) {                 // 21 km: helium balloon takes over
      K.audio.stage('swap');
      appear(el.helium); appear(el.payload);
      el.payload.style.transform = PAYLOAD_HANG;
      el.plume.style.visibility = 'hidden'; el.plume.style.opacity = '0';
      anim(el.hot, [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(.25) translateY(-30px)', opacity: 0 }], 420 * k, 0, 'cubic-bezier(.55,0,1,.45)');
      anim(el.helium, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.75 }, { transform: 'scale(1)', opacity: 1 }], 420 * k, 150 * k);
      anim(el.payload, [{ transform: 'translate(0px, 170px) scale(0.6)', opacity: 0 }, { transform: 'translate(0px, 106px) scale(0.6)', opacity: 1, offset: 0.8 }, { transform: PAYLOAD_HANG, opacity: 1 }], 420 * k, 300 * k);
      return 820 * k;
    }
    if (from === 2 && to === 3) {                 // 45 km: release, drop, ignition
      K.audio.stage('ignite');
      const cut = pt(100, 150);
      K.fx.sparks(cut.x, cut.y, { count: 14, speed: 160, color: C.amber });
      anim(el.helium, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-260px)', opacity: 0 }], 780 * k, 120 * k, 'cubic-bezier(.55,0,1,.45)');
      anim(el.payload, [
        { transform: PAYLOAD_HANG },
        { transform: 'translate(0px, 120px) scale(0.6)', offset: 0.35, easing: 'cubic-bezier(.55,0,1,.45)' },
        { transform: PAYLOAD_FLY },
      ], 780 * k, 120 * k);
      appear(el.plume);
      anim(el.plume, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], 480 * k, 420 * k);
      setTimeout(() => {
        const n = pt(100, 186);
        K.fx.ringBurst(n.x, n.y, '#FFD9A0');
        K.fx.embers(n.x, n.y, { count: 30, speed: 260, color: C.amber });
        K.fx.nudge();
        el.flash.animate([{ transform: 'scale(0)', opacity: 0.9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 260, easing: 'ease-out' });
      }, 380 * k);
      return 900 * k;
    }
    if (from === 3 && to === 4) {                 // 100 km: cut-off, separation, panels out
      K.audio.stage('separate');
      anim(el.plume, [{ opacity: 1, transform: 'scaleY(1)' }, { opacity: 0, transform: 'scaleY(.2)' }], 120 * k, 0);
      const s = pt(100, 84);
      K.fx.sparks(s.x, s.y, { count: 10, speed: 140, color: C.paper });
      anim(el.booster, [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: 'translateY(90px) rotate(25deg)', opacity: 0 }], 650 * k, 150 * k, 'cubic-bezier(.55,0,1,.45)');
      anim(el.rcap, [{ opacity: 1 }, { opacity: 0 }], 250 * k, 150 * k);
      appear(el.orbiter);
      anim(el.orbiter, [{ transform: 'translateY(-60px) scale(.85)', opacity: 0 }, { transform: 'translateY(-60px) scale(.85)', opacity: 1, offset: 0.3 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], 800 * k, 150 * k);
      el.wings.forEach((w) => anim(w, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1.08)', offset: 0.8 }, { transform: 'scaleX(1)' }], 450 * k, 450 * k));
      return 950 * k;
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
        el.swing.style.transform = `rotate(${(Math.sin(t * 2.03) * 2).toFixed(2)}deg)`;
        el.swing2.style.transform = `rotate(${(Math.sin(t * 2.03) * 1).toFixed(2)}deg)`;
      }
    }

    // Helium balloon: fills out as the air thins.
    if (stage === 2 || el.helium.style.visibility === 'visible') {
      if (!calm) tapePhase += dt * ((Math.PI * 2) / 40);
      drawHelium(ease(clamp((km - 21) / 24, 0, 1)), tapePhase);
      if (!calm && stage === 2) el.payload.style.transform = `translate(0px, 110px) scale(0.6) rotate(${(Math.sin(t * 1.05) * 1.5).toFixed(2)}deg)`;
    }

    // Rocket: flickering plume that spreads out as the air thins, slight tilt.
    if (stage === 3) {
      const f = clamp((km - 45) / 55, 0, 1);
      const jitter = calm ? 0 : Math.sin(t * 37) * 0.6;
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

  function drawEnvelope(phase) {
    const N = gores.n, step = (Math.PI * 2) / N;
    let g = 0, p = 0, th = 0;
    const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
    const front = (a) => Math.cos(a) > 0;
    const yA = ENV_YS.indexOf(126), yB = ENV_YS.length - 1;
    for (let k = 0; k < N; k++) {
      const a0 = wrap(phase + k * step);
      let a = a0, b = a0 + step;
      // Clip to the visible half (−π/2 … π/2).
      const lo = Math.max(a, -Math.PI / 2), hi = Math.min(b, Math.PI / 2);
      const isEmber = k % 3 !== 2;
      if (hi > lo && g < el.gorePool.length) {
        const path = el.gorePool[g++];
        path.setAttribute('d', gorePath(lo, hi));
        path.setAttribute('fill', isEmber ? C.ember : C.paper);
      }
      // Seam pinline between the two ember gores of each pair.
      if (k % 3 === 0) {
        const seam = wrap(a0 + step);
        if (front(seam) && p < el.pinPool.length) el.pinPool[p++].setAttribute('d', meridianPath(seam));
      }
      // Tooth: one navy triangle per gore under the belly.
      const c = a0 + step / 2;
      if (Math.cos(a0) > 0.05 && Math.cos(a0 + step) > 0.05 && th < el.teethPool.length) {
        const r1 = rAt(126), r2 = rAt(138);
        el.teethPool[th++].setAttribute('d', `M${(100 + r1 * Math.sin(a0)).toFixed(2)},126 L${(100 + r1 * Math.sin(a0 + step)).toFixed(2)},126 L${(100 + r2 * Math.sin(c)).toFixed(2)},138Z`);
      }
      void yA; void yB; void b;
    }
    for (let i = g; i < el.gorePool.length; i++) el.gorePool[i].setAttribute('d', '');
    for (let i = p; i < el.pinPool.length; i++) el.pinPool[i].setAttribute('d', '');
    for (let i = th; i < el.teethPool.length; i++) el.teethPool[i].setAttribute('d', '');
    // Medallion: rides the first ember seam round the envelope.
    const theta = wrap(phase + step);
    const cs = Math.cos(theta);
    if (cs > 0.05) {
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
    const y0 = 186;
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
    if (twirl) gores.spin = 1.4;
  }
  const spin = (v) => { gores.spin = v; };

  /** Points on the craft in viewBox units, for particles. Depends on stage. */
  function anchor(which) {
    const s = stage;
    if (which === 'burner') return s <= 1 ? [100, 166] : s === 2 ? [100, 238] : s === 3 ? [100, 190] : [100, 145];
    if (which === 'basket') return s === 0 ? [100, 222] : s === 1 ? [100, 224] : s === 2 ? [100, 238] : [100, 145];
    return s <= 1 ? [100, 70] : s === 2 ? [100, 50] : s === 3 ? [100, 70] : [100, 120];
  }

  return { build, frame, set, setGores, spin, anchor, stageOf, get stage() { return stage; }, STAGES };
})();
