/* ==========================================================================
   KÁRMÁN · config.js
   Every tunable number in the game lives here, so balancing never means
   hunting through UI code. Loaded first; everything hangs off window.K.
   ========================================================================== */

window.K = window.K || {};

/* Running on the real site (karman.day or a workers.dev preview) rather than a
   laptop? Decides the dev tools and the stats backend below. */
K.LIVE = typeof location !== 'undefined' && location.protocol.startsWith('http') &&
  !/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\])/.test(location.hostname);

K.CONFIG = {
  /* Flight #1 is played on this LOCAL calendar date. Change before launch.
     Month is 1-based here (10 = October) to avoid the JS Date off-by-one. */
  LAUNCH: { y: 2026, m: 10, d: 7 },

  /* Round timing, in seconds. */
  ROUND_SECONDS: 30,

  /* Questions per flight. A perfect flight (every leg Pinpoint) reaches the
     Kármán line exactly, so each point is worth KARMAN_KM / (LEGS × 100). */
  LEGS: 7,

  /* Range rules v2 (see scoring.js range()) start with this daily flight;
     earlier flights, already flown and charted, keep v1. Unlimited is v2. */
  RULES2_FROM: 4,

  /* The finish line. */
  KARMAN_KM: 100,

  /* Streak freezes ("Thermals"): earn one every N consecutive days, hold MAX. */
  THERMAL_EVERY: 7,
  THERMAL_MAX: 2,

  /* Comparison stats ("higher than 72% of pilots"). On automatically on the
     live site, where the Worker answers /api/*. API_BASE '' = same domain. */
  STATS: K.LIVE,
  API_BASE: '',
  /* Preview the stats design with clearly-labelled SAMPLE numbers when there
     is no backend. Only active while DEV is true. */
  SAMPLE_STATS: true,

  /* Unlimited + archive. PRICE is shown on the paywall; PAYMENTS turns on the
     real Google sign-in + Stripe flow (needs the Worker secrets, SHIPPING.md 5).
     With PAYMENTS false and DEV true, the paywall simulates a purchase and the
     unlock code PILOT-TEST works, so the whole flow can be tested offline. */
  PRICE: '$5.99',
  CONTACT_EMAIL: 'hello@karman.day',   // "Found a bug? Contact us" (set up this inbox)
  PAYMENTS: false,
  GOOGLE_CLIENT_ID: '356308228840-6jim0vk3hpq8c3abg07hajgmt3lb9ege.apps.googleusercontent.com',

  /* Shown on the last line of every share card. */
  SHARE_URL: 'karman.day',

  /* localStorage key. Bump the suffix only with a migration in storage.js. */
  STORAGE_KEY: 'karman:v1',

  /* Developer tools: flight picker + "wipe save" strip. On for local copies;
     on the live site only when you add ?dev to the address (karman.day/?dev). */
  DEV: !K.LIVE || (typeof location !== 'undefined' && /[?&]dev\b/.test(location.search)),
};
