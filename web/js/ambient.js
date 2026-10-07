/* ==========================================================================
   KÁRMÁN · ambient.js
   The sky's living details, drawn on one canvas between the sky gradient and
   the world. Each effect belongs to a band of altitude, so the climb feels
   like passing through real places:

     0–6 km     god rays from the sun, breathing slowly
     0.3–2.5 km a small flock of birds crossing
     2 km       a soft white flash as you punch through the cloud deck
     20–30 km   nacreous (mother-of-pearl) cloud bands
     45–95 km   sprites: brief red flashes of upper-atmosphere lightning
     60 km +    aurora curtains, meteors burning up, and a passing satellite
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
  function godRays(km, t, still) {
    const a = band(km, -1, 0, 3, 6) * 0.22;
    if (a <= 0) return;
    const sx = W * 0.8, sy = H * 0.38;
    const len = Math.hypot(W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 7; i++) {
      const ang = 2.2 + i * 0.29 + (still ? 0 : Math.sin(t * 0.07 + i) * 0.03);
      const w = 0.05 + 0.03 * Math.sin(i * 2.3);
      const breathe = still ? 1 : 0.65 + 0.35 * Math.sin(t * 0.35 + i * 1.7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, len * 0.8);
      g.addColorStop(0, `rgba(255,236,200,${(a * breathe).toFixed(3)})`);
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
    ctx.strokeStyle = 'rgba(30,40,70,0.55)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const b of birds) {
      const x = x0 + b.dx * b.s, y = y0 + b.dy + Math.sin(t * 1.3 + b.phase) * 2;
      const flap = still ? 0.4 : Math.sin(t * 9 + b.phase);
      const span = 6 * b.s, lift = 3 + flap * 3.5;
      ctx.beginPath();
      ctx.moveTo(x - span, y - lift);
      ctx.quadraticCurveTo(x - span * 0.4, y - 1, x, y);
      ctx.quadraticCurveTo(x + span * 0.4, y - 1, x + span, y - lift);
      ctx.stroke();
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

  function aurora(km, t, still) {
    const a = clamp((km - 55) / 35, 0, 1);
    if (a <= 0) return;
    const base = Math.min(H * 0.8, (dockTop || H * 0.55) + 24);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let x = 0; x < W; x += 5) {
      const wave = Math.sin(x / 90 + (still ? 0 : t * 0.25)) + Math.sin(x / 37 - (still ? 0 : t * 0.4)) * 0.5;
      const h = 170 + wave * 55 + Math.sin(x / 210) * 60;
      const k = 0.5 + 0.5 * Math.sin(x / 160 + (still ? 0 : t * 0.18));
      const top = base - h - wave * 10;
      const g = ctx.createLinearGradient(0, top, 0, base);
      g.addColorStop(0, 'rgba(170,110,255,0)');
      g.addColorStop(0.35, `rgba(160,110,255,${(0.3 * a * k).toFixed(3)})`);
      g.addColorStop(0.85, `rgba(90,255,170,${(0.7 * a * k).toFixed(3)})`);
      g.addColorStop(1, 'rgba(90,255,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, top, 5, base - top);
    }
    ctx.restore();
  }

  function satellite(km, dt, still) {
    const a = clamp((km - 55) / 25, 0, 1);
    if (a <= 0 || still) return;
    if (!sat) {
      satNext -= dt;
      if (satNext <= 0) {
        const fromLeft = Math.random() < 0.5;
        sat = { x: fromLeft ? -10 : W + 10, y: H * (0.08 + Math.random() * 0.3), vx: (fromLeft ? 1 : -1) * W / 14, vy: H * 0.012, life: 0 };
      }
      return;
    }
    sat.x += sat.vx * dt;
    sat.y += sat.vy * dt;
    sat.life += dt;
    const blink = 0.75 + 0.25 * Math.sin(sat.life * 3);
    ctx.fillStyle = `rgba(255,255,255,${(0.85 * a * blink).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sat.x, sat.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    if (sat.x < -20 || sat.x > W + 20) { sat = null; satNext = 10 + Math.random() * 12; }
  }

  /* Meteors burn up 70–110 km: short bright streaks, a few a minute. */
  const meteors = [];
  let meteorNext = 2;
  function meteorShower(km, dt, still) {
    const a = Math.min(1, Math.max(0, (km - 60) / 25));
    if (a <= 0 || still) return;
    meteorNext -= dt;
    if (meteorNext <= 0) {
      meteors.push({ x: Math.random() * W, y: Math.random() * H * 0.4, vx: -(260 + Math.random() * 200), vy: 120 + Math.random() * 90, life: 0, max: 0.6 + Math.random() * 0.5 });
      meteorNext = 1.2 + Math.random() * 3;
    }
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const f = 1 - m.life / m.max;
      if (f <= 0) { meteors.splice(i, 1); continue; }
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.18, m.y - m.vy * 0.18);
      g.addColorStop(0, `rgba(255,244,220,${(0.9 * f * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 0.18, m.y - m.vy * 0.18); ctx.stroke();
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
