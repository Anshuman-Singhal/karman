# KÁRMÁN weekly question run

This file is the standing instruction for the scheduled task that keeps KÁRMÁN stocked. It runs once a week, with no human review, so every rule below is mandatory.

## Goal
Add **70 new questions**: the tool puts 49 into the next 7 daily flights and 21 into the Unlimited bank. Keep at least 14 days scheduled ahead (if `status` shows fewer, run twice).

## Never touch
`schedule.json` → `freeRun`, existing `runs` (numbered Unlimited runs; `add` appends new ones automatically from the 21 bank questions) and any already-scheduled flight.

## Steps
1. Clone or pull the repo. Run `node tools/content.mjs status` and note the count.
2. Read `content/questions.json` so you know every question already asked. Never ask the same thing twice, even reworded (the tool also blocks near-duplicates).
3. Check for reported answers: fetch `https://karman.day/api/reports` (most-reported question ids with counts, last 60 days; use the web-fetch tool if the shell can't reach the site).
   For each reported id, re-check the fact against a reliable source. If it's wrong, correct `answer`, `card` or `hint` **under the same id** in `content/questions.json`. Never change ids or the schedule.
4. Write 70 candidates into `content/batches/YYYY-MM-DD.json`, a JSON array of objects shaped like:
   ```json
   { "cat": "Structures", "q": "How tall is the Leaning Tower of Pisa?", "unit": "meters", "answer": 56,
     "scale": "log", "min": 1, "max": 2000, "hint": "For scale: a 10-story building is about {30 m} tall.",
     "card": "It leans about 4 degrees, down from 5.5 before engineers steadied it in 2001.",
     "clue": "The Statue of Liberty, ground to torch, is about {93 m} tall.",
     "source": "https://en.wikipedia.org/wiki/Leaning_Tower_of_Pisa" }
   ```
   - **Mix** (players asked for more pop culture, so this is a hard requirement): about **7 each** of the ten categories: Sports, Film & TV, Music, Pop Culture (games, internet, toys, food, brands), Structures, Sky & Space, Living Things, History, Machines, Everyday Numbers. That puts **at least 28 of every 70** in Sports / Film & TV / Music / Pop Culture. At most ~30% "what year" questions.
   - **A world audience** (players wrote in from Turkey and elsewhere: too many questions needed American knowledge). The game is played all over the world, so write for a curious adult in Istanbul, São Paulo, Delhi or Lagos as much as one in Ohio:
     - **At most 7 of every 70** (about one a day) may need US-specific knowledge: US coins, states or presidents, US-only TV, US chart positions, American history events, US sports leagues other than globally followed ones. Never two in the same day's seven.
     - **Spread the world**: across the 70, cover every inhabited continent. Include **at least 7** about famous places, people, inventions, food, music, films or sport from non-English-speaking countries (e.g. Istanbul's Bosphorus, Japan's Shinkansen, Brazil's Pelé, Korea's K-pop, India's cricket, Italy's Vespa).
     - **Global pop culture**: prefer hits that traveled worldwide (anime, K-pop, Latin pop, football, Bollywood, global video games) over shows or songs mostly known inside one country.
     - **Hints and clues use global reference points** too: "a soccer match has 90 minutes of play" rather than "in the US you can vote at 18".
   - **Pop culture that lasts**: use facts that won't change: runtimes, episode and season counts of shows that have ended, release years, finished tours, game rules and board sizes, records set at a single event. Never use follower counts, box-office rankings, "current" records, or a show that is still running.
   - **Good questions** are things a curious adult can reason toward but rarely knows exactly: a famous height, distance, count, speed or year. Avoid trivia that needs specialist knowledge, anything political or tragic in a flippant way, and anything that changes over time (populations, records likely to be broken, prices).
   - **Relatable first** (from playtesting: players found the set too niche). Prefer things people have seen, used, eaten, visited or watched: famous landmarks, the body, animals, food, sports, everyday objects, well-known films/inventions. A question should make a typical adult think "ooh, I have a rough idea". Skip obscure history, specialist science and anything that needs a degree.
   - **One answer only.** The question must have exactly one defensible number. If the thing can be counted or measured two ways (e.g. "squares on a chessboard": 64 cells vs 204 squares of all sizes), reword the question so only one reading is possible. The `card` must never mention a different figure for the same quantity.
   - **Units**: metric, and ONLY these (each has an imperial twin, so players who switch to imperial can answer in their units): `meters`, `km`, `mm`, `cm`, `kg`, `tonnes`, `liters`, `square km`, `°C`, `m per second`, `km per second`, `km per hour`. The build refuses any other metric unit. The game shows each answer in the unit a person would actually say, sized by the answer, in both systems: under 1 m reads as cm / inches (a rim is "45.7 cm" or "18 inches", never "1.5 feet"), under 1 lb as ounces, under 1 L as fluid ounces, km under a mile as feet. So store the fact in its natural unit and let the game size it; never pick a unit to dodge this, and never put the unit in the question text ("…in meters?"). Before shipping, check that each new answer reads naturally in BOTH systems (`node tools/content.mjs check` passes; eyeball the imperial figure too). Counts use a plural noun (`bones`, `floors`). Years use `"unit": ""` and `"scale": "year"`, AD only.
   - **Answer**: the commonly cited figure from the source. Decimals are fine.
   - **Counts get `"int": true`**: anything counted in whole things (bones, legs, moons, countries, floors) must set `"int": true`, so the player types a whole number and the narrow widths keep their minimum steps (Tight ±1, Snug ±2, Fair ±4). Measurements (meters, kg, km per hour) never set it.
   - **min / max**: for `log`, about answer ÷ 25 rounded down to a power of ten, and answer × 25 rounded up. For `year`, about 150 years before to 100 years after (no later than 2050).
   - **clue** (new): a SECOND, CLOSER benchmark the player can buy for half the climb. One plain sentence ≤ 110 characters, no "For scale"/"Clue" prefix, a different subject than the question, nearer the answer than the hint (log questions: within about ÷3…×3 of the answer but never within ±8%; years: within ±60 but never within ±4), never the answer or its digits. Braces for convertible measurements, as in the hint.
   - **American English only**: meters, story, color, center (the checker rejects British spellings).
   - **hint**: starts "For scale:" and gives a related reference point, **never the answer or something that trivially implies it**. Put convertible measurements in braces so they show in the player's units: `{330 m}`, `{42 km}`, `{350 km/h}`, `{1,500 kg}`, `{327 °C}`, `{86 mm}`, `{15 cm}`, `{100 L}`, `{12 t}`, `{550,000 sq km}`. This applies to EVERY field (q, hint, clue, card): a bare "15 cm" anywhere fails the build. A measurement that is a name stays literal with `{=…}`: the `{=100 m}` dash, a `{=9 mm}` pistol.
   - **card**: one surprising true sentence, 170 characters max.
   - **source**: a URL where the answer can be confirmed (Wikipedia is fine).
5. **Independent verification pass.** For each candidate, open its source and check the answer again without looking at what you wrote. **Read sources from the shell, never with the web-fetch tool** (this run is unattended; the web-fetch tool can stop it to ask the owner for permission on pages like Wikipedia). Use `node tools/source.mjs --batch content/batches/YYYY-MM-DD.json` to read every source at once and see the sentences that mention each answer; for the ones it flags, read the page with `node tools/source.mjs <url> "term"`. If a source can't be read from the shell, pick a different source (find it with web search) or drop the question. Never type a URL into the web-fetch tool. If the numbers disagree by more than 2% (or 0 years for year questions), fix it or drop it. Replace dropped ones so the batch stays at 70.
6. Run `node tools/content.mjs add content/batches/YYYY-MM-DD.json`. If it prints ✗ lines, fix those entries and run it again until it passes. It writes nothing until the whole batch is clean.
7. Run `node tests/logic.test.js` and `node tests/worker.test.mjs`. Both must pass.
8. Commit with the message `Weekly questions YYYY-MM-DD: flights #A–#B + 21 bank`, and push. The deploy happens automatically.
9. Health check, after pushing: fetch `https://karman.day/api/health` and `https://karman.day/` (wait ~2 minutes for the deploy first).
   - `/api/health` should say `"ok": true`. If not, name each field that is false or missing.
   - The home page should load (HTTP 200).
10. Finish with a short summary: flights added, days ahead now, how many reports were fixed, health ok or not. If anything failed or health is not ok, start the summary with **ACTION NEEDED:** and say exactly what, in plain words for a non-engineer, and do not push a broken state.
