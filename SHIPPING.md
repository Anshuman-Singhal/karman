# Shipping KÁRMÁN to karman.day

This guide takes the game from your laptop to a public site at **karman.day**, then to a self-running product. Work through the phases in order. Each one ends with something live.

| Phase | Result | Effort | Needed before |
| --- | --- | --- | --- |
| 1. Go live | The game and its comparison stats run at karman.day over HTTPS | 1–2 hours | Anyone outside your laptop plays |
| 2. Launch polish | Link previews, home-screen icon, analytics, privacy page | Half a day | You post it publicly |
| 3. Backend + question factory | New questions written and checked every night, never repeating | 1–2 weeks | **Day 11 after launch** |
| 4. Payments | The Pilot's License ($5 one-time unlock) | 3–5 days | You want revenue |

> **The one deadline that matters:** the launch set covers 8 daily flights. On day 9 the game shows "The hangar is restocking" instead of a flight; it never repeats a question to fill the gap. Turn on the weekly run (Phase 3) before then. Unlimited already has 74 questions to draw from.

---

## Phase 1 · Go live

### 1.1 Preflight in the code

`DEV` and `STATS` switch themselves (live site vs. laptop), so the only launch setting is the date of Flight #1 in `web/js/config.js`. It is **7 October 2026** (launch day), and `content/schedule.json` uses the same date. Leave it unless you want a later #1; changing it renumbers every flight.

If you do change it, also set the same launch date in `api/src/index.js` (`LAUNCH_UTC`; the month is 0-based there, so October is 9). If you ever change `LEGS` in `config.js`, change `LEGS` in `api/src/index.js` to match, or the stats endpoint will reject results.

Then run the checks:

```bash
node tests/logic.test.js      # must print "All checks passed."
```

Play one complete flight on your actual phone before deploying. From the project folder:

```bash
python3 -m http.server 8000 -d web --bind 0.0.0.0
```

Open `http://<your-laptop's-local-IP>:8000` on your phone (same Wi-Fi). Check:

- [ ] Tapping Take off plays the burner roar and the balloon climbs off the meadow (the speaker button mutes it)
- [ ] Typing on the number pad feels instant; the width slider stretches the range on the ruler for every width
- [ ] The units button switches metres ⇄ feet (and km ⇄ miles, °C ⇄ °F) and converts what you typed
- [ ] A reload mid-round resumes the same round with the timer still running
- [ ] The share button opens the share sheet (or copies) and pastes cleanly into iMessage/WhatsApp
- [ ] With Reduce Motion on (iOS: Settings → Accessibility → Motion), the game still works, just calmer

### 1.2 Put the code on GitHub

```bash
cd karman
git init
git add .
git commit -m "KÁRMÁN v1"
gh repo create karman --private --source=. --push    # or create the repo on github.com and push
```

### 1.3 Buy the domain

1. Create a free Cloudflare account at dash.cloudflare.com.
2. Go to **Domain Registration → Register Domains** and search `karman.day`. Cloudflare Registrar supports `.day` and sells at cost.
3. If it's taken, the fallbacks from the plan were *ascent*, *updraft* and *envelope*. Before you commit to the name, search "Karman" in the USPTO trademark search for games and software.

Buying it at Cloudflare means DNS and HTTPS are set up automatically, which the next step needs.

### 1.4 Deploy (no terminal needed)

One Cloudflare Worker serves the `web/` folder and answers `/api/*` (`api/src/index.js`), with a small D1 (SQLite) database behind it. Two things make the first deploy hands-off:

