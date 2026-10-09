/* ==========================================================================
   KÁRMÁN · ambient.js
   The sky's living details, drawn on one canvas between the sky gradient and
   the world. Each effect belongs to a band of altitude, so the climb feels
   like passing through real places:

     0–6 km     sunbeams falling from the sun, breathing slowly
     0.3–2.5 km a small flock of birds crossing
     2 km       a soft white flash as you punch through the cloud deck
     20–30 km   nacreous (mother-of-pearl) cloud bands
     45–95 km   sprites: brief red flashes of upper-atmosphere lightning
     86 km +    aurora curtains above the card (you rise through them by apogee),
                meteors burning up, a Sputnik-era satellite crossing
     any        wind streaks while the camera is climbing fast

   Everything reads K.scene.km and K.scene.yOf(km), so it scrolls with the
   world. With reduced motion on, effects hold still and the flash is skipped.
   The canvas renders at up to 1.5× pixel density to stay light on phones.
   ========================================================================== */

K.ambient = (() => {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const band = (km, a, b, c, d) => // 0 below a, ramps to 1 at b, holds to c, fades to 0 at d
    km <= a || km >= d ? 0 : km < b ? (km - a) / (b - a) : km <= c ? 1 : 1 - (km - c) / (d - c);

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let lastKm = 0, lastT = 0, speed = 0, flash = 0, wasClear = false;
  const streaks = [];
  let birds = [], flockX = -0.2, flockKm = 1.1;
  let sat = null, satNext = 4;
  let dockTop = 0, dockCheck = 0; // the aurora sits just above the card, where the sky is visible
  let firstFlock = true;

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* mode: 'open' = in the open sky, entering from the left (or mid-sky on first load)
           'above' = just above the top edge, so the climb brings it into view */
  function newFlock(mode = 'open') {
    const rand = Math.random;
    flockX = mode === 'above' ? 0.15 + rand() * 0.55 : firstFlock ? 0.2 + rand() * 0.3 : -0.15;
    firstFlock = false;
    // Pick the altitude that puts the flock in the open sky above the card.
    const want = mode === 'above' ? -30 : H * 0.18 + rand() * Math.max(40, (dockTop || H * 0.55) - H * 0.18 - 80);
    let best = K.scene.km, err = Infinity;
    for (let k = Math.max(0.05, K.scene.km - 3); k < K.scene.km + 3; k += 0.02) {
      const e = Math.abs(K.scene.yOf(k) - want);
      if (e < err) { err = e; best = k; }
    }
    flockKm = best;
    birds = Array.from({ length: 5 + Math.floor(rand() * 4) }, (_, i) => ({
      dx: -i * (14 + rand() * 6) - rand() * 8,
      dy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (7 + rand() * 4),
      phase: rand() * Math.PI * 2,
      s: 0.8 + rand() * 0.4,
    }));
  }

  /* ---------------------------------------------------------- effects */
  /* Sunbeams: a few soft shafts falling from the sun, down and to the left
     across the meadow, breathing slowly. Gone by 6 km. */
  function godRays(km, t, still) {
    const a = band(km, -1, 0, 3, 6) * 0.16;
    if (a <= 0) return;
    const sx = W * 0.8, sy = H * 0.38;        // the sun's centre (scene.css)
    const len = Math.hypot(W, H) * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i++) {
      // angles are measured from +x, clockwise on screen: ~1.75 is straight down
      const ang = 1.78 + i * 0.22 + (still ? 0 : Math.sin(t * 0.06 + i * 1.9) * 0.025);
      const w = 0.035 + 0.02 * Math.sin(i * 2.3 + 1);
      const breathe = still ? 1 : 0.7 + 0.3 * Math.sin(t * 0.3 + i * 1.7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, len * 0.9);
      g.addColorStop(0, `rgba(255,236,200,${(a * breathe).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(255,236,200,${(a * breathe * 0.45).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(ang - w) * len, sy + Math.sin(ang - w) * len);
      ctx.lineTo(sx + Math.cos(ang + w) * len, sy + Math.sin(ang + w) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function flock(km, t, dt, still) {
    if (km > 3.5) return;
    if (!birds.length) newFlock();
    if (!still) flockX += dt * 0.035;
    let y0 = K.scene.yOf(flockKm);
    if (flockX > 1.25) { newFlock('open'); y0 = K.scene.yOf(flockKm); }
    else if (y0 > (dockTop || H) + 30) { newFlock('above'); y0 = K.scene.yOf(flockKm); }
    if (y0 < -40 || y0 > H + 40) return;
    const x0 = flockX * W;
    ctx.save();
    ctx.fillStyle = 'rgba(39,48,77,0.62)';   // the same ink as the geese and the other sights
    for (const b of birds) {
      const x = x0 + b.dx * b.s, y = y0 + b.dy + Math.sin(t * 1.3 + b.phase) * 2;
      const flap = still ? 0.4 : Math.sin(t * 9 + b.phase);
      const span = 6 * b.s, lift = 3 + flap * 3.5;
      // Two tapered wings, thick at the body and fine at the tips, as one filled shape.
      ctx.beginPath();
      ctx.moveTo(x - span, y - lift);
      ctx.quadraticCurveTo(x - span * 0.45, y - 1.6 - lift * 0.1, x - 0.9, y - 0.7);
      ctx.lineTo(x + 0.9, y - 0.7);
      ctx.quadraticCurveTo(x + span * 0.45, y - 1.6 - lift * 0.1, x + span, y - lift);
      ctx.quadraticCurveTo(x + span * 0.45, y + 0.3, x + 0.7, y + 1.2);
      ctx.lineTo(x - 0.7, y + 1.2);
      ctx.quadraticCurveTo(x - span * 0.45, y + 0.3, x - span, y - lift);
      ctx.fill();
    }
    ctx.restore();
  }

  /* Nacreous bands: a soft 1-px-wide gradient sprite per colour, stamped in
     narrow columns that follow a slow wave, so each band has feathered edges. */
  const NAC = ['255,120,190', '90,230,180', '120,170,255', '255,190,110'];
  let nacSprites = null;
  function nacSprite(rgb) {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(0.5, `rgba(${rgb},1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 1, 64);
    return c;
  }
  function nacreous(km, t, still) {
    const a = band(km, 16, 21, 30, 37);
    if (a <= 0) return;
    if (!nacSprites) nacSprites = NAC.map(nacSprite);
    const drift = still ? 0 : t * 0.15;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i++) {
      const y = K.scene.yOf(25 + i * 2.2); // just above the balloon while you cross 20–30 km
      if (y < -120 || y > H + 120) continue;
      const thick = 34 + i * 6;
      for (let x = 0; x < W; x += 6) {
        const k = 0.55 + 0.45 * Math.sin(x / 170 + i * 2.1 + drift * 0.7); // brightness varies along the band
        ctx.globalAlpha = 0.45 * a * k;
        const yy = y + Math.sin(x / 140 + i * 1.3 + drift) * 12;
        ctx.drawImage(nacSprites[i], 0, 0, 1, 64, x, yy - thick / 2, 6, thick);
      }
    }
    ctx.restore();
  }

  /* Aurora: thin curtains hung in the sky between about 102 and 128 km,
     where the real ones begin. They are placed in the world (K.scene.yOf),
     so you climb up into them from below and look down on them at apogee,
     draped over the Earth's limb. One vertical sprite (green foot, violet
     crown) is stamped in narrow columns whose height and brightness ripple,
     so the curtain folds and rays without any per-column gradients. */
  let curtain = null;
  function curtainSprite() {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 160;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 160);
    g.addColorStop(0, 'rgba(190,120,255,0)');
    g.addColorStop(0.3, 'rgba(176,118,255,0.22)');
    g.addColorStop(0.72, 'rgba(96,232,176,0.5)');
    g.addColorStop(0.93, 'rgba(120,255,190,0.85)');
    g.addColorStop(1, 'rgba(120,255,190,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 1, 160);
    return c;
  }
  let auroraBuf = null;
  function aurora(km, t, still) {
    const a = clamp((km - 86) / 16, 0, 1);
    if (a <= 0) return;
    // The curtains hang in the open sky above the card. As you climb on past
    // the Kármán line you rise through them: by apogee they have sunk low
    // and the sky above is clear, which is the quiet of the top.
    const sink = clamp((km - 100) / 40, 0, 1);
    const foot = Math.min(H * 0.92, (dockTop || H * 0.55) + 6 + sink * H * 0.22);
    const span = H * 0.42;
    if (!curtain) curtain = curtainSprite();
    // Painted small (a quarter of the width, 180 px tall) and stretched: the
    // curtains are soft anyway, and it keeps the per-frame work light.
    const bw = Math.ceil(W / 4), bh = 180;
    if (!auroraBuf) auroraBuf = document.createElement('canvas');
    if (auroraBuf.width !== bw) { auroraBuf.width = bw; auroraBuf.height = bh; }
    const bx = auroraBuf.getContext('2d');
    bx.clearRect(0, 0, bw, bh);
    const drift = still ? 0 : t;
    const step = 2;
    for (let x = 0; x < bw; x += step) {
      const X = x * 4;
      // folds: a slow wave along the curtain; rays: a finer flicker
      const fold = Math.sin(X / 150 + drift * 0.22) * 0.5 + Math.sin(X / 61 - drift * 0.31) * 0.3;
      const ray = 0.55 + 0.45 * (0.5 * Math.sin(X / 9 + drift * 1.3 + Math.sin(X / 40) * 3) + 0.5 * Math.sin(X / 23 - drift * 0.9));
      const k = (0.55 + 0.45 * Math.sin(X / 230 + drift * 0.17)) * ray;
      const h = bh * 0.9 * (0.62 + 0.38 * (0.5 + fold));
      bx.globalAlpha = 0.62 * k;
      const y1 = bh * 0.95 + fold * 7;
      bx.drawImage(curtain, 0, 0, 1, 160, x, y1 - h, step, h);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = a;
    ctx.drawImage(auroraBuf, 0, foot - span, W, span);
    ctx.restore();
  }

  /* A satellite of the first kind: a polished sphere trailing four whip
     antennas, crossing slowly once you are past the Kármán line. */
  function satellite(km, dt, still) {
    const a = clamp((km - 98) / 8, 0, 1);
    if (a <= 0 || still) return;
    if (!sat) {
      satNext -= dt;
      if (satNext <= 0) {
        const fromLeft = Math.random() < 0.5;
        sat = { x: fromLeft ? -30 : W + 30, y: H * (0.06 + Math.random() * 0.22), vx: (fromLeft ? 1 : -1) * W / 24, vy: H * 0.006, life: 0 };
      }
      return;
    }
    sat.x += sat.vx * dt;
    sat.y += sat.vy * dt;
    sat.life += dt;
    const dir = sat.vx > 0 ? 1 : -1, r = 3.2;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(246,238,221,0.75)'; ctx.lineWidth = 0.8;
    for (const [ang, len] of [[0.28, 16], [0.62, 13], [-0.28, 16], [-0.62, 13]]) {
      ctx.beginPath();
      ctx.moveTo(sat.x - dir * r * 0.6, sat.y);
      ctx.lineTo(sat.x - dir * (r + Math.cos(ang) * len), sat.y + Math.sin(ang) * len);
      ctx.stroke();
    }
    const sh = ctx.createRadialGradient(sat.x - r * 0.4, sat.y - r * 0.45, 0.4, sat.x, sat.y, r);
    sh.addColorStop(0, '#FFFFFF'); sh.addColorStop(0.55, '#E2DCCB'); sh.addColorStop(1, '#8E96AE');
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(sat.x, sat.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(34,48,90,0.7)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(sat.x, sat.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (sat.x < -60 || sat.x > W + 60) { sat = null; satNext = 14 + Math.random() * 16; }
  }

  /* Meteors burn up between 80 and 120 km, far off in the open sky above
     the card: a bright head and a dry-brush tail, a few a minute. */
  const meteors = [];
  let meteorNext = 2;
  function meteorShower(km, dt, still) {
    const a = clamp((km - 66) / 20, 0, 1);
    if (a <= 0 || still) return;
    meteorNext -= dt;
    if (meteorNext <= 0) {
      const dir = Math.random() < 0.6 ? -1 : 1;
      meteors.push({ x: Math.random() * W, y: H * (0.04 + Math.random() * 0.26), vx: dir * (260 + Math.random() * 220), vy: 130 + Math.random() * 90, life: 0, max: 0.5 + Math.random() * 0.5, w: 1.2 + Math.random() * 1.2 });
      meteorNext = 2 + Math.random() * 4;
    }
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const f = 1 - m.life / m.max;
      if (f <= 0) { meteors.splice(i, 1); continue; }
      const burn = Math.sin(Math.min(1, m.life / m.max) * Math.PI);   // brightens, then gutters out
      const tl = 0.22 + 0.1 * burn;
      const tx = m.x - m.vx * tl, ty = m.y - m.vy * tl;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,244,220,${(0.95 * burn * a).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(255,214,160,${(0.5 * burn * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,170,120,0)');
      ctx.strokeStyle = g;
      // three strokes of falling width: the tail is a brush, not a line
      for (const [k, w] of [[1, 0.5], [0.6, 1], [0.3, 1.6]]) {
        ctx.lineWidth = m.w * w;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + (tx - m.x) * k, m.y + (ty - m.y) * k); ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,250,236,${(0.9 * burn * a).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.w * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* Sprites: red "jellyfish" flashes of upper-atmosphere lightning, 50–90 km. */
  let sprite = null, spriteNext = 3;
  function sprites(km, dt, still) {
    const a = km > 45 && km < 95 ? 1 : 0;
    if (!a || still) return;
    spriteNext -= dt;
    if (!sprite && spriteNext <= 0) { sprite = { x: W * (0.15 + Math.random() * 0.7), y: H * (0.25 + Math.random() * 0.25), t: 0 }; spriteNext = 4 + Math.random() * 6; }
    if (!sprite) return;
    sprite.t += dt;
    const f = sprite.t < 0.06 ? sprite.t / 0.06 : Math.max(0, 1 - (sprite.t - 0.06) / 0.35);
    if (f <= 0) { sprite = null; return; }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const { x, y } = sprite;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 46);
    g.addColorStop(0, `rgba(255,90,110,${(0.55 * f).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 40, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,110,130,${(0.45 * f).toFixed(3)})`; ctx.lineWidth = 1.2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x + k * 7, y + 6); ctx.quadraticCurveTo(x + k * 9, y + 30, x + k * 6, y + 58); ctx.stroke(); }
    ctx.restore();
  }

  function wind(dt, still) {
    if (still) return;
    // speed is in "sky fractions per second"; a normal climb is around 0.05–0.25
    const want = clamp((speed - 0.015) * 200, 0, 34);
    while (streaks.length < want) {
      streaks.push({ x: Math.random() * W, y: Math.random() * H * 1.1 - H * 0.25, len: 40 + Math.random() * 90, v: 0.9 + Math.random() * 0.7 });
    }
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.y += s.v * H * dt * clamp(speed * 9, 0.6, 3.2);
      const alpha = clamp(speed * 3.5, 0, 0.45) * (i < want ? 1 : 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x, s.y + s.len);
      ctx.stroke();
      if (s.y > H || (i >= want && Math.random() < 0.1)) streaks.splice(i, 1);
    }
    ctx.restore();
  }

  function punchThrough(km, dt, still) {
    // Flash once each time the balloon climbs out through the cloud deck.
    const clear = km >= 2.1;
    if (clear && !wasClear && lastKm < 2.1 && !still) flash = 1;
    wasClear = clear;
    if (flash <= 0) return;
    ctx.fillStyle = `rgba(255,255,255,${(flash * 0.38).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    flash = Math.max(0, flash - dt * 1.8);
  }

  /* ---------------------------------------------------------- loop */
  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, lastT ? t - lastT : 0.016);
    lastT = t;
    const km = K.scene.km;
    const still = K.fx.reduced();
    let df = Math.abs(K.scene.fOf(km) - K.scene.fOf(lastKm)) / Math.max(dt, 1e-3);
    const jumped = df > 3; // a reset or resume teleports the camera: no wind, no flash
    if (jumped) df = 0;
    speed += (df - speed) * Math.min(1, dt * 6);

    if (t > dockCheck) {
      const d = document.getElementById('dock');
      dockTop = d ? d.getBoundingClientRect().top : 0;
      dockCheck = t + 0.5;
    }
    ctx.clearRect(0, 0, W, H);
    godRays(km, t, still);
    nacreous(km, t, still);
    aurora(km, t, still);
    satellite(km, dt, still);
    sprites(km, dt, still);
    meteorShower(km, dt, still);
    flock(km, t, dt, still);
    wind(dt, still);
    punchThrough(km, dt, still || jumped);

    lastKm = km;
    requestAnimationFrame(frame);
  }

  function init() {
    cv = document.getElementById('ambient');
    if (!cv) return;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    lastKm = K.scene.km;
    wasClear = lastKm >= 2.1;
    requestAnimationFrame(frame);
  }

  return { init };
})();
