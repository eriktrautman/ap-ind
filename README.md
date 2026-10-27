# ap-ind

Election-night app for a broadcast about independent candidates: an AP poller, a producer control room, an on-air ticker and nineteen full-screen graphics, all on the AP Elections API. One codebase runs two ways, with the same code in both: deployed on Vercel (ap-ind.vercel.app) or as a single Node process on any machine.

Documents: [technical spec](docs/spec.html) · [graphics data options](docs/graphics-data-options.html) · [control room build plan](docs/producer-plan.html) (also published at https://ap-ind.vercel.app).

## Run it on your laptop

You need Node 24 or newer (`node -v`), the repo, and one key from the producer. Nothing else: no Vercel account, no database, no build tools.

```sh
git clone https://github.com/eriktrautman/ap-ind.git
cd ap-ind/studio
npm install
cp .env.example .env
```

Open `studio/.env` in a text editor and fill in two lines:

```
AP_API_KEY=the key you were sent
STUDIO_PASSWORD=anything you like   # the control room's sign-in password on your machine
```

Leave `STORE_DIR=./data` as it is. Then:

```sh
npm start
```

and open http://localhost:3000/studio. Sign in with the password you chose. The first poll takes about ten seconds; after that the status bar turns green and the app polls AP once a minute. The ticker is at http://localhost:3000/ticker and the graphics under http://localhost:3000/g/ (the control room links to every one). Stop it with Ctrl-C; `npm start` again picks up where it left off, because the data files are in `studio/data/`.

What you will be sent, and what it is for:

| Key | Needed to run locally? | What it does |
|---|---|---|
| `AP_API_KEY` | **Yes** | Reads results from the AP Elections API. Without it nothing polls. AP allows ten requests a minute per key, and a local run uses about two, so several laptops can share one key. |
| `STUDIO_PASSWORD` | You choose it yourself | Password for `/studio` on your machine only. Not a shared secret. |
| `BLOB_READ_WRITE_TOKEN` | No | Only if your laptop should write into the production data store (standing in for the Vercel cron). Then also delete the `STORE_DIR` line. Ask before using it: pause, test/live and every publish would then change what is on air. |
| `CRON_SECRET` | No | Vercel only; lets the cron call the poll function. Unused locally. |

`AP_RESULTS_TYPE=t` in `.env` means AP's simulated test election; change it to `l` for live results on election night (the control room's Test/Live switch does the same without a restart). The key must never be committed or put in a URL; `.env` is gitignored.

Everything under `npm start` is the same code that runs on ap-ind.vercel.app: the static site, the four API functions in `api/`, and the poller in `lib/poll.js`. `scripts/serve.mjs` is the only file that exists for local use; it stands in for Vercel's static hosting, function routing and cron. `POLL_SECONDS` changes the interval; `node --env-file=.env scripts/serve.mjs --no-poll --port 4000` serves without polling.

## How it fits together