- `wrangler.jsonc` names the database but gives it no id, so the first deploy **creates** a database called `karman` and links it (Cloudflare's automatic provisioning).
- The Worker **creates its own tables** on first use (`api/src/schema.js`, a copy of `db/schema.sql`), so there is no schema step.

Steps, all in the Cloudflare dashboard (dash.cloudflare.com):

1. **Workers & Pages → Create → Import a repository.**
2. Connect GitHub, give Cloudflare access to `Anshuman-Singhal/karman`, select it.
3. Settings: project name `karman` (must match `name` in `wrangler.jsonc`), build command **empty**, deploy command `npx wrangler deploy`, root directory `/`. Click **Deploy**.
4. Wait for the build log to finish (1–2 minutes). From now on, every push to `main` redeploys.
5. If the log says it couldn't attach `karman.day`, add it by hand: **karman → Settings → Domains & Routes → Add → Custom domain** → `karman.day` (and again for `www.karman.day`).
6. Visit https://karman.day. The certificate can take a few minutes on the first deploy.

Prefer the terminal? `npx wrangler login` then `npx wrangler deploy` from the project folder does the same thing.

What the stats store: one row per device per flight with the final points and which legs hit. No names, no answers. The device id is a random UUID created in the player's browser. Each flight's stats are cached at the edge for 60 seconds.

Live vs. local is automatic (`K.LIVE` in `config.js`): on karman.day the stats are on and the dev strip is hidden; on your laptop the dev strip shows and stats are off. Add `?dev` to the address (`karman.day/?dev`) to get the dev strip on the live site; a `?dev` session writes no stats, visits or events (results show clearly-labelled sample numbers instead).

**Flight deck (karman.day/dev).** One request (`/api/admin/stats`, cached 10 minutes; Refresh at most once a minute). It reads small pre-aggregated tables (`pilots`, `day_stats`, `cohort_ret`, `counters`, `payments`) that the Worker keeps itself; right after the first deploy the page catches up on history a slice per build (a few Refreshes; Tools → Data shows progress). Your Google account is left out of every number as soon as you sign in; use Tools → Data → "Leave out my plays" on each browser you play on. Optional: a `CF_API_TOKEN` secret (Account Analytics: Read) plus `CF_ACCOUNT_ID` (and `D1_DATABASE_ID`) vars make the page show today's D1 rows read against the 5M/day cap. The anonymous beacons (`/api/hit`, `/api/event`, `/api/report`) are rate-limited per IP (about 30 a minute) inside the Worker; to use Cloudflare's rate-limiting binding instead (needs Wrangler 4.36+), add `"ratelimits": [{ "name": "LIMITER", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } }]` to `wrangler.jsonc`. Catch-up work on the dashboard is capped at about 150k rows a build and 1.5M rows a UTC day.

### 1.5 Tests on every push

`.github/workflows/test.yml` runs the logic tests on every push, so a broken schedule shows up red on GitHub.

### 1.6 Smoke test the live site

- [ ] The flight number on the home screen matches today's date relative to `LAUNCH`
- [ ] Play on two devices in different time zones (or change your phone's time zone): each gets its own local-midnight flight
- [ ] Shared text reads `KÁRMÁN #n 🚀`, points, then one emoji per question
- [ ] Finish a flight, then check the API: `curl https://karman.day/api/stats/1` returns `"players":1`
- [ ] Finish on a second device: the results screen shows "Higher than …% of pilots" once two or more people have flown (the line only appears when you beat at least half)

---

## Phase 2 · Launch polish

Do this before posting anywhere public. Group chats render a link preview, and that preview is your first impression.

1. **Link preview image.** Make a 1200×630 `web/og.png` (the balloon over the dawn sky with the KÁRMÁN wordmark works) and add to `index.html`:
   ```html
   <meta property="og:image" content="https://karman.day/og.png">
   <meta name="twitter:card" content="summary_large_image">
   ```
2. **Icons.** Add `web/favicon.svg` and a 180×180 `web/apple-touch-icon.png`, linked from `<head>`.
3. **Home-screen app.** Add `web/manifest.webmanifest` (name, icons, `"display": "standalone"`, `"background_color": "#0A0D1C"`) and link it. A daily ritual lives on the home screen.
4. **Analytics.** In the Cloudflare dashboard, open **Analytics & Logs → Web Analytics** and enable it for karman.day. It's free and cookie-free, so no consent banner. This gives visits; retention (D1/D7) comes from Phase 3's result endpoint.
5. **Privacy page.** Add `web/privacy.html`: what's stored on the device (progress, streak), what analytics collects, and a contact address. Link it from the help sheet. You need this before Phase 4 anyway.
6. **Stale-file check.** Cloudflare revalidates static files, so players get new code on their next visit. If a phone ever runs old code, add a version to the script tags (`js/game.js?v=2`).
7. **Soft launch.** Share it with one group chat for 5–7 days before posting anywhere big. Watch for:
   - median score (target: 150–300 points, which is 15–30 km). Tune the point values in `scoring.js` before launch, never mid-season
   - which widths people pick (if everyone plays Wide, the risk/reward isn't landing)
   - whether people argue about their share cards. That's the signal it spreads

---

## Phase 3 · The weekly question run (fully automatic)

Content lives in two files, and nothing else: `content/questions.json` (every question ever written) and `content/schedule.json` (which 7 questions fly on which day). Both are append-only. `tools/content.mjs` is the gatekeeper: it builds `web/js/data/content.js` for the game and refuses anything that breaks a rule.

**Every week, automatically:**
1. A scheduled task opens the GitHub repo and follows `content/WEEKLY_RUN.md`: write 70 new questions, each with a source link, a scale hint and a fun fact; look each answer up again from its source in a second, independent pass; drop anything that disagrees.
2. It runs `node tools/content.mjs add content/batches/<date>.json`. The tool rejects the whole batch if anything is wrong (missing source, hint that leaks the answer, answer at the edge of its scale, a duplicate or near-duplicate of any earlier question, an id reused). Otherwise it puts **49 into the next 7 days** (mixed categories, at most 2 per category and 3 "what year" per day) and **21 into the Unlimited bank**.
3. It runs the tests, commits, and pushes. The GitHub Action deploys; players get the new content on their next visit.
4. It also reads the `reports` table / contact inbox for flagged answers and fixes confirmed mistakes in place (same id, corrected answer).

**Set it up** (once GitHub and Cloudflare are live): ask Claude to "create the KÁRMÁN weekly question run as a scheduled task", pointing it at the repo. The task's prompt is `content/WEEKLY_RUN.md`.

**Check on it any time:** `node tools/content.mjs status` prints how many days are scheduled ahead. The run aims to keep at least 14.

**Later (recommended before you're big):** serve each day's questions from the Worker only once that day starts (a `GET /api/day/:n` route), so nobody can read tomorrow's answers in the page source. Today the whole schedule ships in `content.js`, which is fine for a soft launch.

---

## Phase 4 · Unlimited ($5.99), unlock links, Google sign-in

The code is already in place: `web/js/access.js` (browser) and the `/api/checkout`, `/api/stripe`, `/api/me`, `/api/play`, `/api/unlock/:code` routes in `api/src/index.js`. You only add keys and flip one switch. The daily flight, streaks and sharing stay free.

### 4.1 Database tables
Nothing to do: the Worker creates `users`, `unlock_codes`, `plays` and `reports` itself on first use.

### 4.2 Google sign-in (free)
1. console.cloud.google.com → create a project "KÁRMÁN" → **APIs & Services → OAuth consent screen**: External, app name KÁRMÁN, your email, add `karman.day` as an authorised domain, and link `https://karman.day/privacy.html` and `/terms.html`.
2. **Credentials → Create credentials → OAuth client ID → Web application.** Authorised JavaScript origins: `https://karman.day`. Copy the **Client ID**.
3. Put it in two places: `GOOGLE_CLIENT_ID` in `web/js/config.js`, and as a plain var in `wrangler.jsonc` (`"vars": { "GOOGLE_CLIENT_ID": "…", "PRICE_CENTS": 599 }`).

### 4.3 Stripe (one-time $5.99)
1. stripe.com → finish account verification (bank, tax details). Turn on **Stripe Tax** if you want sales tax handled.
2. **Developers → API keys**: copy the secret key. **Developers → Webhooks → Add endpoint**: `https://karman.day/api/stripe`, events `checkout.session.completed` and `charge.refunded`. Copy its signing secret.
3. Save the secrets (they never go in the code):
```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put SESSION_SECRET      # any long random string
```
4. In `web/js/config.js` set `PAYMENTS: true`, then deploy. Test first with Stripe's test keys and card `4242 4242 4242 4242`.

### 4.4 Refunds (your rule)
Refundable only if the buyer hasn't started an Unlimited or archive flight since paying. To check a request, use the email they bought with:
```bash
npx wrangler d1 execute karman --remote --command "SELECT u.email, u.paid_at, (SELECT COUNT(*) FROM plays p WHERE p.sub = u.sub AND p.at > u.paid_at) AS flights_since FROM users u WHERE u.email = 'them@example.com'"
```
`flights_since = 0` → refund it in the Stripe dashboard. The webhook removes their Unlimited automatically.

### 4.5 Unlock links (give access without payment, take it back any time)
Easiest: karman.day/dev → **Free passes** → type who it's for → **Generate pass** → Copy link / Copy message. The same list shows whether each pass has been used and switches it off or on.

By hand: create a code, then send the link `https://karman.day/?unlock=CODE`:
```bash
npx wrangler d1 execute karman --remote --command "INSERT INTO unlock_codes (code, note) VALUES ('PILOT-ANSH-01', 'for Sam')"
```
Revoke it (the player loses Unlimited the next time they open the game, within 6 hours):
```bash
npx wrangler d1 execute karman --remote --command "UPDATE unlock_codes SET active = 0 WHERE code = 'PILOT-ANSH-01'"
```
One code can be shared by many people (e.g. a classroom) or made per person; per person lets you revoke one without affecting others. While testing offline (`DEV: true`, `PAYMENTS: false`), the code `PILOT-TEST` works and "Unlock" simulates a purchase.

### 4.6 Reported answers
Players' "Report this answer" taps land in the `reports` table. The weekly content run reads it; you can also look:
```bash
npx wrangler d1 execute karman --remote --command "SELECT qid, COUNT(*) AS reports FROM reports GROUP BY qid ORDER BY reports DESC LIMIT 20"
```

---

## Updating the game without breaking anyone's progress

Players' progress lives in their browser under one key (`karman:v1`), plus purchases in the database. Updates are safe as long as you keep these rules:

1. **Add, never rename or delete** fields in the save. New fields get a default in `fresh()` in `storage.js`; old saves are filled in by `migrate()` on load.
2. **Never change or reuse a question ID.** Records point at questions by ID. Fix a wrong answer by editing the fact under the same ID.
3. **Don't change the schedule of days that have already happened** (the schedule is append-only), so the archive and everyone's history stay true.
4. **Lock the scoring after launch.** Changing points per width or legs per flight re-scales everyone's past altitudes and makes stats incomparable. If you must, do it at a season boundary.
5. **Deploys are atomic.** A player mid-flight keeps their flight: it's saved after every answer and resumes after a reload.
6. Run `node tests/logic.test.js` and `node tests/worker.test.mjs` before every deploy (the GitHub Action can do this automatically and block a bad deploy).

---

## Adding questions by hand

1. Write them in a JSON file (copy the shape of any entry in `content/questions.json`; leave out `id`, `pool` and `added`, the tool fills those in). Every question needs a `source` URL.
2. `node tools/content.mjs add my-batch.json` schedules 70% into upcoming days and banks the rest; add `--bank` to put them all into Unlimited.
3. If it prints ✗ lines, fix those and run it again. Nothing is written until the whole batch passes.
4. Never edit a question's id, and never change the schedule for a day that has already happened. Fixing a wrong answer or a typo under the same id is fine.

---

## Launch-day checklist

- [ ] The correct `LAUNCH` date in `config.js` (DEV and STATS switch themselves)
- [ ] Tests pass and the GitHub Action is green
- [ ] At least 30 days of questions ahead (factory buffer or hand seasons)
- [ ] Link preview image shows correctly when you paste karman.day into a chat
- [ ] Privacy page live
- [ ] You've played today's flight on the live site from your phone
- [ ] Your own share card is ready to post first

## Sources

- [Cloudflare Registrar TLD policies](https://www.cloudflare.com/tld-policies/) (lists `.day`, Google Registry)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers vs. Pages compatibility matrix](https://developers.cloudflare.com/workers/static-assets/compatibility-matrix/)
- [Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)


## Thank-you emails to buyers (optional, recommended)
Every buyer gets one thank-you email from hello@karman.day (replies land in your inbox via Email Routing). Until the key below is set, nothing is sent; buyers from before that can be thanked later from karman.day/dev → Thank-you emails.
1. Make a free account at resend.com (3,000 emails/month free).
2. Domains → Add domain → `karman.day`. Resend shows a few DNS records (an MX + TXT on a `send.` subdomain and a DKIM TXT). Add them in Cloudflare → karman.day → DNS (or use Resend's one-click Cloudflare button). They don't touch your existing Email Routing for hello@.
3. Wait for "Verified", then API Keys → Create API key (permission: Sending access, domain: karman.day).
4. Cloudflare → Workers & Pages → karman → Settings → Variables and Secrets → Add → type **Secret**, name `RESEND_API_KEY`, paste the key. Deploy.
5. Open karman.day/dev → Tools → Thank-you emails: it should say On, with a log of the latest sends and a "Send test to me" button. The dashboard warns if a buyer is still unthanked a day after paying.
Also worth turning on: Stripe → Settings → Customer emails → "Successful payments", so buyers get a receipt.
6. Optional, to REPLY as hello@karman.day from Gmail: Gmail → Settings → Accounts and Import → "Send mail as" → Add another email address → name KÁRMÁN, address hello@karman.day, untick "Treat as an alias" → SMTP server smtp.resend.com, port 465, SSL, username `resend`, password = a Resend API key → Gmail emails a code to hello@karman.day, which Email Routing forwards to you; paste it. Then pick "From: hello@karman.day" when replying.
