# KÁRMÁN

A daily estimation game. Every day, everyone gets the same seven questions with numeric answers. You place a guess and choose how sure you are: a narrow range lifts you higher if the true answer lands inside it. Your craft evolves as you climb, from a hot-air balloon to a sealed gondola, a stratospheric helium balloon, a rocket and finally a capsule in space at 100 km.

Plain HTML, CSS and JavaScript. No build step, no framework, no backend (yet).

## Run it

Open `web/index.html` in a browser. That's it.

If you prefer a local server (closer to production):

```bash
python3 -m http.server 8000 -d web     # then visit http://localhost:8000
```

Check the game logic before every deploy:

```bash
node tests/logic.test.js
```

## Developer tools

On your laptop (or `karman.day/?dev`), the game shows a small strip under the top bar:

- **‹ #N ›** jumps between flights, so you can play any day in the bank.
- **Wipe save** clears your local progress (tap twice).

It hides itself on the live site automatically.

## How the code is organised

| File | Job |
| --- | --- |
| `web/js/config.js` | Every tunable number: launch date, timer, legs per flight, thermals |
| `content/questions.json` · `content/schedule.json` | Every question and which day it flies. Append-only; edit through `tools/content.mjs` |
| `web/js/data/content.js` | Generated from the two files above (`node tools/content.mjs build`). Don't edit by hand |
| `content/WEEKLY_RUN.md` | The instructions the weekly scheduled task follows to write 70 new questions |
| `web/js/daily.js` | Turns the fact bank into a fixed daily schedule; no fact is ever used twice |
| `web/js/scoring.js` | Pure rules: ranges, hits, points, clue windows, milestones |
| `web/js/storage.js` | The single localStorage save |
| `web/js/game.js` | The flight state machine and the choreography of each reveal |
| `web/js/round.js` | The round card: number pad, ruler drawn around your guess, width chips, timer, reveal visuals |
| `web/js/scene.js` | The sky: camera, balloon, clouds, landmarks, stars, Earth, altimeter rail |
| `web/js/vehicle.js` | The rockoon: balloon → gondola → helium balloon → rocket → capsule, with transitions |
| `web/js/ambient.js` | Living sky details by altitude: god rays, birds, cloud punch-through, nacreous bands, aurora, satellite, climb wind |
| `web/js/ui.js` | Home, results (histogram, answer number lines, tickets), logbook, help, dev strip |
| `web/js/fx.js` | Game feel: particles, odometer, banners, hitstop, toasts |
| `web/js/share.js` | The spoiler-free share text and the share/copy flow |
| `web/js/shareimg.js` | The 1080×1350 boarding-pass share image (canvas, no answers shown) |
| `web/js/units.js` | Metric / imperial display (scoring always metric) |
| `web/js/audio.js` | Synthesised sounds in one key: take-off swell + arpeggio, key ticks, hit chimes, mute |
| `web/js/stats.js` | "Higher than X% of pilots" and per-leg hit rates |
| `api/src/index.js` | Cloudflare Worker: serves the game + `/api/result`, `/api/stats/:n` |
| `db/schema.sql` | D1 table for anonymous results |
| `web/css/tokens.css` | Colours, type, motion curves |

Scripts load in order from `index.html` and share one namespace, `window.K`. Each file opens with a comment explaining what it owns.

## Scoring at a glance

| Width | Number questions | Counts (whole numbers) | Year questions | Climb on a hit |
| --- | --- | --- | --- | --- |
| Wide | within 100× (÷100 … ×100) | and at least ±10 | ±1,000 years | 2 km |
| Fair | within 3× | and at least ±4 | ±200 | 5 km |
| Snug | within 1.5× | and at least ±2 | ±45 | 10 km |
| Tight | within 15% | and at least ±1 | ±10 | 15 km |
| Pinpoint | within 4% | exact for small counts | ±2 | 20 km |

Each width is the best bet for one kind of knowing (Pinpoint: you know it; Tight: close; Snug: ballpark; Fair: right order of magnitude; Wide: could be off ten times or more). These are rules v2, from daily Flight #4 (`RULES2_FROM` in `config.js`) and for every Unlimited run; Flights #1–3 keep the v1 ratios in `scoring.js` so their archive replays and crowd charts stay comparable.

Seven legs, so 140 km is the ceiling and the Kármán line (space) is 100 km. One clue per flight (a closer benchmark) halves that leg's climb. Internally the score is stored as points at 5 per km, which is what saves and the stats API hold.

## Shipping

See [SHIPPING.md](SHIPPING.md).
