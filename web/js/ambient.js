/* ==========================================================================
   KÁRMÁN · ambient.js
   The sky's living details, drawn on one canvas between the sky gradient and
   the world. Each effect belongs to a band of altitude, so the climb feels
   like passing through real places:

     0–6 km     crepuscular rays falling from the sun toward the land
     0.3–2.5 km a small flock of birds crossing
     2 km       a soft white flash as you punch through the cloud deck
     20–30 km   nacreous (mother-of-pearl) cloud bands
     45–95 km   sprites: brief red flashes of upper-atmosphere lightning
     60 km +    meteors burning up and a passing satellite
     100 km +   aurora curtains hung on the world: green from 100 km, red
                tops above 130 (seen from below as you near the line)
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
  let dockTop = 0, dockCheck = 0; // where the card starts: flocks stay in the open sky above it
  let firstFlock = true;

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rays = null;   // re-rendered at the new size on next use
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
  /* Crepuscular rays: the sun's light falling in soft shafts down toward
     the land, the way it breaks under a cloud deck, never sideways. Two
     sets of shafts are painted once into small offscreen canvases (at a
     quarter of the pixels; they are soft anyway) and breathe in turn, so a
     frame costs two drawImage calls. */
  let rays = null;
  function paintRays() {
    const q = 0.5, w = Math.max(1, Math.round(W * q)), h = Math.max(1, Math.round(H * q));
    const sx = W * 0.8 * q, sy = H * 0.38 * q, r0 = Math.min(W, H) * 0.05 * q;
    const len = Math.hypot(W, H) * q;
    const set = [[], []];
    // A fan pointing down and a little west, toward the meadow; widths and
    // angles uneven, like shafts through gaps in cloud.
    const ANG = [1.38, 1.55, 1.68, 1.86, 1.99, 2.17, 2.32, 2.47];
    ANG.forEach((a, i) => set[i % 2].push([a, 0.022 + 0.018 * ((i * 7) % 5) / 4]));
    rays = set.map((list) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      for (const [a, hw] of list) {
        const g = x.createLinearGradient(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0, sx + Math.cos(a) * len * 0.75, sy + Math.sin(a) * len * 0.75);
        g.addColorStop(0, 'rgba(255,238,206,0)');
        g.addColorStop(0.12, 'rgba(255,238,206,0.9)');
        g.addColorStop(0.55, 'rgba(255,232,196,0.35)');
        g.addColorStop(1, 'rgba(255,232,196,0)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(sx + Math.cos(a - hw * 0.35) * r0, sy + Math.sin(a - hw * 0.35) * r0);
        x.lineTo(sx + Math.cos(a - hw) * len, sy + Math.sin(a - hw) * len);
        x.lineTo(sx + Math.cos(a + hw) * len, sy + Math.sin(a + hw) * len);
        x.lineTo(sx + Math.cos(a + hw * 0.35) * r0, sy + Math.sin(a + hw * 0.35) * r0);
        x.closePath();
        x.fill();
      }
      return c;
    });
  }
  function godRays(km, t, still) {
    const a = band(km, -1, 0, 3, 6) * 0.2;
    if (a <= 0) return;
    if (!rays) paintRays();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 2; i++) {
      const breathe = still ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.3 + i * 2.4);
      ctx.globalAlpha = a * breathe;
      ctx.drawImage(rays[i], 0, 0, W, H);
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

  /* Aurora: curtains hung on the world, their hems at 100 km and their tops
     reaching past the ceiling, green below and a thin red above (oxygen at
     two heights). Drawn like a gouache wash in vertical strokes: one
     pre-rendered column sprite, stamped in narrow strips whose height and
     strength ripple slowly, the hem folding like cloth. */
  let auroraSprite = null;
  function auroraColumn() {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);   // top → hem
    g.addColorStop(0, 'rgba(255,90,120,0)');
    g.addColorStop(0.16, 'rgba(236,96,150,0.32)');
    g.addColorStop(0.42, 'rgba(120,226,170,0.5)');
    g.addColorStop(0.86, 'rgba(120,255,180,0.95)');
    g.addColorStop(0.93, 'rgba(210,255,220,1)');
    g.addColorStop(1, 'rgba(120,255,180,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 1, 128);
    return c;
  }
  function aurora(km, t, still) {
    const a = clamp((km - 70) / 30, 0, 1);
    if (a <= 0) return;
    // The hem hangs at 100 km, or stands just off Earth's limb once the limb rises past it.
    const hem = Math.min(K.scene.yOf(100), (K.scene.earthTop || Infinity) + 2), crown = Math.min(K.scene.yOf(150), hem - H * 0.2);
    if (hem < -40 || crown > H + 40) return;
    if (!auroraSprite) auroraSprite = auroraColumn();
    const tt = still ? 0 : t;
    const span = hem - crown;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let x = 0; x < W; x += 4) {
      const fold = Math.sin(x / 110 + tt * 0.22) * 0.6 + Math.sin(x / 41 - tt * 0.37) * 0.4;
      const k = clamp(0.35 + 0.65 * Math.sin(x / 170 + 1.3 + tt * 0.13) * (0.75 + 0.25 * Math.sin(x / 23 + tt * 0.9)), 0, 1);
      if (k < 0.04) continue;
      const bottom = hem + fold * 10;
      const h = span * (0.62 + 0.38 * (0.5 + 0.5 * Math.sin(x / 67 + 0.7 - tt * 0.15)));
      ctx.globalAlpha = 0.55 * a * k;
      ctx.drawImage(auroraSprite, 0, 0, 1, 128, x, bottom - h, 4, h);
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
