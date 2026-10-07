/* ==========================================================================
   KÁRMÁN · fx.js
   Game-feel toolkit, all visual (no audio):
     particles   embers, sparks and glints on a full-screen canvas
     Odometer    rolling-digit altitude readout
     banner      milestone announcements that unfurl over the sky
     floatText   "+5.6 km" labels that rise and fade
     ringBurst   expanding light ring for Pinpoint hits
     hitstop     a short global freeze on impact
     nudge       a 4px camera bump
     toast       small status messages
   Everything respects prefers-reduced-motion.
   ========================================================================== */

K.fx = (() => {
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches || document.documentElement.classList.contains('calm');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------------- particles */
  let canvas, ctx, dpr = 1;
  let parts = [];
  let running = false;
  let lastT = 0;

  function initParticles(el) {
    canvas = el;
    ctx = el.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function spawn(p) {
    parts.push(p);
    if (!running) {
      running = true;
      lastT = 0;
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
    lastT = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';

    for (const p of parts) {
      if (!hitstopActive) {
        p.life -= dt;
        p.vy += p.g * dt;
        p.vx *= 1 - p.drag * dt;
        p.vy *= 1 - p.drag * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      const a = Math.max(0, p.life / p.max);
      const r = p.size * (0.35 + 0.65 * a);
      ctx.globalAlpha = a * 0.22;              // soft glow
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, a * 1.4);  // hot core
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    parts = parts.filter((p) => p.life > 0);

    if (parts.length) requestAnimationFrame(tick);
    else {
      running = false;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  /** Rising embers, e.g. from the burner or a hit range. */
  function embers(x, y, opts = {}) {
    if (reduced()) return;
    const { count = 26, color = '#FFB547', spread = 1.1, speed = 230, size = 2.4, life = 1.2, g = -30 } = opts;
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * spread * Math.PI;
      const v = speed * (0.35 + Math.random() * 0.85);
      const l = life * (0.6 + Math.random() * 0.6);
      spawn({ x: x + (Math.random() - 0.5) * 14, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        g, drag: 1.6, size: size * (0.6 + Math.random() * 0.8), life: l, max: l, color });
    }
  }

  /** A full ring of sparks that fall with gravity (Pinpoint, Kármán line). */
  function sparks(x, y, opts = {}) {
    if (reduced()) return;
    const { count = 40, color = '#FFD27A', speed = 340, size = 2, life = 1.1 } = opts;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const v = speed * (0.55 + Math.random() * 0.6);
      const l = life * (0.7 + Math.random() * 0.5);
      spawn({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, g: 420, drag: 2.2,
        size: size * (0.7 + Math.random() * 0.7), life: l, max: l, color });
    }
  }

  /* ---------------------------------------------------------------- odometer */
  /** Rolling digits. Call set('41.3'); digits roll, other characters swap. */
  class Odometer {
    constructor(el) {
      this.el = el;
      this.value = '';
    }

    build(str) {
      this.el.textContent = '';
      this.strips = [];
      for (const ch of str) {
        if (/\d/.test(ch)) {
          const col = document.createElement('span');
          col.className = 'odo-col';
          const strip = document.createElement('span');
          strip.className = 'odo-strip';
          for (let d = 0; d <= 9; d++) {
            const s = document.createElement('span');
            s.textContent = d;
            strip.appendChild(s);
          }
          col.appendChild(strip);
          this.el.appendChild(col);
          this.strips.push(strip);
        } else {
          const s = document.createElement('span');
          s.className = 'odo-sep';
          s.textContent = ch;
          this.el.appendChild(s);
          this.strips.push(null);
        }
      }
    }

    set(str, { instant = false } = {}) {
      const rebuilt = str.length !== this.value.length;
      if (rebuilt) this.build(str);
      const apply = () => {
        [...str].forEach((ch, i) => {
          const strip = this.strips[i];
          if (!strip) return;
          strip.style.transition = instant || reduced() ? 'none' : '';
          strip.style.transitionDelay = `${(str.length - 1 - i) * 55}ms`;
          strip.style.transform = `translateY(${-Number(ch)}em)`;
        });
      };
      // On a rebuild, let the strips paint at 0 first so they roll up.
      if (rebuilt && !instant) requestAnimationFrame(() => requestAnimationFrame(apply));
      else apply();
      this.value = str;
    }
  }

  /* ---------------------------------------------------------------- banner */
  let bannerEl;
  const bannerQueue = [];
  let bannerBusy = false;

  function banner(spec) {
    bannerQueue.push(spec);
    if (!bannerBusy) nextBanner();
  }

  async function nextBanner() {
    const spec = bannerQueue.shift();
    if (!spec) { bannerBusy = false; return; }
    bannerBusy = true;
    bannerEl.className = `banner ${spec.tone || ''}`;
    bannerEl.innerHTML = '';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'banner-eyebrow';
    eyebrow.textContent = spec.eyebrow || 'Milestone';
    const title = document.createElement('span');
    title.className = 'banner-title';
    title.textContent = spec.title;
    const meta = document.createElement('span');
    meta.className = 'banner-meta';
    meta.textContent = spec.meta || '';
    bannerEl.append(eyebrow, title, meta);
    void bannerEl.offsetWidth; // restart the CSS animation
    bannerEl.classList.add('show');
    await sleep(spec.hold || 2100);
    bannerEl.classList.remove('show');
    bannerEl.classList.add('leave');
    await sleep(420);
    nextBanner();
  }

  /** Drop queued banners and fade the current one (e.g. when results open). */
  function clearBanners() {
    bannerQueue.length = 0;
    if (bannerEl && bannerEl.classList.contains('show')) {
      bannerEl.classList.remove('show');
      bannerEl.classList.add('leave');
    }
  }

  /* ---------------------------------------------------------------- one-shots */
  function floatText(x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (color) el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  function ringBurst(x, y, color = '#FFD27A') {
    if (reduced()) return;
    const el = document.createElement('div');
    el.className = 'ring-burst';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--ring', color);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  let hitstopActive = false;
  /** Freeze CSS animations and the particle sim for a beat on impact. */
  async function hitstop(ms) {
    if (reduced()) return;
    hitstopActive = true;
    document.documentElement.classList.add('hitstop');
    await sleep(ms);
    document.documentElement.classList.remove('hitstop');
    hitstopActive = false;
  }

  function nudge() {
    if (reduced()) return;
    const app = document.getElementById('app');
    app.classList.remove('nudge');
    void app.offsetWidth;
    app.classList.add('nudge');
  }

  function haptic(ms = 8) {
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    try { if (navigator.vibrate && active) navigator.vibrate(ms); } catch (e) { /* not allowed here */ }
  }

  let toastEl, toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function init() {
    initParticles(document.getElementById('fx'));
    bannerEl = document.getElementById('banner');
    toastEl = document.getElementById('toast');
  }

  return {
    init, reduced, sleep,
    embers, sparks, Odometer, banner, clearBanners, floatText, ringBurst,
    hitstop, nudge, haptic, toast,
    get frozen() { return hitstopActive; },
  };
})();
