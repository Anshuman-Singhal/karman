"""Reveal-race check: leaving a leg mid-reveal must never crash or draw over the next flight.

Locks a leg, then (after 0–1200 ms, while the reveal is still animating) boots
another flight: Keep flying, an archive day, a dev flight, a chosen Unlimited
run, and Menu → Unlimited / Today taps. Any page error fails the check.

    cd web && python3 -m http.server 8765 &      # serve the game
    python3 tools/reveal-race.py                 # needs: pip install playwright

Exit code 1 on any error.
"""
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
SEED = """()=>{const d=K.storage.data;d.tutored=true;d.guideV=4;
  d.access={unlimited:true,via:'stripe',session:'dev',checkedAt:Date.now(),welcomed:true};K.storage.save(true)}"""
BOOTS = ["K.game.keepFlying()", "K.game.playDay(K.game.today-2)", "K.game.boot({flight: K.game.today-1})", "K.game.flyRun(3)"]
bad = 0


def fresh(b):
    p = b.new_page(viewport={'width': 390, 'height': 844})
    errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(BASE); p.wait_for_timeout(700); p.evaluate(SEED); p.reload(); p.wait_for_timeout(1000)
    p.evaluate("K.game.launch()"); p.wait_for_timeout(2600)
    return p, errs


with sync_playwright() as pw:
    b = pw.chromium.launch()
    for how in BOOTS:
        for delay in (0, 150, 400, 800, 1200):
            p, errs = fresh(b)
            p.evaluate(f"(async()=>{{K.game.lock(); await new Promise(r=>setTimeout(r,{delay})); {how};}})()")
            p.wait_for_timeout(2200)
            # the new flight sits on its home screen; the old reveal must not have finished
            # behind it (its last act is focusing Next leg)
            st = p.evaluate("[K.ui.current, K.game.phase, (document.activeElement || {}).id || '']")
            if st[0] == 'home' and st[2] == 'btn-next': errs.append(f'old reveal ran on over the new flight: {st}')
            if errs: bad += 1; print(f'  ✗ {how} after {delay} ms: {errs[:2]}')
            p.close()
    for tile in ('unlimited', 'today'):
        for delay in (0, 300, 600):
            p, errs = fresh(b)
            if tile == 'today': p.evaluate("K.game.playDay(K.game.today-2)"); p.wait_for_timeout(800); p.evaluate("K.game.launch()"); p.wait_for_timeout(2600)
            p.evaluate("K.game.lock()"); p.wait_for_timeout(delay)
            p.click('#btn-menu', force=True); p.wait_for_timeout(150)
            p.click(f'.menu-tile[data-menu={tile}]', timeout=2000); p.wait_for_timeout(2200)
            if errs: bad += 1; print(f'  ✗ Menu → {tile} after {delay} ms: {errs[:2]}')
            p.close()
    b.close()
print(f'{bad} failing case(s).' if bad else 'Reveal race: no errors.')
sys.exit(1 if bad else 0)
