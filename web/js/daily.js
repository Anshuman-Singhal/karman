/* ==========================================================================
   KÁRMÁN · daily.js
   Reads the generated content file (js/data/content.js, built by
   tools/content.mjs from content/questions.json + content/schedule.json):

     K.FACTS     every question
     K.SCHEDULE  { launch, legs, flights: { "1": [7 ids], "2": [...], … } }

   NO-REPEAT GUARANTEE: the schedule is append-only and the build refuses
   to schedule any question twice, so a daily question appears exactly once
   in the life of the game. Past the last scheduled flight the game shows
   "the hangar is restocking" rather than ever reusing a question.
   ========================================================================== */

K.daily = (() => {
  /* Weather is cosmetic flavour: horizon colour, cloud cover, wind label. */
  const WEATHER = [
    { name: 'Clear dawn', horizon: '#F6C89E', haze: '#F9DEC4', clouds: 7, wind: 'Calm' },
    { name: 'Scattered cumulus', horizon: '#F2B892', haze: '#F6D3BC', clouds: 13, wind: 'Light westerly' },
    { name: 'Rose sky, high cirrus', horizon: '#EFA9A4', haze: '#F5CBC4', clouds: 9, wind: 'Light southerly' },
    { name: 'Lemon light, low cloud', horizon: '#F3D58E', haze: '#F7E4B8', clouds: 16, wind: 'Gentle easterly' },
  ];

  const byId = new Map(K.FACTS.map((f) => [f.id, f]));
  const flights = K.SCHEDULE.flights;

  function weatherFor(n) {
    const rand = K.rng.fromLabel(`karman-weather-${n}`);
    return WEATHER[Math.floor(rand() * WEATHER.length)];
  }

  /** Flight n, or null if it doesn't exist (before launch / not yet stocked). */
  function get(n) {
    const ids = flights[n] || reserve(n);
    if (!ids) return null;
    return { n, facts: ids.map((id) => byId.get(id)), weather: weatherFor(n), reserve: !flights[n] };
  }

  /* Reserve flights: if the weekly restock ever fails and the schedule runs
     out, the game never goes dark. A day past the last scheduled flight gets
     seven questions dealt from the bank and from dailies at least 60 days old,
     seeded by the flight number so every player gets the same seven (and the
     crowd chart still compares like with like). At most two per category. */
  function reserve(n) {
    const last = lastFlightNumber();
    if (!(n > last) || !K.FACTS.length) return null;
    const pool = K.FACTS.filter((f) => f.pool === 'bank');
    Object.keys(flights).forEach((k) => { if (Number(k) <= n - 60) flights[k].forEach((id) => pool.push(byId.get(id))); });
    if (pool.length < 7) return null;
    const rand = K.rng.fromLabel(`karman-reserve-${n}`);
    const order = pool.map((f) => [rand(), f]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const picked = [], perCat = {};
    for (const f of order) {
      if (picked.length === 7) break;
      if ((perCat[f.cat] || 0) >= 2 || picked.includes(f.id)) continue;
      perCat[f.cat] = (perCat[f.cat] || 0) + 1;
      picked.push(f.id);
    }
    for (const f of order) { if (picked.length === 7) break; if (!picked.includes(f.id)) picked.push(f.id); }
    return picked.length === 7 ? picked : null;
  }

  function lastFlightNumber() {
    return Math.max(0, ...Object.keys(flights).map(Number));
  }

  /**
   * The Unlimited pool on a given day: every bank-only question, plus the
   * questions of daily flights that have already happened. Today's and future
   * dailies are never included, so Unlimited can't spoil a flight early.
   */
  function unlimitedPool(today) {
    const pool = K.FACTS.filter((f) => f.pool === 'bank');
    Object.keys(flights).forEach((n) => { if (Number(n) < today) flights[n].forEach((id) => pool.push(byId.get(id))); });
    return pool;
  }

  const fact = (id) => byId.get(id);

  return { get, weatherFor, lastFlightNumber, unlimitedPool, fact };
})();
