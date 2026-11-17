/* ==========================================================================
   KÁRMÁN · share.js
   The spoiler-free flight log people paste into group chats:

     KÁRMÁN #12 · 54 km 🚀
     Mesosphere · 5/7 hits · 🔥4

     🚀✈️💨🛰️🎈

     karman.day

   One emoji per question: how sure you were if it landed, 💨 if it missed.
   Never the answers.
   ========================================================================== */

K.share = (() => {
  const S = K.scoring;

  /* Each guess becomes how high it would carry you:
       ☁️ Wide · 🎈 Fair · ✈️ Snug · 🛰️ Tight · 🚀 Pinpoint · 💨 miss */
  /** An invitation with no score in it, so anyone can send it. Not on the results
      screen (its stamp shares the flight log); kept for an "Invite a friend" elsewhere. */
  const invite = () => ['🎈 KÁRMÁN is a 3-minute daily game: guess 7 numbers, bet on how sure you are, and fly a balloon to the edge of space.', `Give it a try: ${K.CONFIG.SHARE_URL}`].join('\n');

  /** The flight log. */
  function text(record, streak, opts = {}) {
    const legs = record.rounds.map((r) => (r.hit ? S.CHIPS[r.chip].glyph : S.MISS_GLYPH)).join('');
    const pts = record.pts != null ? record.pts : S.ptsOf(record.alt);
    const daily = record.mode !== 'unlimited';
    const title = daily ? `KÁRMÁN #${record.n}` : 'KÁRMÁN Unlimited';
    const km = S.kmOf(pts);
    const hits = record.rounds.filter((r) => r.hit).length;
    // Line 2 gives friends something to compare without spoiling an answer:
    // the layer reached (or the Kármán line itself), hits, and a streak worth showing off.
    const where = km >= K.CONFIG.KARMAN_KM ? 'I reached the Kármán line!' : S.tierName(km);
    const tail = [where, `${hits}/${record.rounds.length} hits`];
    if (daily && streak >= 3) tail.push(`🔥${streak}`);
    const lines = [`${title} · ${Number.isInteger(km) ? km : km.toFixed(1)} km 🚀`, tail.join(' · '), '', legs, '', K.CONFIG.SHARE_URL];
    return lines.join('\n');
  }

  /** Try the system share sheet (with the image when given), then the clipboard. Returns what happened. */
  async function share(str, file) {
    if (navigator.share) {
      try {
        await navigator.share(file ? { files: [file], text: str } : { text: str });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    return copy(str);
  }

  async function copy(str) {
    try {
      await navigator.clipboard.writeText(str);
      return 'copied';
    } catch (e) {
      // Older browsers / no clipboard permission: the classic hidden-textarea copy.
      try {
        const ta = Object.assign(document.createElement('textarea'), { value: str, readOnly: true });
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) return 'copied';
      } catch (e2) { /* fall through */ }
      return 'manual'; // caller tells the player to copy it by hand
    }
  }

  return { text, share, copy, invite };
})();
