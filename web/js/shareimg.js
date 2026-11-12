/* ==========================================================================
   KÁRMÁN · shareimg.js
   Draws the shareable flight log as a 1080×1350 PNG "boarding pass":

     ┌───────────────────────────────┐
     │ KÁRMÁN            FLIGHT #12  │  sky at your final altitude
     │ │                             │
     │ │ 🎈      413                 │  rail with your balloon · big score
     │ │        41.3 km · Strato…    │
     │ │        ● ● ● ○ ●            │  one dot per leg: risk taken + hit/miss
     │ │        Higher than 72%…     │
     ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  perforation
     │ FROM GROUND → TO STRATOSPHERE │  cream stub
     └───────────────────────────────┘

   Like the text log, it never reveals an answer. Drawn with plain canvas
   shapes (no emoji) so it looks the same on every device.
   ========================================================================== */

K.shareImage = (() => {
  const S = K.scoring;
  const W = 1080, H = 1350;
  const STUB_Y = 1040;             // where the perforation runs
  const NAVY = '#14213D', CREAM = '#F3E8D4', AMBER = '#FFB547';
  const CHIP_COLORS = ['#DDE2EC', '#6CA9FF', '#5BD49A', '#F4CF4A', '#FF5E62'];
  const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
  const UI = '"Instrument Sans", system-ui, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';

  /* A small seeded random so the star field is the same for a given flight. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sky(ctx, km, n) {
    const [top, mid, bot] = K.scene.skyAt(km);
    const g = ctx.createLinearGradient(0, 0, 0, STUB_Y);
    g.addColorStop(0, top);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, STUB_Y);

    // Stars fade in above 40 km, fully out by 80.
    const starA = Math.min(1, Math.max(0, (km - 40) / 40));
    if (starA > 0) {
      const r = rng(n * 7919);
      for (let i = 0; i < 140; i++) {
        const x = r() * W, y = r() * STUB_Y * 0.8, s = r();
        ctx.globalAlpha = starA * (0.25 + s * 0.75) * (1 - y / (STUB_Y * 0.9));
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + s * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Earth's limb: a thin bright curve low in the frame once you are high.
    if (km >= 20) {
      const a = Math.min(1, (km - 20) / 60);
      const cx = W / 2, rad = 2700, cy = STUB_Y + rad - 40 - a * 120; // limb crest sits low, under the score
      const limb = ctx.createRadialGradient(cx, cy, rad - 40, cx, cy, rad + 70);
      limb.addColorStop(0, 'rgba(120,180,255,0)');
      limb.addColorStop(0.45, `rgba(150,205,255,${0.55 * a})`);
      limb.addColorStop(0.6, `rgba(255,190,140,${0.25 * a})`);
      limb.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = limb;
      ctx.fillRect(0, 0, W, STUB_Y);
    }

    // Soft vignette so white type reads on any sky.
    const v = ctx.createLinearGradient(0, 0, 0, STUB_Y);
    v.addColorStop(0, 'rgba(6,8,20,0.35)');
    v.addColorStop(0.5, 'rgba(6,8,20,0.15)');
    v.addColorStop(1, 'rgba(6,8,20,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, STUB_Y);
  }

  /* Altitude rail on the left, log-scaled like the game camera. */
  const RAIL = { x: 120, top: 210, bottom: 940 };
  const railY = (km) => RAIL.bottom - K.scene.fOf(Math.min(km, 120)) / K.scene.fOf(120) * (RAIL.bottom - RAIL.top);

  function rail(ctx, km, hide) {
    const youY = railY(km);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(RAIL.x, RAIL.top);
    ctx.lineTo(RAIL.x, RAIL.bottom);
    ctx.stroke();
    // The part you climbed, in amber.
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(RAIL.x, RAIL.bottom);
    ctx.lineTo(RAIL.x, railY(km));
    ctx.stroke();

    ctx.font = `500 22px ${MONO}`;
    ctx.textBaseline = 'middle';
    S.MILESTONES.forEach((m) => {
      if (m.id === 'stratopause' || m.id === 'everest') return; // keep the rail uncluttered
      const y = railY(m.km);
      if (hide && y > hide[0] && y < hide[1]) {
        if (m.id === 'karman' && Math.abs(y - youY) > 34) { ctx.globalAlpha = 0.9; ctx.fillStyle = AMBER; ctx.textAlign = 'left'; ctx.fillText('100', RAIL.x + 70, y); ctx.globalAlpha = 1; }
        return; // other ticks tucked behind the balloon stay hidden
      }
      const passed = km >= m.km;
      ctx.fillStyle = passed ? AMBER : 'rgba(255,255,255,0.45)';
      ctx.fillRect(RAIL.x - 12, y - 1.5, 24, 3);
      ctx.globalAlpha = passed ? 0.9 : 0.5;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      ctx.fillText(m.km >= 10 ? String(Math.round(m.km)) : m.km.toFixed(m.km % 1 ? 1 : 0), RAIL.x - 24, y);
      ctx.globalAlpha = 1;
    });
    ctx.font = `500 18px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText('KM', RAIL.x - 24, RAIL.top - 34);
  }

  /** You are here: an amber tick across the rail at the true altitude, and a
      small pill with the number, so the craft art never reads as a higher flight. */
  function youAreHere(ctx, km) {
    const y = railY(km);
    const label = K.units.altNum(km, 0);
    ctx.save();
    ctx.fillStyle = AMBER;
    ctx.shadowColor = 'rgba(255,181,71,0.7)';
    ctx.shadowBlur = 12;
    ctx.fillRect(RAIL.x - 18, y - 2.5, 36, 5);
    ctx.shadowBlur = 0;
    ctx.font = `800 32px ${DISPLAY}`;
    const w = ctx.measureText(label).width + 22, h = 40, x = RAIL.x + 44;
    roundRect(ctx, x, y - h / 2, w, h, 9);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(20,33,61,0.85)';
    ctx.stroke();
    ctx.fillStyle = NAVY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 11, y + 2);
    ctx.restore();
  }

  /* The craft: the live vehicle SVG (already at your final altitude's
     stage), serialised and drawn as an image so the share card always
     matches what you saw. Falls back to nothing if the browser refuses. */
  function vehicleImage() {
    const src = document.getElementById('balloon');
    if (!src) return Promise.resolve(null);
    const clone = src.cloneNode(true);
    clone.removeAttribute('class');
    clone.removeAttribute('style');
    clone.setAttribute('width', '400');
    clone.setAttribute('height', '500');
    const xml = new XMLSerializer().serializeToString(clone);
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Leg tokens: colour = the width you chose, filled = it landed. */
  function legs(ctx, record, x0, y) {
    const gap = 98, r = 34;
    record.rounds.forEach((rd, i) => {
      const x = x0 + i * gap + r;
      const c = CHIP_COLORS[rd.chip] || '#8B93A7';
      ctx.lineWidth = 5;
      if (rd.hit) {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.setLineDash([8, 9]);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = `800 36px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rd.hit ? NAVY : 'rgba(255,255,255,0.55)';
      ctx.fillText(String(i + 1), x, y + 2);
    });
    ctx.font = `500 27px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const hits = record.rounds.filter((r) => r.hit).length;
    const clue = record.rounds.some((r) => r.clue) ? ' · 1 CLUE' : '';
    ctx.fillText(`${hits}/${record.rounds.length} LEGS LANDED${clue}`, x0, y + r + 46);
  }

  /* First class: the two-colour seal from the welcome card, stamped on the
     stub. Ring, disc, ∞ and stars come from K.ui.fcSeal as an SVG image; the
     arc lettering is set here glyph by glyph, because text inside an SVG
     image can't reach the page's web fonts. Resolves to a canvas, or null. */
  const SEAL = { x: 934, y: 1132, px: 160, deg: -12 };
  function arcText(ctx, str, r, font, spacing, top) {
    ctx.font = font;
    const ws = [...str].map((c) => ctx.measureText(c).width + spacing);
    const total = ws.reduce((a, b) => a + b, 0) - spacing;
    let a = top ? -Math.PI / 2 - total / r / 2 : Math.PI / 2 + total / r / 2;
    ctx.textAlign = 'center';
    [...str].forEach((c, i) => {
      const half = (ws[i] - spacing) / 2 / r;
      const mid = top ? a + half : a - half;
      ctx.save();
      ctx.rotate(top ? mid + Math.PI / 2 : mid - Math.PI / 2);
      ctx.textBaseline = top ? 'alphabetic' : 'top';
      ctx.fillText(c, 0, top ? -r : r);
      ctx.restore();
      a += (top ? 1 : -1) * ws[i] / r;
    });
  }
  async function seal(px) {
    if (!K.ui || !K.ui.fcSeal) return null;
    const svg = K.ui.fcSeal(px, true);
    const img = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    if (!img) return null;
    const k = px / 120;
    const off = document.createElement('canvas');
    off.width = off.height = px;
    const o = off.getContext('2d');
    o.drawImage(img, 0, 0, px, px);
    o.save();
    o.translate(px / 2, px / 2);
    o.fillStyle = NAVY;
    arcText(o, 'FIRST CLASS', 40 * k, `800 ${14.6 * k}px ${DISPLAY}`, 1.7 * k, true);
    arcText(o, 'UNLIMITED', 47.8 * k - 8.6 * k * 0.95, `500 ${8.6 * k}px ${MONO}`, 1.9 * k, false);
    o.restore();
    // Worn ink: a scatter of pinholes knocked out of everything, the same on every card.
    o.globalCompositeOperation = 'destination-out';
    const r = rng(7);
    for (let i = 0; i < px * 5; i++) {
      o.globalAlpha = 0.25 + r() * 0.6;
      o.beginPath(); o.arc(r() * px, r() * px, 0.4 + (r() * 1.4 * k) / 2, 0, Math.PI * 2); o.fill();
    }
    return off;
  }

  function stub(ctx, record, n, streak, fcSeal) {
    // Cream paper with two half-circle notches at the perforation.
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, STUB_Y, W, H - STUB_Y);
    // Notches are painted night-navy rather than cut out, so the image never
    // shows transparent (often black or checkered) holes in chat apps.
    ctx.fillStyle = '#0A0D1C';
    [0, W].forEach((x) => { ctx.beginPath(); ctx.arc(x, STUB_Y, 34, 0, Math.PI * 2); ctx.fill(); });
    ctx.strokeStyle = 'rgba(20,33,61,0.45)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(56, STUB_Y + 2); ctx.lineTo(W - 56, STUB_Y + 2); ctx.stroke();
    ctx.setLineDash([]);

    const layer = S.tierName(record.alt).toUpperCase();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(20,33,61,0.55)';
    ctx.font = `500 22px ${MONO}`;
    ctx.fillText('FROM', 80, STUB_Y + 92);
    ctx.fillText('TO', 470, STUB_Y + 92);
    ctx.fillStyle = NAVY;
    ctx.font = `800 64px ${DISPLAY}`;
    ctx.fillText('GROUND', 80, STUB_Y + 160);
    ctx.font = `800 80px ${DISPLAY}`;
    // With the seal in the corner, the layer name stops short of it.
    const layerW = fcSeal ? SEAL.x - SEAL.px / 2 - 24 - 470 : W - 470 - 80;
    ctx.fillText(fit(ctx, layer, layerW, 80), 470, STUB_Y + 166, layerW);   // maxWidth: never past its room
    // Arrow
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(330, STUB_Y + 138); ctx.lineTo(420, STUB_Y + 138);
    ctx.moveTo(405, STUB_Y + 124); ctx.lineTo(420, STUB_Y + 138); ctx.lineTo(405, STUB_Y + 152);
    ctx.stroke();

    // The foot: the day's sky and date ("CLEAR DAWN · 26 OCT"), so each day's
    // card is its own postcard, then the streak.
    ctx.font = `800 40px ${DISPLAY}`;
    const urlW = ctx.measureText(K.CONFIG.SHARE_URL.toUpperCase()).width;
    const foot = [];
    const wx = skyOf(record, n);
    if (wx) foot.push(wx.toUpperCase());
    if (record.mode !== 'unlimited') foot.push(K.date.dateOfFlight(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase());
    if (streak > 1) foot.push(`${streak}-DAY STREAK`);
    if (!foot.length) foot.push('ONE FLIGHT A DAY');
    const footTxt = foot.join(' · ');
    let size = 24;
    ctx.font = `500 ${size}px ${MONO}`;
    while (ctx.measureText(footTxt).width > W - 160 - urlW - 40 && size > 16) { size -= 1; ctx.font = `500 ${size}px ${MONO}`; }
    ctx.fillStyle = 'rgba(20,33,61,0.7)';
    ctx.fillText(footTxt, 80, STUB_Y + 250);
    ctx.textAlign = 'right';
    ctx.fillStyle = NAVY;
    ctx.font = `800 40px ${DISPLAY}`;
    ctx.fillText(K.CONFIG.SHARE_URL.toUpperCase(), W - 80, STUB_Y + 252);

    if (fcSeal) {
      ctx.save();
      ctx.translate(SEAL.x, SEAL.y);
      ctx.rotate((SEAL.deg * Math.PI) / 180);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.94;
      ctx.drawImage(fcSeal, -SEAL.px / 2, -SEAL.px / 2);
      ctx.restore();
    }
  }

  /** The sky the flight was flown under (daily weather, or the Unlimited run's). */
  function skyOf(record, n) {
    try {
      const w = record.mode === 'unlimited' ? K.daily.weatherFor(1000 + (record.run || 1)) : (K.daily.get(n) || {}).weather || K.daily.weatherFor(Math.max(1, n));
      return w && w.name ? w.name : '';
    } catch (e) { return ''; }
  }

  /** Shrink a line of text until it fits. */
  function fit(ctx, str, maxW, start = 64) {
    let size = start;
    while (ctx.measureText(str).width > maxW && size > 30) {
      size -= 4;
      ctx.font = `800 ${size}px ${DISPLAY}`;
    }
    return str;
  }

  /** Render the card for a finished flight. Resolves to a PNG Blob. */
  async function render(record, n, streak, stats) {
    try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const karman = record.alt >= K.CONFIG.KARMAN_KM;

    sky(ctx, record.alt, n);
    const by = Math.max(RAIL.top + 170, railY(record.alt) + 50);
    rail(ctx, record.alt, [by - 230, by + 10]);
    const craft = await vehicleImage();
    if (craft) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 24;
      ctx.drawImage(craft, RAIL.x + 2 - 96, by - 240, 192, 240);
      ctx.restore();
    }
    youAreHere(ctx, record.alt);

    // Header
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 58px ${DISPLAY}`;
    ctx.fillText('KÁRMÁN', 80, 120);
    ctx.textAlign = 'right';
    ctx.font = `500 26px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(record.mode === 'unlimited' ? 'UNLIMITED' : `FLIGHT #${n}`, W - 80, 104);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 22px ${MONO}`;
    const d = K.date.dateOfFlight(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    ctx.fillText(d, W - 80, 138);

    // Score block
    const x0 = 300;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `500 24px ${MONO}`;
    ctx.fillText('ALTITUDE', x0 + 6, 330);
    ctx.fillStyle = AMBER;
    ctx.font = `800 260px ${DISPLAY}`;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24;
    ctx.fillText(K.units.altNum(record.alt, 0), x0, 560);
    ctx.font = `800 96px ${DISPLAY}`;
    ctx.fillText(K.units.altUnit(), x0 + ctx.measureText(K.units.altNum(record.alt, 0)).width * 2.7 + 18, 560);
    ctx.restore();
    // "Stratosphere  55 km to space": the layer, then the gap a friend can close.
    const tier = S.tierName(record.alt);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 44px ${UI}`;
    ctx.fillText(tier, x0 + 6, 640);
    const tierW = ctx.measureText(tier).width;
    const left = K.CONFIG.KARMAN_KM - record.alt;
    const gap = karman ? 'past the Kármán line' : `${K.units.altText(left, { decimals: left < 1 ? 1 : 0 })} to space`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    let gs = 46;
    ctx.font = `italic 400 ${gs}px "Instrument Serif", Georgia, serif`;
    while (x0 + 24 + tierW + ctx.measureText(gap).width > W - 60 && gs > 30) { gs -= 2; ctx.font = `italic 400 ${gs}px "Instrument Serif", Georgia, serif`; }
    ctx.fillText(gap, x0 + 6 + tierW + 18, 640);

    legs(ctx, record, x0, 760);

    if (stats && stats.players > 1 && !stats.sample && record.pts > 0) {
      const pct = K.stats.percentile(stats, record.pts);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `500 34px ${UI}`;
      ctx.fillText(`Higher than ${pct}% of today's pilots`, x0 + 6, 930);
    }

    let fc = null;
    if (K.access && K.access.unlimited()) { try { fc = await seal(SEAL.px); } catch (e) { fc = null; } }
    stub(ctx, record, n, streak, fc);

    return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
  }

  /* ---------------------------------------------------------- passport card
     The passport page as a 1080×1350 image: every milestone, inked in its
     tier colour, ghosts for the ones still ahead. */
  const INKS = ['#2B3F7A', '#A0602A', '#6E7A90', '#B8861E', '#55525F'];
  function iconImage(id, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${K.ui.ICONS[id]}</svg>`;
    return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  }

  async function passport() {
    try { await document.fonts.ready; } catch (e) { /* optional */ }
    const data = K.storage.data;
    const counts = data.stampCounts || {};
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0B1030'); bg.addColorStop(1, '#141C48');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // the page
    const px = 70, py = 90, pw = W - 140, ph = H - 180;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.008); ctx.translate(-W / 2, -H / 2);
    ctx.fillStyle = CREAM; roundRect(ctx, px, py, pw, ph, 28); ctx.fill();
    ctx.setLineDash([10, 9]); ctx.strokeStyle = 'rgba(30,42,85,0.2)'; ctx.lineWidth = 2;
    roundRect(ctx, px + 22, py + 22, pw - 44, ph - 44, 18); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = NAVY; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = `800 84px ${DISPLAY}`; ctx.fillText('KÁRMÁN PASSPORT', px + 70, py + 150);
    ctx.font = `500 26px ${MONO}`; ctx.fillStyle = 'rgba(20,33,61,0.65)';
    const got = S.MILESTONES.filter((m) => counts[m.id]).length;
    ctx.fillText(`PILOT Nº ${K.ui.pilotNo()} · VISAS ${got} / ${S.MILESTONES.length}`, px + 72, py + 200);
    ctx.fillStyle = '#FF6A3D'; ctx.fillRect(px + 70, py + 225, pw - 140, 4);
    // stamps: 3 per row
    const cols = 3, cw = (pw - 140) / cols, top = py + 280, rh = 272;
    for (let i = 0; i < S.MILESTONES.length; i++) {
      const m = S.MILESTONES[i];
      const c = counts[m.id] || 0;
      const col = i === 6 ? 1 : i % cols;               // the Kármán line sits centred on its own row
      const cx = px + 70 + cw * col + cw / 2, cy = top + rh * Math.floor(i / cols) + 80;
      const tier = S.tierIndex(c);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(c ? (((i * 37) % 17) - 8) * Math.PI / 180 : 0);
      if (c) {
        const ink = INKS[tier - 1];
        ctx.strokeStyle = ink; ctx.globalAlpha = 0.9;
        ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 82, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.stroke();
        const im = await iconImage(m.id, ink);
        if (im) ctx.drawImage(im, -34, -50, 68, 68);
        ctx.fillStyle = ink; ctx.font = `700 19px ${UI}`; ctx.textAlign = 'center';
        ctx.fillText(m.short.toUpperCase(), 0, 44);
      } else {
        ctx.setLineDash([3, 7]); ctx.strokeStyle = 'rgba(30,42,85,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(30,42,85,0.4)'; ctx.font = `800 40px ${DISPLAY}`; ctx.textAlign = 'center';
        ctx.fillText(m.km % 1 ? m.km.toFixed(1) : String(m.km), 0, 10);
        ctx.font = `500 16px ${MONO}`; ctx.fillText('KM', 0, 36);
      }
      ctx.restore();
      ctx.globalAlpha = 1; ctx.fillStyle = c ? NAVY : 'rgba(20,33,61,0.4)'; ctx.textAlign = 'center';
      ctx.font = `600 24px ${UI}`; ctx.fillText(m.name, cx, cy + 128);
      if (c) { ctx.font = `500 18px ${MONO}`; ctx.fillStyle = 'rgba(20,33,61,0.55)'; ctx.fillText(`× ${c} · ${S.STAMP_TIERS[tier - 1].name.toUpperCase()}`, cx, cy + 156); }
    }
    // footer
    ctx.textAlign = 'left'; ctx.font = `500 22px ${MONO}`; ctx.fillStyle = 'rgba(20,33,61,0.6)';
    ctx.fillText(`${data.stats.flights} FLIGHTS · BEST ${(data.stats.bestAlt || 0).toFixed(1)} KM`, px + 72, py + ph - 70);
    ctx.textAlign = 'right'; ctx.fillStyle = NAVY; ctx.font = `800 38px ${DISPLAY}`;
    ctx.fillText(K.CONFIG.SHARE_URL.toUpperCase(), px + pw - 72, py + ph - 66);
    ctx.restore();
    return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
  }

  return { render, passport };
})();
