/* ==========================================================================
   KÁRMÁN · thanks.js
   The one email a buyer gets from us: thank you, here's what's yours, and a
   direct line. Sent once per account through Resend (resend.com) when the
   RESEND_API_KEY secret is set; without it, nothing is sent and nothing is
   marked, so earlier buyers can be thanked later from /dev.
   ========================================================================== */

const FROM = 'KÁRMÁN <hello@karman.day>';
const REPLY = 'hello@karman.day';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const SUBJECT = 'Welcome aboard: KÁRMÁN Unlimited is yours';

export function thanksText() {
  return [
    'Thank you.',
    '',
    'You just unlocked KÁRMÁN Unlimited. Welcome to the first-class cabin: a small crew of pilots with the whole sky open to them. Here is what is now yours:',
    '',
    '- Every Unlimited run: seven fresh questions each, with new runs landing every Monday. Menu > Unlimited shows your run card.',
    '- The whole archive: every daily flight since Flight #1, from the calendar on the home screen.',
    '- Your progress, everywhere: sign in with the same Google account on any device and your logbook, streak and Unlimited come with you.',
    '',
    'A direct line',
    'If anything feels off, an answer looks wrong, or you have an idea (or a question you would love to see on a flight), just reply to this email.',
    '',
    'See you above the clouds,',
    'KÁRMÁN',
    'https://karman.day',
    '',
    'You are getting this one-time email because you bought KÁRMÁN Unlimited. Your receipt comes separately from Stripe.',
  ].join('\n');
}

export function thanksHtml() {
  const perk = (glyph, title, body) => `
    <tr><td style="padding:0 0 16px 0;vertical-align:top;width:40px">
      <div style="width:30px;height:30px;border-radius:50%;background:#14213D;color:#FFB547;font:700 15px/30px Georgia,serif;text-align:center">${glyph}</div></td>
    <td style="padding:0 0 16px 0;vertical-align:top;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#3A4560"><b style="color:#14213D">${esc(title)}</b><br>${body}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#0E1838">
<div style="display:none;max-height:0;overflow:hidden">Every Unlimited run, the whole archive, and a direct line to us.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E1838"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#F6EEDC;border-radius:14px;overflow:hidden">
    <tr><td><a href="https://karman.day/"><img src="https://karman.day/og.png" width="560" alt="KÁRMÁN: a hot-air balloon rising toward the Kármán line" style="display:block;width:100%;height:auto;border:0"></a></td></tr>
    <tr><td style="padding:22px 30px 0 30px;font:600 11px/1 'Courier New',monospace;letter-spacing:1.5px;color:#C4402A;border-bottom:0">FIRST CLASS · KÁRMÁN AIR</td></tr>
    <tr><td style="padding:10px 30px 0 30px"><div style="height:2px;background:#E2552B;line-height:2px">&nbsp;</div></td></tr>
    <tr><td style="padding:22px 30px 6px 30px;font:italic 34px/1.1 Georgia,'Times New Roman',serif;color:#14213D">Thank you.</td></tr>
    <tr><td style="padding:6px 30px 20px 30px;font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#3A4560">You just unlocked <b style="color:#14213D">KÁRMÁN Unlimited</b>. Welcome to the first-class cabin: a small crew of pilots with the whole sky open to them. Here’s what’s now yours:</td></tr>
    <tr><td style="padding:0 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${perk('∞', 'Every Unlimited run', 'Seven fresh questions each, with new runs landing every Monday. <i>Menu → Unlimited</i> shows your run card.')}
      ${perk('◷', 'The whole archive', 'Every daily flight since Flight #1, from the calendar on the home screen.')}
      ${perk('☁', 'Your progress, everywhere', 'Sign in with the same Google account on any device and your logbook, streak and Unlimited come with you.')}
    </table></td></tr>
    <tr><td style="padding:4px 30px 0 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px dashed #B9AE97;border-radius:10px"><tr><td style="padding:16px 18px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#3A4560">
      <b style="color:#14213D">A direct line.</b> If anything feels off, an answer looks wrong, or you have an idea (or a question you’d love to see on a flight), just reply to this email.</td></tr></table></td></tr>
    <tr><td align="center" style="padding:26px 30px 8px 30px"><a href="https://karman.day/" style="display:inline-block;background:#FFB547;color:#14213D;text-decoration:none;font:700 16px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:1px;padding:15px 28px;border-radius:10px;border:1.5px solid #14213D">FLY AN UNLIMITED RUN</a></td></tr>
    <tr><td style="padding:18px 30px 26px 30px;font:italic 18px/1.4 Georgia,serif;color:#14213D">See you above the clouds,<br><span style="font:600 13px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:2px;color:#C4402A;font-style:normal">KÁRMÁN</span></td></tr>
    <tr><td style="padding:14px 30px 22px 30px;border-top:1px dashed #CFC4AC;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#7A7F8E">You’re getting this one-time email because you bought KÁRMÁN Unlimited. Your receipt comes separately from Stripe.<br>
      <a href="https://karman.day/" style="color:#7A7F8E">karman.day</a> · <a href="https://x.com/TheDailyKarman" style="color:#7A7F8E">@TheDailyKarman</a> · <a href="https://www.reddit.com/r/TheKarman/" style="color:#7A7F8E">r/TheKarman</a></td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** Thank one paying account, once. Returns 'sent' | 'already' | 'off' | 'no-email' | 'failed'. Never throws. */
export async function sendThanks(env, sub, emailHint) {
  try {
    if (!env.RESEND_API_KEY) return 'off';
    const u = await env.DB.prepare('SELECT email FROM users WHERE sub = ?').bind(sub).first();
    const to = ((u && u.email) || emailHint || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return 'no-email';
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO thanks (sub, email) VALUES (?, ?)').bind(sub, to).run();
    const changed = claim && claim.meta ? claim.meta.changes : claim && claim.changes;
    if (!changed) return 'already';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `thanks-${sub}` },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY, subject: SUBJECT, html: thanksHtml(), text: thanksText() }),
    });
    if (!r.ok) {
      await env.DB.prepare('DELETE FROM thanks WHERE sub = ?').bind(sub).run();   // let a later try send it
      console.warn('thanks email failed', r.status, (await r.text()).slice(0, 200));
      return 'failed';
    }
    const j = await r.json().catch(() => ({}));
    if (j && j.id) await env.DB.prepare('UPDATE thanks SET id = ? WHERE sub = ?').bind(j.id, sub).run();
    return 'sent';
  } catch (e) {
    console.warn('thanks email error', e && e.message);
    return 'failed';
  }
}
