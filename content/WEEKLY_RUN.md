# KÁRMÁN weekly question run

This file is the standing instruction for the scheduled task that keeps KÁRMÁN stocked. It runs once a week, with no human review, so every rule below is mandatory.

## Goal
Add **70 new questions**: the tool puts 49 into the next 7 daily flights and 21 into the Unlimited bank. Keep at least 14 days scheduled ahead (if `status` shows fewer, run twice).

## Never touch
`schedule.json` → `freeRun`, existing `runs` (numbered Unlimited runs; `add` appends new ones automatically from the 21 bank questions) and any already-scheduled flight.

## Steps
1. Clone or pull the repo. Run `node tools/content.mjs status` and note the count.
2. Read `content/questions.json` so you know every question already asked. Never ask the same thing twice, even reworded (the tool also blocks near-duplicates).
3. Check for reported answers: read the contact inbox and, if the Cloudflare API is available, run
   `npx wrangler d1 execute karman --remote --command "SELECT qid, COUNT(*) n FROM reports WHERE created > datetime('now','-8 days') GROUP BY qid ORDER BY n DESC"`.
   For each reported id, re-check the fact against a reliable source. If it's wrong, correct `answer`, `card` or `hint` **under the same id** in `content/questions.json`. Never change ids or the schedule.
4. Write 70 candidates into `content/batches/YYYY-MM-DD.json`, a JSON array of objects shaped like:
   ```json
   { "cat": "Structures", "q": "How tall is the Leaning Tower of Pisa?", "unit": "metres", "answer": 56,
     "scale": "log", "min": 1, "max": 2000, "hint": "For scale: a 10-storey building is about {30 m} tall.",
     "card": "It leans about 4 degrees, down from 5.5 before engineers steadied it in 2001.",
     "source": "https://en.wikipedia.org/wiki/Leaning_Tower_of_Pisa" }
   ```
   - **Mix**: about 12 each of Structures, Sky & Space, Living Things, History, Machines, Everyday Numbers. At most ~30% "what year" questions.
   - **Good questions** are things a curious adult can reason toward but rarely knows exactly: a famous height, distance, count, speed or year. Avoid trivia that needs specialist knowledge, anything political or tragic in a flippant way, and anything that changes over time (populations, records likely to be broken, prices).
   - **Relatable first** (from playtesting: players found the set too niche). Prefer things people have seen, used, eaten, visited or watched: famous landmarks, the body, animals, food, sports, everyday objects, well-known films/inventions. A question should make a typical adult think "ooh, I have a rough idea". Skip obscure history, specialist science and anything that needs a degree.
   - **One answer only.** The question must have exactly one defensible number. If the thing can be counted or measured two ways (e.g. "squares on a chessboard": 64 cells vs 204 squares of all sizes), reword the question so only one reading is possible. The `card` must never mention a different figure for the same quantity.
   - **Units**: metric. Use `metres`, `km`, `°C`, `m per second`, `km per second`, `km per hour`, `kg` where possible (players can switch to imperial). Counts use a plural noun (`bones`, `floors`). Years use `"unit": ""` and `"scale": "year"`, AD only.
   - **Answer**: the commonly cited figure from the source. Decimals are fine.
   - **min / max**: for `log`, about answer ÷ 25 rounded down to a power of ten, and answer × 25 rounded up. For `year`, about 150 years before to 100 years after (no later than 2050).
   - **hint**: starts "For scale:" and gives a related reference point, **never the answer or something that trivially implies it**. Put convertible measurements in braces so they show in the player's units: `{330 m}`, `{42 km}`, `{350 km/h}`, `{1,500 kg}`, `{327 °C}`.
   - **card**: one surprising true sentence, 170 characters max.
   - **source**: a URL where the answer can be confirmed (Wikipedia is fine).
5. **Independent verification pass.** For each candidate, open its source and check the answer again without looking at what you wrote. If the numbers disagree by more than 2% (or 0 years for year questions), fix it or drop it. Replace dropped ones so the batch stays at 70.
6. Run `node tools/content.mjs add content/batches/YYYY-MM-DD.json`. If it prints ✗ lines, fix those entries and run it again until it passes. It writes nothing until the whole batch is clean.
7. Run `node tests/logic.test.js` and `node tests/worker.test.mjs`. Both must pass.
8. Commit with the message `Weekly questions YYYY-MM-DD: flights #A–#B + 21 bank`, and push. The deploy happens automatically.
9. Finish with a short summary: flights added, days ahead now, how many reports were fixed. If anything failed, say exactly what, and do not push a broken state.
