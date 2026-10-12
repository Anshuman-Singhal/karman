/* ==========================================================================
   KÁRMÁN · main.js
   Boot order and the few event bindings that span modules.
   ========================================================================== */

(() => {
  const $ = (id) => document.getElementById(id);

  K.fx.init();
  K.scene.init();
  K.ambient.init();
  K.round.init();
  K.ui.init();
  K.game.init();

  /* Launch: one tap fires the burner. */
  $('btn-launch').addEventListener('click', () => {
    const btn = $('btn-launch');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('holding');
    K.game.launch();
  });

  /* Round controls */
  $('btn-lock').addEventListener('click', () => K.game.lock());
  $('btn-next').addEventListener('click', () => K.game.next());

  /* Sound toggle (saved). Turning it on also unlocks audio, since this is a tap. */
  const paintSound = () => {
    const on = K.audio.enabled();
    $('btn-sound').setAttribute('aria-checked', String(on));
  };
  $('btn-sound').addEventListener('click', () => {
    K.audio.setEnabled(!K.audio.enabled());
    paintSound();
    if (K.audio.enabled()) K.audio.puff();
  });

  /* Sheets */
  /* Menu: opening it never pauses the round; the clock keeps running behind. */
  const fromMenu = (fn) => () => { K.ui.closeSheet('menu'); setTimeout(fn, K.fx.reduced() ? 0 : 200); };
  /* Contact: a mailto link does nothing on a desktop with no mail app, so the
     address is also copied and shown, every time. */
  function contact(e, link) {
    const email = K.CONFIG.CONTACT_EMAIL;
    K.share.copy(email).then((r) => K.fx.toast(r === 'copied' ? `${email} copied. Opening your mail app…` : `Email us at ${email}`));
    if (link && link.href) setTimeout(() => { try { window.location.href = link.href; } catch (x) { /* no handler */ } }, 350);
    if (e) e.preventDefault();
  }
  $('contact-link').addEventListener('click', (e) => contact(e, e.currentTarget));
  $('btn-menu').addEventListener('click', () => K.ui.openSheet('menu'));
  $('menu-resume').addEventListener('click', () => K.ui.closeSheet('menu'));
  $('menu-acct').addEventListener('click', fromMenu(() => K.ui.openSheet('account')));
  $('btn-units').addEventListener('click', () => {
    const sys = K.units.system() === 'imperial' ? 'metric' : 'imperial';
    if (K.ui.current === 'round') K.round.setUnits(sys); else K.units.setSystem(sys);
    $('btn-units').setAttribute('aria-checked', String(sys === 'metric'));
    K.ui.refreshUnits();
    K.ui.setAltitude(K.game.pts || 0, { instant: true });
  });
  document.querySelectorAll('.menu-tile[data-menu]').forEach((t) => t.addEventListener('click', (e) => {
    const go = t.dataset.menu;
    const here = t.getAttribute('aria-current') === 'page';
    if (go === 'contact') { contact(e, t); return; }
    if (here && K.game.phase) return K.ui.closeSheet('menu');        // mid-flight in this mode: just resume
    if (go === 'today') return fromMenu(() => K.game.playDay(K.game.today))();
    if (go === 'unlimited') return fromMenu(() => K.game.keepFlying())();
    if (go === 'archive') return fromMenu(() => K.ui.openSheet('archive'))();   // calendar first; locked days open the paywall
    fromMenu(() => K.ui.openSheet(go))();                             // logbook | help
  }));
  // Streak: a quick explanation rather than a second door into the logbook.
  $('btn-streak').addEventListener('click', () => {
    const st = K.game.streakNow();
    K.fx.toast(`${st.cur}-day streak · ${st.thermals} thermal${st.thermals === 1 ? '' : 's'}. Fly 7 days in a row to earn a thermal; it saves your streak if you miss a day.`);
  });
  // Briefing ticket: the stub tears off, then the sheet closes.
  $('btn-ready').addEventListener('click', () => {
    const b = $('btn-ready');
    b.classList.add('torn');
    K.audio.tick();
    setTimeout(() => { K.ui.closeSheet('help'); b.classList.remove('torn'); }, K.fx.reduced() ? 0 : 240);
  });

  /* Share: one ticket button. Tear the stub, then send an image + text via
     the system share sheet where files are supported, else copy the text. */
  let sharing = false;
  $('btn-share').addEventListener('click', async () => {
    const last = K.ui.lastRecord;
    if (!last || sharing) return;
    sharing = true;
    const btn = $('btn-share');
    btn.classList.remove('torn');
    void btn.offsetWidth;
    btn.classList.add('torn');
    K.audio.tick();
    const str = K.share.text(last.record, last.streak);
    // Copy first, inside the tap, so the text is always on the clipboard.
    const result = await K.share.copy(str);
    if (result === 'copied') K.fx.toast('Flight log copied. Paste it in the group chat.');
    else K.fx.toast('Couldn\'t reach the clipboard. Long-press to copy.');
    // Phones also get the share sheet (text only; the picture has its own ticket).
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text: str }); } catch (e) { /* cancelled: it's already copied */ }
    }
    setTimeout(() => { sharing = false; }, 400);
  });

  /* The invite stamp: copy an invitation (no score, so anyone will send it),
     ink a thank-you postmark over the stamp, and on phones open the share sheet. */
  $('dare-stamp').addEventListener('click', async () => {
    const last = K.ui.lastRecord;
    if (!last) return;
    const stamp = $('dare-stamp');
    const str = K.share.invite();
    const result = await K.share.copy(str);
    stamp.classList.remove('stamped'); void stamp.offsetWidth; stamp.classList.add('stamped');
    K.audio.tick();
    K.fx.haptic && K.fx.haptic(14);
    K.fx.toast(result === 'copied' ? 'Invite copied. Thank you for helping a small game grow 🎈' : 'Couldn\'t reach the clipboard. Long-press to copy.');
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text: str }); } catch (e) { /* cancelled: it's already copied */ }
    }
  });

  /* Copy image: put the boarding-pass PNG on the clipboard. The ClipboardItem
     gets a Promise so Safari accepts it inside the tap. Browsers without
     image clipboard support fall back to a download. */
  let copying = false;
  $('btn-copy-img').addEventListener('click', async () => {
    const last = K.ui.lastRecord;
    if (!last || copying) return;
    copying = true;
    const btn = $('btn-copy-img');
    btn.classList.remove('torn', 'done');
    void btn.offsetWidth;
    btn.classList.add('torn');
    K.audio.tick();
    const blobP = K.shareImage.render(last.record, last.n, last.streak, K.ui.lastStats);
    try {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no image clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
      btn.classList.add('done');
      K.fx.toast('Image copied. Paste it anywhere.');
    } catch (e) {
      const blob = await blobP;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `karman-flight-${last.n}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        K.fx.toast('This browser can\'t copy images, so it was saved instead.');
      }
    }
    setTimeout(() => { copying = false; }, 400);
  });

  /* The passport row opens the stamp book. */
  $('passport-row').addEventListener('click', () => K.ui.openSheet('logbook'));

  /* Keyboard: digits type, ← → change width, Enter locks in. */
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.sheet-wrap.open')) {
      if (e.key === 'Escape') document.querySelectorAll('.sheet-wrap.open').forEach((s) => K.ui.closeSheet(s.id.replace('sheet-', '')));
      return;
    }
    if (K.ui.current !== 'round' || K.game.phase !== 'round' || K.round.locked) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (K.round.key(e)) { e.preventDefault(); return; }
    if (e.key === 'Enter' && K.round.guessValue() != null) { e.preventDefault(); K.game.lock(); }
  });

  /* Archive, Keep flying, paywall */
  $('btn-archive').addEventListener('click', () => K.ui.openSheet('archive'));
  $('cal-prev').addEventListener('click', () => K.ui.calStep(-1));
  $('cal-next').addEventListener('click', () => K.ui.calStep(1));
  $('btn-keep').addEventListener('click', () => K.game.keepFlying());
  $('btn-today').addEventListener('click', () => K.game.boot({ mode: 'daily' }));
  $('btn-buy').addEventListener('click', () => K.ui.startGoogle('buy'));
  $('btn-restore').addEventListener('click', () => K.ui.startGoogle('restore'));
  $('btn-code-toggle').addEventListener('click', () => { $('code-form').hidden = false; $('code-input').focus(); });
  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await K.access.redeem($('code-input').value);
    if (ok) { K.fx.toast('Unlimited unlocked. Keep flying.'); K.ui.refreshAccess(); }
    else { K.fx.toast('That code isn’t valid.'); $('code-input').select(); }
  });

  /* Copy the passport page as an image (logbook). */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#btn-pp-share');
    if (!btn) return;
    btn.classList.remove('thunk'); void btn.offsetWidth; btn.classList.add('thunk');
    K.audio.stamp();
    const blobP = K.shareImage.passport();
    try {
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('no image clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
      K.fx.toast('Passport copied. Paste it anywhere.');
    } catch (err) {
      const blob = await blobP;
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'karman-passport.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      K.fx.toast('Passport image saved.');
    }
  });

  K.game.boot();
  K.stats.hit();
  // Access first (a purchase coming back from Stripe), then the cloud copy.
  K.access.refresh().finally(() => K.access.afterSignIn());
  document.addEventListener('visibilitychange', () => { if (document.hidden && K.sync) K.sync.now(); });
  paintSound();
})();
