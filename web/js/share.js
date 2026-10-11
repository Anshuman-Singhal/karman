/* ==========================================================================
   KÁRMÁN · share.js
   The spoiler-free flight log people paste into group chats:

     KÁRMÁN #12 🚀
     54 km up

     🚀✈️💨🛰️🎈

     karman.day

   One emoji per question: how sure you were if it landed, 💨 if it missed.
   Never the answers.
   ========================================================================== */

K.share = (() => {
  const S = K.scoring;

  /* Each guess becomes how high it would carry you:
       ☁️ Wide · 🎈 Fair · ✈️ Snug · 🛰️ Tight · 🚀 Pinpoint · 💨 miss */
  /** The flight log. With { dare: true } it ends on a challenge (the results stamp). */
  function text(record, _streak, opts = {}) {
    const legs = record.rounds.map((r) => (r.hit ? S.CHIPS[r.chip].glyph : S.MISS_GLYPH)).join('');
    const pts = record.pts != null ? record.pts : S.ptsOf(record.alt);
    const title = record.mode === 'unlimited' ? 'KÁRMÁN Unlimited' : `KÁRMÁN #${record.n}`;
    const km = S.kmOf(pts);
    const lines = [`${title} 🚀`, `${Number.isInteger(km) ? km : km.toFixed(1)} km up`, '', legs, ''];
    if (opts.dare) lines.push('Think you can fly higher? 🎈');
    lines.push(K.CONFIG.SHARE_URL);
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

  return { text, share, copy };
})();
