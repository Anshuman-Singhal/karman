/* ==========================================================================
   KÁRMÁN · share.js
   The spoiler-free flight log people paste into group chats:

     KÁRMÁN #12 🚀
     245 points

     🚀✈️💨🛰️🎈

     karman.day

   One emoji per question: how sure you were if it landed, 💨 if it missed.
   Never the answers.
   ========================================================================== */

K.share = (() => {
  const S = K.scoring;

  /* Each guess becomes how high it would carry you:
       ☁️ Wide · 🎈 Fair · ✈️ Snug · 🛰️ Tight · 🚀 Pinpoint · 💨 miss */
  function text(record) {
    const legs = record.rounds.map((r) => (r.hit ? S.CHIPS[r.chip].glyph : S.MISS_GLYPH)).join('');
    const pts = record.pts != null ? record.pts : S.ptsOf(record.alt);
    const title = record.mode === 'unlimited' ? 'KÁRMÁN Unlimited' : `KÁRMÁN #${record.n}`;
    return [`${title} 🚀`, `${pts} points`, '', legs, '', K.CONFIG.SHARE_URL].join('\n');
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
      return 'manual'; // caller selects the text so the player can copy it
    }
  }

  return { text, share, copy };
})();
