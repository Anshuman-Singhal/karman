/* ==========================================================================
   KÁRMÁN · date.js
   One clock for everyone: a new flight unlocks at MIDNIGHT EASTERN TIME
   (America/New_York), wherever the player is. Flight numbers count Eastern
   calendar days from launch, so the whole world plays the same flight at
   the same moment and a shared result is never a spoiler for "tomorrow".
   Day counts use Date.UTC on the Eastern Y/M/D, so DST shifts can't skew them.
   ========================================================================== */

K.date = {
  TZ: 'America/New_York',

  /** Eastern wall-clock parts of an instant. */
  et(d = new Date()) {
    if (!this._fmt) {
      this._fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: this.TZ, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
      });
    }
    const p = {};
    this._fmt.formatToParts(d).forEach((x) => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
    return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  },

  launchUTC() {
    const L = K.CONFIG.LAUNCH;
    return Date.UTC(L.y, L.m - 1, L.d);
  },

  /** Flight #1 on launch day (Eastern), #2 the day after, and so on. ≤0 = before launch. */
  flightNumber(d = new Date()) {
    const e = this.et(d);
    return Math.round((Date.UTC(e.y, e.m - 1, e.d) - this.launchUTC()) / 864e5) + 1;
  },

  /** A Date for flight n's calendar day (noon UTC, so it labels correctly everywhere). */
  dateOfFlight(n) {
    const L = K.CONFIG.LAUNCH;
    return new Date(Date.UTC(L.y, L.m - 1, L.d + n - 1, 12));
  },

  /** Milliseconds until the next midnight Eastern. */
  msToNextFlight(now = new Date()) {
    const e = this.et(now);
    let next = now.getTime() + (86400 - (e.h * 3600 + e.mi * 60 + e.s)) * 1000 - now.getMilliseconds();
    const h = this.et(new Date(next)).h;          // DST change days are 23 or 25 hours long
    if (h === 23) next += 3600e3; else if (h === 1) next -= 3600e3;
    return next - now.getTime();
  },

  /** "Sunday 4 October" (for a flight date from dateOfFlight) */
  formatLong(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  },

  /** 49512345 ms → "13:45:12" */
  formatClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  },
};