The broadcast pages live in `studio/` (panel, ticker, poller functions) and `public/g/` (graphics), deployed together as the ap-ind Vercel project (ap-ind.vercel.app, which also serves these docs). No server of our own: the poller writes JSON to Vercel Blob (`/api/poll`, Vercel Cron once a minute; the cron's request is accepted only when `CRON_SECRET` is set on the project, so a fresh project polls nothing until its env vars are in), the pages poll those files.

| Path on ap-ind.vercel.app | Purpose |
|---|---|
| `/studio` | Producer control room (shared password, `STUDIO_PASSWORD`). Status bar, Default / Global / Local state selector, four sections: Ticker, Race Detail, Movement Overview, Full Catalog. |
| `/ticker` | On-air ticker, 1920×1080, transparent. `?bg=black` or `?bg=green` for keying. Always reads the Global state. |
| `/g/<page>?id=<raceID>` | One graphic per URL at 1920×1080: `race` (B5), `county` (B6), `margin` (B7), `outstanding` (B8), `rcv` (B9), `then-now` (B10), `swing` (B13); movement: `board` (C1), `ind-vote` (C6), `polls` (C7), `senate-map` (D1), `house-map` (D2), `bop-senate` (D3), `bop-house` (D4), `key-races` (D5), `zoom` (D6), `tiles` (D7), `house-pv` (D10), `too-close` (D11). `?bg=` as above; `?src=default|global|local` picks the producer state. |
| `/producer-plan` | Build plan and burndown for the control room. |

**State model.** One schema (`studio/lib/control.js`, served at `/g/control.js`): ticker races, AP Call highlight, manual items, idle text, featured races, featured charts, movement charts, key races, context lines. Three sources: **Default** is shipped in code and read-only; **Global** is `producer.json` in Blob, what air uses, written only through the publish dialog (lists every change, the last publish by anyone, and warns if someone else published since you loaded); **Local** is this browser's localStorage, saved as you edit, never on air unless you publish it to Global. A graphic opened without `?src=` uses Global. The ticker re-reads Global every 5 s and graphics every 10 s, so a publish is on air within that.

**Graphics data.** `public/g/feed.js` probes for the local WebSocket server and otherwise polls the Blob files (`index.json` every 15 s, `status.json` every 30 s, `state/<ST>.json` on demand, `history.json` for the margin tracker, `trend.json` for the balance-of-power pages). Static data committed to the repo: `config/baseline-2024-pres.json` (B13), `config/baseline-federal.json` (B10, C6, D10; 2024 national totals and the last contest for each featured seat, from `scripts/fetch-baseline-federal.mjs`), `config/polls.json` (C7; every row carries a source link).

**Thumbnails.** Every card in the control room runs the real page in a scaled iframe. At most 12 are live at once, featured sections first; cards load when scrolled into view and unload when scrolled away; Full Catalog cards show numbers until you press Preview. **Open 1920×1080** opens the graphic in a new tab with the chosen background and the current state source.

Poller controls (AP poller card): **Poll now**, **Poll now + reset caches**, **Pause/Resume polling**, **Test/Live**. These write `settings.json`, read at the start of every run, so none need a redeploy. `status.json` is written on every run, including failures, with a plain-English diagnosis shown in the status bar.

The Watch Party project (`watch-party/`, ind-watch-party.vercel.app) is a pure reader of the same Blob files.

Functions: `GET/POST/DELETE /api/login`, `GET/PUT /api/producer` (partial bodies merge over the stored state; every field validated), `GET/PUT /api/settings`, `GET|POST /api/poll`. Env vars on the Vercel project: `AP_API_KEY`, `AP_RESULTS_TYPE`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `STUDIO_PASSWORD`.

Checking pages without a browser: `node scripts/browse.mjs "http://localhost:3000/g/county.html?id=28594&bg=black" --shot out.png` renders a page in headless Chrome, prints console errors and failed requests, and can run `--eval` snippets. `npm run poll` runs the poll loop alone (no web server) for a laptop standing in for the cron.

## Data

- `config/candidates.json`: curated bios for the featured races, keyed by AP `candidateID`.
- `config/photos.json`: photo manifest for every candidate in every race: source, licence, confidence, and the CDN URL. Images are not in the repository.
- `config/baseline-2024-pres.json`: 2024 presidential result by voting area for the featured states, from AP (B13).
- `config/baseline-federal.json`: 2024 national Senate and House totals by party and the last contest for each featured seat, from AP (B10, C6, D10).
- `config/polls.json`: public polls for the featured races with a source on every row (C7).
- `watch-party/public/geo/<ST>.json`: map geometry per state, matching AP's reporting units (counties; towns in New England; House districts in Alaska). Built by `scripts/build-geo.mjs`.

## Historical results (analytics)

`scripts/fetch-history.mjs` downloads AP's final results for a past election date into `data/ap-history.sqlite` (gitignored), one row per candidate per reporting unit, for SQL analytics:

```sh
node --env-file=.env scripts/fetch-history.mjs 2024-11-05                 # federal races (P, S, H), state + county level
node --env-file=.env scripts/fetch-history.mjs 2022-11-08 2020-11-03      # several dates in one run
node --env-file=.env scripts/fetch-history.mjs 2024-11-05 --offices G,S   # other offices
node --env-file=.env scripts/fetch-history.mjs 2024-11-05 --dry-run       # show the planned requests
node --env-file=.env scripts/fetch-history.mjs --all --states auto        # every date AP lists (back to 2012): generals,
                                                                          # primaries, specials, runoffs; county level only
                                                                          # for states that had a federal race that day
```

It is kind to the key: AP's quota is 10 requests per minute (`x-electionsapi-q-minute-*` headers), the script sends one request every 7 s and pauses when the bucket is nearly empty, and every response is cached in `raw_responses`, so re-running a date costs no requests (`--refresh` re-downloads, `--reparse` rebuilds the tables from the cache). One election date is 52 requests (one state-level call plus one county-level call per state), about six minutes.

Tables, all keyed by `(election_date, state_postal, race_id)` because AP race ids are unique only within a state (the presidential race is id `0` in every state):

| Table / view | One row per |
|---|---|
| `races` | race: office, seat, district, type, call status, uncontested, ranked choice, flipped seat |
| `reporting_units` | race × unit: national (`ru_level` 0), state (1), county or New England town (2), with FIPS, precincts, total votes |
| `results` | race × unit × candidate: votes, percentage of the unit, AP winner flag, RCV rounds |
| `candidates` | candidate per election: names, party, `pol_id` (stable across elections) |
| `ap_elections` | election date AP exposes to this key, with live/test/certified flags |
| `v_race_results` | state- or district-wide result per candidate, with names |
| `v_county_results` | county/town result per candidate, with names |
| `v_race_summary` | race: leader, runner-up, margin in votes and points |

```sql
-- Non-major-party candidates who cleared 5% in a federal race
SELECT election_date, state_postal, office_id, seat_name, last, party, vote_pct
FROM v_race_results WHERE party NOT IN ('Dem','GOP') AND vote_pct >= 5 ORDER BY vote_pct DESC;

-- County swing for a state between two elections
SELECT a.fips, a.ru_name, a.vote_pct AS gop_2020, b.vote_pct AS gop_2024, b.vote_pct - a.vote_pct AS swing
FROM v_county_results a JOIN v_county_results b USING (state_postal, fips, party)
WHERE a.election_date='2020-11-03' AND b.election_date='2024-11-05' AND a.race_id='0' AND b.race_id='0'  -- statewide presidential
  AND a.state_postal='NE' AND party='GOP' ORDER BY swing;
```

## Photos

Sources, in order: official congressional portraits (public domain), hand-verified photos for the featured races, Ballotpedia for the rest. Each photo records its source and an automatic confidence; low-confidence photos are withheld until a person checks them at `/photos.html`.

Photos are served from the project's own CDN (Vercel Blob) under a random path prefix, never hotlinked. Pipeline:

```sh
python3 -I scripts/fetch-candidate-photos.py <work-dir>     # crawl sources into <work-dir>/raw
python3 -I scripts/build-photo-index.py <work-dir>          # resize into public/photos/, write config/photos.json
cd watch-party && node --env-file=.env.blob scripts/upload-photos.mjs   # push to the CDN, record URLs in the manifest
cd watch-party && node scripts/sync-photos.mjs              # pull the set onto a machine (studio server) for local serving
```

The pages read the CDN URLs from the manifest (`config/photos.json`); `public/photos/` is the resized local set the pipeline produces.

## Watch Party

`watch-party/` is a separate Vercel project (https://ind-watch-party.vercel.app): static pages that read the same Blob files the ap-ind poller writes. It covers every race the AP key returns (Senate, House, governor, other statewide offices, ballot measures, big-city mayors; not state legislatures). It has no poller or secrets of its own.

## Secrets

The AP key, the Blob token and the studio password live only in `studio/.env` (gitignored) or the Vercel project's environment variables. The key is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Deploying

Pushing `main` deploys the ap-ind Vercel project (root directory `studio/`). `vercel build && vercel deploy --prebuilt` from the repo root makes a preview. The docs in `docs/` and the graphics in `public/g/` are copied into the build.
