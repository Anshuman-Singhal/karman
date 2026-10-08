/* ==========================================================================
   KÁRMÁN · audio.js
   All sound is synthesised with the Web Audio API, so there are no audio
   files to host. Browsers only allow sound after the player taps something,
   so the context is created on the first tap (Take off).

   Sound design rules (casual-game convention): short, musical, consonant,
   soft attacks, nothing louder than the take-off, and every cue in the same
   key (C major pentatonic) so sounds never clash with each other.

     takeoff  a soft burner roar under a warm C major (add 9) swell, one bell at lift
     whoosh   soft filtered air (hits, burn commit); intensity 0..1
     tick     tiny wooden tick for each key press
     hit      two-note chime, brighter for narrower widths; Pinpoint adds a third
     miss     a low, soft "bwoop" down
     stamp    a gentle bell for firsts and for space
     stage    the vehicle changing: seal (15 km), swap (21), ignite (45), separate (100)
   Players can mute from the top bar; the choice is saved.
   ========================================================================== */

K.audio = (() => {
  let ctx = null;
  let master = null;
  let verb = null;           // a short feedback delay that adds air and space
  let noiseBuf = null;

  const enabled = () => {
    const p = K.storage.data && K.storage.data.prefs;
    return !(p && p.sound === false);
  };

  /** Create the audio context. Must be called from a tap/click handler. */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    if (!enabled()) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    // Gentle compressor so stacked sounds never spike.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // Delay "room": 160 ms echoes at low feedback, lowpassed so they stay soft.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.16;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    verb = ctx.createGain();
    verb.gain.value = 0.35;
    verb.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    // Pink-ish noise (smoother than white, no hiss)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2) * 3;
    }
  }

  const ready = () => ctx && enabled() && ctx.state !== 'closed';

  function env(g, t0, attack, hold, release, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  /** A plucked note: triangle body + quiet sine octave, fast attack, soft tail. */
  function pluck(freq, t, peak = 0.14, decay = 0.55, wet = true) {
    const g = ctx.createGain();
    env(g, t, 0.008, 0.02, decay, peak);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(master);
    if (wet) g.connect(verb);
    [o1, o2].forEach((o) => { o.start(t); o.stop(t + decay + 0.1); });
  }

  /** Soft air: lowpassed pink noise with a slow swell. intensity 0..1 */
  function whoosh(intensity = 0.5, t = ctx && ctx.currentTime) {
    if (!ready()) return;
    const dur = 0.5 + intensity * 0.9;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(900 + intensity * 700, t + dur * 0.45);
    lp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = ctx.createGain();
    env(g, t, dur * 0.35, dur * 0.15, dur * 0.6, 0.05 + intensity * 0.12);
    src.connect(lp).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur * 1.2);
  }

  /** A burner: a soft roar of filtered air with a slow flutter, the sound of
      propane catching under an envelope, not a jet. */
  function burnerRoar(t, dur = 1.3, peak = 0.13) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(1150, t + 0.16);
    bp.frequency.exponentialRampToValueAtTime(520, t + dur);
    const g = ctx.createGain();
    env(g, t, 0.07, dur * 0.35, dur * 0.65, peak);
    // a gentle 9 Hz flutter: the flame breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = peak * 0.18;
    lfo.connect(depth).connect(g.gain);
    src.connect(bp).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
  }

  /** A warm pad note: two detuned triangles through the shared chord filter. */
  function padNote(freq, t, attack, hold, release, peak, out) {
    const g = ctx.createGain();
    env(g, t, attack, hold, release, peak);
    [-5, 5].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(g);
      o.start(t);
      o.stop(t + attack + hold + release + 0.1);
    });
    g.connect(out);
  }

  /** Take-off: the burner roars, and a warm C major (add 9) chord swells up
      under it, voiced low to high like a slow strum, then opens and fades as
      the balloon settles. One soft high note marks the moment of lift. */
  function takeoff() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.02;
    burnerRoar(t, 1.35, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.exponentialRampToValueAtTime(2300, t + 1.1);
    lp.frequency.exponentialRampToValueAtTime(900, t + 3.2);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    lp.connect(bus);
    bus.connect(master);
    bus.connect(verb);
    // C3 G3 C4 E4 G4 D5: open, warm, in the game's key
    [130.81, 196, 261.63, 329.63, 392, 587.33].forEach((f, i) =>
      padNote(f, t + 0.12 + i * 0.045, 0.6, 0.55, 1.9, [0.05, 0.04, 0.034, 0.03, 0.026, 0.016][i], lp));
    // the lift: one round, quiet bell an octave up (lands as the basket leaves the grass)
    pluck(783.99, t + 0.48, 0.05, 1.3);
    pluck(1046.5, t + 0.62, 0.035, 1.5);
  }

  /** Tiny wooden tick for key presses. */
  function tick() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.04);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.004, 0.05, 0.05);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Two-note chime, pitched by width (C5 … C6); Pinpoint adds a sparkle. */
  function hit(chipIdx = 2) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const base = [523.25, 587.33, 659.25, 783.99, 880][chipIdx];
    pluck(base, t, 0.12, 0.5);
    pluck(base * 1.5, t + 0.09, 0.1, 0.7);
    if (chipIdx === 4) pluck(base * 2, t + 0.18, 0.08, 0.9);
    whoosh(0.25, t + 0.05);
  }

  function miss() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(196, t + 0.22);
    const g = ctx.createGain();
    env(g, t, 0.01, 0.04, 0.3, 0.08);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  function stamp() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [1046.5, 1318.5, 1568].forEach((f, i) => pluck(f, t + i * 0.07, 0.06, 1.1 - i * 0.2));
  }

  /** A soft low thump with a pitch drop (hatches, latches). */
  function thunk(t, freq = 90, peak = 0.16) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    const g = ctx.createGain();
    env(g, t, 0.004, 0.02, 0.18, peak);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Short filtered noise burst (ignition, pyro pops). */
  function burst(t, dur, from, to, peak) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    env(g, t, 0.006, dur * 0.2, dur * 0.8, peak);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
  }

  /** The vehicle changes stage. All cues stay in the same key as the rest. */
  function stage(kind) {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    if (kind === 'seal') {            // hiss, then the hatch closes
      burst(t, 0.35, 3200, 900, 0.05);
      thunk(t + 0.32, 90, 0.18);
      pluck(1046.5, t + 0.34, 0.03, 0.15, false);
    } else if (kind === 'swap') {     // envelope released, latches click
      whoosh(0.6, t);
      pluck(1568, t + 0.5, 0.05, 0.12, false);
      pluck(1568, t + 0.56, 0.04, 0.12, false);
    } else if (kind === 'ignite') {   // a tink, a held breath, then fire
      pluck(2093, t, 0.05, 0.3, false);
      burst(t + 0.38, 0.9, 1800, 300, 0.2);
      thunk(t + 0.38, 65, 0.2);
    } else if (kind === 'separate') { // two pyro pops, then a bright chime
      burst(t, 0.06, 4000, 1500, 0.12);
      burst(t + 0.09, 0.06, 4000, 1500, 0.1);
      pluck(1318.5, t + 0.25, 0.08, 1.2);
      pluck(1975.5, t + 0.29, 0.06, 1.2);
    }
  }

  /* Kept for older call sites: a burner blast is just a stronger whoosh. */
  const burner = (intensity = 1) => whoosh(intensity);
  const puff = tick;

  function setEnabled(on) {
    K.storage.data.prefs = { ...(K.storage.data.prefs || {}), sound: on };
    K.storage.save();
    if (on) unlock();
  }

  return { unlock, takeoff, whoosh, burner, tick, puff, hit, miss, stamp, stage, enabled, setEnabled };
})();
