/* ==========================================================================
   KÁRMÁN · game.js
   The flight itself: a small state machine plus the choreography of each
   reveal. Rules come from scoring.js, pictures from scene/round/ui.

   PHASES (saved in storage.live.phase after every action):
     home → round → reveal → round → … → reveal → results   (LEGS rounds)
   Reloading mid-flight resumes the same phase. The round timer keeps counting
   from the saved start time, so a reload never buys extra time.

   SCORE: points are the source of truth (live.pts, record.pts). Altitude is
   derived: km = points × ≈143 m (scoring.kmOf), so 700 points is space.
   ========================================================================== */

K.game = (() => {
  const C = K.CONFIG;
  const S = K.scoring;
  /* Particle colours (canvas can't read CSS variables). Order matches CHIPS. */
  const CHIP_HEX = ['#DDE2EC', '#6CA9FF', '#5BD49A', '#F4CF4A', '#FF5E62'];

  let store = null;     // the whole save (storage.js)
  let n = 0;            // flight number on screen
  let flight = null;    // { n, facts, weather, starts }
  let live = null;      // flight in progress (also store.live)
  let busy = false;     // true while a reveal is animating
  let devFlight = null; // dev strip override
  let mode = 'daily';   // 'daily' | 'archive' (a past day) | 'unlimited' (7 random questions)
  let today = 0;        // today's flight number (Eastern)
  let timerRaf = 0, countdownTimer = 0, saveTimer = 0, emberGate = 0;
  const factIndex = new Map();

  const save = () => K.storage.save();
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); };

  /* ------------------------------------------------------------ streaks */
  /** Streak as it stands today, counting thermals that would cover gaps. */
  function streakNow() {
    const s = store.streak;
    if (s.lastDay == null) return { cur: 0, thermals: s.thermals };
    if (s.lastDay >= n) return { cur: s.cur, thermals: s.thermals };
    const missed = n - s.lastDay - 1;
    return { cur: missed <= s.thermals ? s.cur : 0, thermals: s.thermals };
  }

  /** Record a finished flight on the streak. Returns what happened. */
  function applyStreak(day) {
    const s = store.streak;
    const info = { carried: 0, earnedThermal: false };
    if (s.lastDay === day) return info;
    const missed = s.lastDay == null ? null : day - s.lastDay - 1;
    if (missed === 0) s.cur += 1;
    else if (missed != null && missed > 0 && missed <= s.thermals) {
      s.thermals -= missed;
      info.carried = missed;
      s.cur += 1;
    } else s.cur = 1;
    s.lastDay = Math.max(day, s.lastDay || 0);
    s.best = Math.max(s.best, s.cur);
    if (s.cur % C.THERMAL_EVERY === 0 && s.thermals < C.THERMAL_MAX) {
      s.thermals += 1;
      info.earnedThermal = true;
    }
    return info;
  }

  function refreshTopbar() {
    K.ui.topbar({ n, mode, streak: streakNow().cur });
  }

  /* ------------------------------------------------------------ unlimited
     Seven questions dealt at random from the Unlimited pool (past dailies +
     bank-only questions), never repeating a question this player has seen
     until the whole pool has been used. At most two per category. */
  function dealUnlimited() {
    const pool = K.daily.unlimitedPool(today);
    const seen = new Set(store.seen);
    let fresh = pool.filter((f) => !seen.has(f.id));
    if (fresh.length < C.LEGS) {                // seen it all: start the cycle again
      store.seen = [];
      fresh = pool.slice();
    }
    for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]]; }
    const picked = [], perCat = {};
    for (const f of fresh) {
      if (picked.length === C.LEGS) break;
      if ((perCat[f.cat] || 0) >= 2) continue;
      picked.push(f); perCat[f.cat] = (perCat[f.cat] || 0) + 1;
    }
    for (const f of fresh) { if (picked.length === C.LEGS) break; if (!picked.includes(f)) picked.push(f); }
    return picked.length === C.LEGS ? picked : null;
  }

  function unlimitedFlight(ids, runNo) {
    const facts = ids ? ids.map((id) => factIndex.get(id)).filter(Boolean) : dealUnlimited();
    if (!facts || facts.length !== C.LEGS) return null;
    const run = runNo || (store.runs.length || 0) + 1;
    return { n: today, facts, weather: K.daily.weatherFor(1000 + run), run, flightNo: (store.unlimitedCount || 0) + 1 };
  }

  /** Which in-progress slot a flight lives in: today's/an archive day by number, Unlimited as one. */
  function slotKey(m, num) { return m === 'unlimited' ? 'unlimited' : `${m}:${num}`; }

  /* ------------------------------------------------------------ boot */
  function boot(opts = {}) {
    if ('flight' in opts) devFlight = opts.flight;
    stopTimer();
    busy = false;
    store = K.storage.load();
    today = devFlight != null ? devFlight : K.date.flightNumber();
    // Which flight? The one asked for, else a non-daily flight left in progress, else today.
    const inProgress = store.live && store.live.mode && store.live.mode !== 'daily' ? store.live : null;
    mode = opts.mode || (inProgress ? inProgress.mode : 'daily');
    n = mode === 'archive' ? (opts.n != null ? opts.n : inProgress.n) : today;
    // One flight per mode can be in progress. Leaving one for another (menu → Unlimited
    // mid-leg) parks it; coming back unparks it, clock still counting from where it was.
    const want = slotKey(mode, n);
    if (store.live && slotKey(store.live.mode || 'daily', store.live.n) !== want) {
      store.parked = { ...(store.parked || {}), [slotKey(store.live.mode || 'daily', store.live.n)]: store.live };
      store.live = null;
    }
    if (!store.live && store.parked && store.parked[want] && !(mode === 'unlimited' && opts.fresh)) {
      store.live = store.parked[want];
      delete store.parked[want];
    }
    if (mode === 'unlimited' && opts.fresh && store.parked) delete store.parked.unlimited;
    save();
    if (mode === 'unlimited') {
      // Unlimited runs are fixed and numbered (Run 1 = the free run), the same for
      // every pilot, so each run has its own crowd chart. Paid pilots go 2, 3, 4…
      const resuming = !opts.fresh && store.live && store.live.mode === 'unlimited' ? store.live : null;
      const runs = K.SCHEDULE.runs || (K.SCHEDULE.freeRun ? [K.SCHEDULE.freeRun] : []);
      // Free pilots fly Run 1; paid pilots get a random run they haven't flown,
      // and only once they've flown them all does the deck reshuffle.
      let run = resuming ? resuming.run : 1;
      if (!resuming && K.access.unlimited()) {
        const done = new Set(store.runsDone || []);
        let left = runs.map((_, i) => i + 1).filter((k) => !done.has(k));
        if (!left.length) { store.runsDone = []; left = runs.map((_, i) => i + 1); }
        run = left[Math.floor(Math.random() * left.length)];
      }
      let ids = resuming ? resuming.factIds : runs[run - 1] || null;
      if (resuming && !run) run = Math.max(1, runs.findIndex((r) => r.join() === ids.join()) + 1);
      flight = ids ? unlimitedFlight(ids, run) : null;
      if (!flight) { mode = 'daily'; flight = K.daily.get(n); K.fx.toast('You’ve flown every Unlimited run. New runs land every Monday.'); }
    } else flight = K.daily.get(n);
    live = store.live && (store.live.mode || 'daily') === mode && (mode === 'unlimited' || store.live.n === n) ? store.live : null;
    const done = mode !== 'unlimited' && store.days[n] && store.days[n].done ? store.days[n] : null;
    const startPts = done ? done.pts : live ? live.pts : 0;
    const startKm = S.kmOf(startPts);

    S.useRules(S.rulesFor(mode, n));   // flights before RULES2_FROM keep the ranges they were flown with
    if (K.climb) K.climb.close({ instant: true, restore: false });   // a replay left open never carries into the next flight
    K.scene.reset({
      weather: flight ? flight.weather : K.daily.weatherFor(Math.max(1, n)),
      km: startKm,
      flying: Boolean(done || live),
      pbKm: done ? 0 : store.stats.bestAlt,
      stamps: store.stamps,
    });
    K.ui.setAltitude(startPts, { instant: true });
    refreshTopbar();
    K.ui.dev({
      n,
      onFlight: (m) => boot({ flight: Math.max(1, m) }),
      onWipe: () => { K.storage.wipe(); boot({ flight: devFlight }); K.fx.toast('Save wiped'); },
    });
    startCountdown();

    if (!flight) {
      K.ui.closed({ kind: n < 1 ? 'prelaunch' : 'restock', n });
      K.ui.show('closed');
      return;
    }
    if (done) return showResults(done, false);
    if (live) return resume();
    showHome();
  }

  function showHome() {
    const st = streakNow();
    K.ui.home({ flight, mode, streak: st.cur, thermals: st.thermals, bestAlt: store.stats.bestAlt });
    K.ui.show('home');
    // How to fly opens only when tapped; the guided first leg teaches new pilots.
  }

  /* ------------------------------------------------------------ launch */
  /** Hold-to-launch progress: burner roars, sparks start to fly. */
  function inflate(p) {
    K.scene.inflate(p);
    const now = performance.now();
    if (p > 0.25 && now - emberGate > 90) {
      emberGate = now;
      const pt = K.scene.point('burner');
      K.fx.embers(pt.x, pt.y, { count: Math.round(3 + p * 6), speed: 120 + p * 140, life: 0.7 });
    }
  }

  /** Single tap: the burner roars, the envelope swells, and the balloon
      leaves the ground in one long climb before the first question. */
  async function launch() {
    if (live) return;
    K.audio.unlock();          // must happen inside the tap
    K.audio.takeoff();
    K.ui.prepareLaunch();
    live = {
      n, mode, run: mode === 'unlimited' ? flight.run : undefined, factIds: flight.facts.map((f) => f.id), phase: 'round', round: 0, rounds: [], pts: 0, alt: 0, maxAlt: 0, startedAt: 0,
      entry: '', chip: store.lastChip != null ? store.lastChip : S.DEFAULT_CHIP,   // your last width carries over
      untimed: !store.tutored,              // a brand-new pilot's first leg is guided and untimed
    };
    store.live = live;
    if (mode === 'unlimited' && !K.access.unlimited()) store.freeRunUsed = true;   // the free run starts now
    if (mode !== 'daily') K.access.notePlay(mode);
    save();
    if (!K.fx.reduced()) {
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const p = Math.min(1, (now - t0) / 380);
          inflate(p);
          if (p < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
    }
    K.scene.inflate(0);
    K.fx.haptic(24);
    const climb = K.scene.liftOff();      // the big climb off the meadow
    const pt = K.scene.point('burner');
    K.fx.embers(pt.x, pt.y, { count: 60, speed: 320 });
    const trail = setInterval(() => {     // sparks keep pouring from the burner
      const b = K.scene.point('burner');
      K.fx.embers(b.x, b.y, { count: 6, speed: 160, life: 0.8 });
    }, 110);
    await climb;
    clearInterval(trail);
    K.ui.dockReady();
    startRound(false);
    K.ui.dockIn();
  }

  /* ------------------------------------------------------------ rounds */
  async function startRound(resuming, animate) {
    legShownAt = Date.now();   // from the first frame of the new leg, stray taps are ignored
    const i = live.round;
    const fact = flight.facts[i];
    if (!resuming) {
      live.phase = 'round';
      live.startedAt = Date.now();
      live.entry = '';
      live.chip = store.lastChip != null ? store.lastChip : S.DEFAULT_CHIP;   // keep the width you used last
      save();
    }
    const opts = {
      fact, index: i, rounds: live.rounds, scorePts: live.pts,
      entry: live.entry, chip: live.chip,
      clueUsed: live.clueLeg != null, clueHere: live.clueLeg === i, clueLeg: live.clueLeg,
      onClue: () => { live.clueLeg = i; save(); },
      onChange: (entry, chip, kind) => { live.entry = entry; live.chip = chip; store.lastChip = chip; saveSoon(); if (live.untimed) K.coach.input(entry, chip, kind); },
    };
    if (animate) {
      await K.round.advance(opts);
      // Locked during the transition (Enter), or left the round? Then don't start a clock.
      if (!live || live.round !== i || live.phase !== 'round') return;
      live.startedAt = Date.now();   // the 30 s start once the dial is full
      save();
    } else K.round.render(opts);
    K.scene.setChip(live.chip, true);
    if (K.ui.current !== 'round') K.ui.show('round');
    if (live.untimed && i === 0) {          // the one guided leg: no clock, three slips
      K.round.setTimer(C.ROUND_SECONDS, C.ROUND_SECONDS);
      K.coach.onDone = () => {                 // skipped: the clock starts now
        if (!live || live.phase !== 'round') return;
        live.untimed = false; store.tutored = true; live.startedAt = Date.now(); save();
        startTimer(C.ROUND_SECONDS);
      };
      setTimeout(() => K.coach.start(), K.fx.reduced() ? 0 : 500);
      return;
    }
    startTimer(C.ROUND_SECONDS);
  }

  function startTimer(totalSec) {
    stopTimer();
    const loop = () => {
      const remaining = totalSec - (Date.now() - live.startedAt) / 1000;
      K.round.setTimer(remaining, totalSec);
      if (remaining <= 0) { timerRaf = 0; lock({ timedOut: true }); return; }
      timerRaf = requestAnimationFrame(loop);
    };
    timerRaf = requestAnimationFrame(loop);
  }

  function stopTimer() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = 0;
  }

  /** Commit the current guess + chip, score it, then play the reveal. */
  let legShownAt = 0;   // a tap that lands in the first half-second of a new leg is a stray Next-leg tap
  async function lock(opts = {}) {
    if (!live || live.phase !== 'round' || busy) return;
    if (!opts.timedOut && (Date.now() - legShownAt < 500 || document.getElementById('screen-round').classList.contains('leg-out') || document.getElementById('screen-round').classList.contains('leg-in'))) return;
    busy = true;
    stopTimer();
    if (live.untimed) { K.coach.stop(); live.untimed = false; store.tutored = true; save(); }

    const i = live.round;
    const fact = flight.facts[i];
    // Nothing typed when time ran out = an automatic miss (no hints, no free pass).
    const guess = K.round.guessValue();
    const r = guess == null ? { lo: null, hi: null } : S.range(fact, guess, live.chip);
    const hit = guess != null && S.isHit(fact, r);

    // Points: the width's value on a hit, 0 on a miss or no answer.
    let delta = hit ? S.legPoints(live.chip) : 0;
    const clued = live.clueLeg === i;
    if (clued) delta = Math.round(delta * S.CLUE_FACTOR);   // the clue halves this leg
    const before = live.pts;
    live.pts = Math.max(0, before + delta);
    live.alt = S.kmOf(live.pts);

    const result = {
      id: fact.id, guess, chip: live.chip, lo: r.lo, hi: r.hi, hit,
      delta: live.pts - before, timedOut: Boolean(opts.timedOut), clue: clued,
      ptsAfter: live.pts, altAfter: live.alt,
    };
    live.rounds.push(result);
    live.maxAlt = Math.max(live.maxAlt, live.alt);
    live.phase = 'reveal';
    save();

    await playReveal(fact, result, false);
    busy = false;
  }

  /** The reveal: anticipation → impact → outcome → climb. */
  async function playReveal(fact, result, replay) {
    K.round.lockVisual();
    K.fx.haptic(10);
    await K.round.dropNeedle(result.guess);

    const pin = result.hit && result.chip === 4;
    const bp = K.round.bandPoint();
    K.round.markOutcome(result.hit, result.chip);

    if (!replay) {
      if (result.hit) {
        await K.fx.hitstop(pin ? 240 : 110);
        const col = CHIP_HEX[result.chip];
        K.fx.embers(bp.x, bp.y, { count: pin ? 48 : 26, color: col, speed: pin ? 300 : 220 });
        K.fx.floatText(bp.x, bp.y - 26, K.units.climbText(S.kmOf(result.delta)), col);
        if (pin) { K.fx.ringBurst(bp.x, bp.y); K.fx.sparks(bp.x, bp.y); K.fx.nudge(); }
        K.audio.hit(result.chip);
        const pt = K.scene.point('burner');
        K.fx.embers(pt.x, pt.y, { count: 20, speed: 200 });
        K.fx.haptic(pin ? 40 : 16);
      } else {
        K.scene.dropSandbag();
        K.audio.miss();
      }
      K.ui.setAltitude(live.pts);
      K.scene.climbTo(live.alt);
    }

    K.round.renderLegs(-1, live.rounds);
    await K.fx.sleep(replay ? 0 : 380);
    const i = live.round;
    K.round.showResult({
      hit: result.hit, chipIdx: result.chip, delta: result.delta, clue: result.clue,
      timedOut: result.timedOut, guess: result.guess, lo: result.lo, hi: result.hi,
      nextLabel: i < C.LEGS - 1 ? 'Next leg' : 'See your flight',
      nextStub: i < C.LEGS - 1 ? `Leg ${i + 2}` : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
    });
    document.getElementById('btn-next').focus({ preventScroll: true });
  }

  function next() {
    if (!live || live.phase !== 'reveal' || busy) return;
    if (live.round < C.LEGS - 1) {
      live.round += 1;
      startRound(false, true);
    } else finish();
  }

  /* ------------------------------------------------------------ passport */
  /**
   * Stamp every milestone passed today and decide what deserves a celebration.
   * Rules (kept deliberately quiet so repeats never feel spammy):
   *   • every milestone passed gets a small inked stamp on today's passport page
   *   • the lifetime count drives the ink tier: navy 1, bronze 5, silver 10, gold 20, moon rock 30
   *   • at most ONE big "slam" per flight. Priority: Kármán line (every time),
   *     then a first-ever stamp, then a tier-up. Everything else stays quiet.
   */
  function stampPassport(maxAlt) {
    const counts = store.stampCounts;
    const stamps = S.MILESTONES.filter((m) => maxAlt >= m.km).map((m) => {
      const before = counts[m.id] || 0;
      const after = before + 1;
      counts[m.id] = after;
      if (!store.stamps[m.id]) store.stamps[m.id] = n;
      return {
        id: m.id, count: after,
        first: before === 0,
        tierUp: before > 0 && S.tierIndex(after) > S.tierIndex(before),
      };
    });
    const pick = (fn) => stamps.filter(fn).sort((a, b) => S.MILESTONES.findIndex((m) => m.id === b.id) - S.MILESTONES.findIndex((m) => m.id === a.id))[0];
    const slam = pick((s) => s.id === 'karman') || pick((s) => s.first) || pick((s) => s.tierUp) || null;
    const also = stamps.filter((s) => s !== slam && (s.first || s.tierUp)).map((s) => s.id);
    return { stamps, slam: slam ? slam.id : null, also };
  }

  /* ------------------------------------------------------------ finish */
  function finish() {
    const prevBest = store.stats.bestAlt;
    const record = {
      n, mode, rounds: live.rounds, pts: live.pts, alt: live.alt, maxAlt: live.maxAlt, prevBest, done: true, at: Date.now(),
    };
    record.passport = stampPassport(record.maxAlt);                       // every flight earns stamps
    record.streakInfo = mode === 'daily' ? applyStreak(n) : { carried: 0, earnedThermal: false };  // only dailies build streaks
    store.stats.flights += 1;
    store.stats.bestAlt = Math.max(prevBest, record.alt);
    record.rounds.forEach((r) => {
      store.stats.chip[r.chip][1] += 1;
      if (r.hit) store.stats.chip[r.chip][0] += 1;
    });
    if (mode === 'unlimited') {
      record.run = flight.run;
      store.unlimitedCount = (store.unlimitedCount || 0) + 1;
      record.flightNo = store.unlimitedCount;            // the pilot's own Unlimited Flight #N
      store.runsDone = [...new Set([...(store.runsDone || []), flight.run])];
      store.runs.push(record);
      if (store.runs.length > 50) store.runs.shift();
      store.seen.push(...flight.facts.map((f) => f.id));
    } else store.days[n] = record;
    store.live = null;
    live = null;
    save();
    refreshTopbar();
    if (mode === 'daily' || mode === 'unlimited') K.stats.submit(record);   // archive replays don't count
    showResults(record, true);
  }

  function showResults(record, isFresh) {
    K.fx.clearBanners();
    const st = streakNow();
    K.ui.results({
      record, n, mode, streak: st.cur, thermals: st.thermals,
      streakInfo: record.streakInfo, isFresh, prevBest: record.prevBest,
    });
    K.ui.show('results');
    if (isFresh) {
      const pt = K.scene.point('burner');
      K.scene.flare(1.4);
      K.fx.embers(pt.x, pt.y, { count: 30, speed: 240 });
      if (record.alt >= C.KARMAN_KM) {
        const c = K.scene.point('envelope');
        K.fx.sparks(c.x, c.y, { count: 70, speed: 420 });
        K.fx.ringBurst(c.x, c.y, '#BFD6FF');
      }
    }
  }

  /* ------------------------------------------------------------ resume */
  async function resume() {
    if (live.phase === 'round') return startRound(true);
    if (live.phase === 'burnWager') return finish(); // a save from before the Burn was removed
    if (live.phase === 'reveal') {
      const i = live.round;
      const fact = flight.facts[i];
      const r = live.rounds[i];
      K.round.render({
        fact, index: i, rounds: live.rounds.slice(0, i), scorePts: live.pts - r.delta,
        entry: r.guess == null ? '' : String(fact.scale === 'year' ? r.guess : Number(K.units.view(fact).toDisp(r.guess).toPrecision(4))),
        chip: r.chip, onChange: () => {},
        clueUsed: live.clueLeg != null, clueHere: live.clueLeg === i, clueLeg: live.clueLeg,
      });
      K.ui.show('round');
      busy = true;
      await playReveal(fact, r, true);
      busy = false;
    }
  }

  /* ------------------------------------------------------------ countdown */
  function startCountdown() {
    clearInterval(countdownTimer);
    const tick = () => {
      const ms = K.date.msToNextFlight();
      const el = document.getElementById('countdown');
      if (el) el.textContent = K.date.formatClock(ms);
      if (ms < 1000 && devFlight == null && !live) setTimeout(() => boot(), 1500);
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------ milestones */
  /* Big banners only for firsts and for space. Familiar milestones get a
     short, small whisper so a routine climb doesn't shout every few seconds. */
  function onCross(ev) {
    if (ev.type === 'milestone') {
      const m = ev.milestone;
      const first = !(store.stampCounts[m.id] > 0);
      const big = first || m.id === 'karman';
      K.fx.banner({
        eyebrow: m.id === 'karman' ? 'You reached space' : first ? 'First time' : '',
        title: m.name,
        meta: big ? `${m.km % 1 ? m.km.toFixed(1) : m.km} km` : '',
        tone: m.id === 'karman' ? 'space' : first ? 'fresh' : 'quiet',
        hold: big ? 2100 : 1100,
      });
      if (big) K.audio.stamp();
      if (m.id === 'karman') {
        const c = K.scene.point('envelope');
        K.fx.sparks(c.x, c.y, { count: 60, speed: 380, color: '#BFD6FF' });
      }
      K.fx.haptic(12);
    } else if (ev.type === 'pb') {
      K.fx.banner({ eyebrow: 'Personal best', title: 'Higher than you have ever flown', meta: `past ${ev.km.toFixed(1)} km`, tone: 'pb' });
    }
  }

  function init() {
    K.FACTS.forEach((f) => factIndex.set(f.id, f));
    K.scene.onCross = onCross;
  }

  /** Results → "Keep flying": an Unlimited run, or the paywall. */
  function keepFlying() {
    if (store.parked && store.parked.unlimited) return boot({ mode: 'unlimited' });   // pick up the run you left
    if (!K.access.canKeepFlying()) return K.ui.openSheet('paywall');
    boot({ mode: 'unlimited', fresh: true });
  }
  /** Archive calendar → a past day. */
  function playDay(day) {
    if (day === today) return boot({ mode: 'daily' });
    if (store.days[day] && store.days[day].done) return boot({ mode: 'archive', n: day });
    if (!K.access.canArchive()) return K.ui.openSheet('paywall');
    boot({ mode: 'archive', n: day });
  }

  return {
    init, boot, launch, inflate, lock, next, streakNow, keepFlying, playDay,
    get mode() { return mode; },
    get today() { return today; },
    factById: (id) => factIndex.get(id),
    get flightNo() { return n; },
    get phase() { return live ? live.phase : null; },
    get leg() { return live ? live.round : null; },
    get pts() { return live ? live.pts : (mode !== 'unlimited' && store && store.days[n] && store.days[n].done ? store.days[n].pts : 0); },
    /** Seconds left on the running leg (null outside a round). Keeps counting while the menu is open. */
    remaining: () => (live && live.phase === 'round' && !live.untimed ? Math.max(0, C.ROUND_SECONDS - (Date.now() - live.startedAt) / 1000) : null),
  };
})();
