/* ==========================================================================
   KÁRMÁN · prng.js
   Deterministic randomness. Every player must see the same flight, the same
   clouds and the same starting marker positions, so nothing in the daily
   content ever calls Math.random(). (Purely cosmetic sparks still may.)
   ========================================================================== */

K.rng = {
  /** Hash any string to an unsigned 32-bit integer (cyrb53-style mixing). */
  hash(str) {
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  },

  /** Small, fast, well-distributed PRNG. Returns a function giving [0, 1). */
  mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /** Convenience: a seeded generator from a string label. */
  fromLabel(label) {
    return this.mulberry32(this.hash(label));
  },

  /** Fisher–Yates shuffle that returns a NEW array (input untouched). */
  shuffle(list, rand) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  },
};
