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

  /* Launch: one click, tap, Enter or Space fires the burner. New desktop
     players didn't see the ticket as the way in, so it now says so (a
     mouse-only hint), behaves like a key (hover lift, press), is focused on
     arrival, answers Enter/Space from anywhere on the home screen, and the
     balloon itself is a second door. After 6 s idle a light passes over it
     (at most 3 times). The stub tears off on launch. */
  const launchBtn = $('btn-launch');
  const onHome = () => K.ui.current === 'home' && ![...document.querySelectorAll('.sheet-wrap')].some((w) => !w.hidden);
  const takeOff = () => {
    if (launchBtn.disabled || !onHome()) return;
    launchBtn.disabled = true;
    launchBtn.classList.remove('pressing', 'glint');
    launchBtn.classList.add('holding', 'fired');
    K.game.launch();
  };
  launchBtn.addEventListener('click', takeOff);
  launchBtn.addEventListener('pointerdown', (e) => { if (e.button === 0 && !launchBtn.disabled) launchBtn.classList.add('pressing'); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => launchBtn.addEventListener(t, () => launchBtn.classList.remove('pressing')));
  document.addEventListener('keydown', (e) => {
    if (!onHome() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target === launchBtn) return;                                   // the button clicks itself
    if (e.target.closest && e.target.closest('button, a, input, textarea, select, [contenteditable]')) return;   // Enter on Archive opens Archive
    e.preventDefault();
    takeOff();
  });
  $('balloon-rig').addEventListener('click', () => { if (onHome()) takeOff(); });
  let glintT = 0, glints = 0;
  const stopGlint = () => { clearTimeout(glintT); launchBtn.classList.remove('glint'); };
  const armGlint = () => {
    stopGlint();
    if (K.fx.reduced() || glints >= 3) return;
    const tick = () => {
      if (!onHome() || launchBtn.disabled || glints >= 3) return;
      launchBtn.classList.remove('glint'); void launchBtn.offsetWidth; launchBtn.classList.add('glint');
      glints += 1; glintT = setTimeout(tick, 7000);
    };
    glintT = setTimeout(tick, 6000);
  };
  ['pointermove', 'keydown', 'wheel', 'touchstart'].forEach((t) => document.addEventListener(t, () => {
    if (onHome() && glints < 3 && !launchBtn.disabled) armGlint();
  }, { passive: true }));
  const focusLaunch = (tries = 0) => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || !onHome() || launchBtn.disabled) return;
    // While the page is still booting the card is hidden and can't take focus: try again shortly.
    if (document.documentElement.classList.contains('booting')) { if (tries < 20) setTimeout(() => focusLaunch(tries + 1), 150); return; }
    if (document.activeElement === document.body || !document.activeElement) launchBtn.focus({ preventScroll: true });
  };
  K.ui.onHome = () => { glints = 0; armGlint(); focusLaunch(); };

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
    if (go === 'unlimited') {
      const d = K.storage.data;
      const hangar = K.access.unlimited() && !(d.parked && d.parked.unlimited) && (d.runsDone || []).length;
      return fromMenu(() => (hangar ? K.ui.openSheet('runs') : K.game.keepFlying()))();   // runs list first, like the archive
    }
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
  $('parked-tag').addEventListener('click', () => K.game.keepFlying());
  $('btn-today').addEventListener('click', () => K.game.boot({ mode: 'daily' }));
  $('btn-buy').addEventListener('click', () => K.ui.startGoogle('buy'));
  $('btn-restore').addEventListener('click', () => K.ui.startGoogle('restore'));
  $('btn-code-toggle').addEventListener('click', () => { $('code-form').hidden = false; $('code-input').focus(); });
  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await K.access.redeem($('code-input').value);
    if (ok) { K.ui.welcome('pass'); K.ui.refreshAccess(); }
    else { K.fx.toast(K.access.lastRefusal === 'claimed' ? 'That pass is already in use on another device.' : 'That code isn’t valid.'); $('code-input').select(); }
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
  // First paint: the card was held invisible and unanimated until the game had
  // put the right screen in it (no empty square resizing into place on load).
  // Reveal once the scenery images are in (so the fade never competes with
  // decoding and first paint), two frames after the screen is booted.
  const reveal = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('booting');
    const v = document.getElementById('boot-veil');
    if (v) setTimeout(() => v.remove(), 400);
  }));
  if (document.readyState === 'complete') reveal(); else window.addEventListener('load', reveal, { once: true });
  K.stats.hit();
  // karman.day/?fps : a small frame-rate counter, to check smoothness on a real device.
  if (/[?&]fps\b/.test(location.search)) {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10000;padding:4px 8px;border-radius:6px;background:rgba(10,13,28,.8);color:#9f9;font:600 12px/1 ui-monospace,monospace;pointer-events:none';
    document.body.appendChild(m);
    let n = 0, t0 = performance.now(), worst = 0, last = t0;
    (function tick(t) {
      n++; worst = Math.max(worst, t - last); last = t;
      if (t - t0 >= 1000) { m.textContent = `${Math.round((n * 1000) / (t - t0))} fps · worst ${Math.round(worst)} ms`; n = 0; t0 = t; worst = 0; }
      requestAnimationFrame(tick);
    })(t0);
  }
  // Access first (a purchase coming back from Stripe), then the cloud copy.
  K.access.refresh().finally(() => {
    K.access.afterSignIn();
    setTimeout(() => K.ui.maybeWelcome(), 1400);   // earlier buyers: the welcome card, once
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && K.sync) K.sync.now(); });
  paintSound();
})();
