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
    const ids = flights[n];
    if (!ids) return null;
    return { n, facts: ids.map((id) => byId.get(id)), weather: weatherFor(n) };
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
