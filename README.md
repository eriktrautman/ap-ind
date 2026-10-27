# ap-ind

Election-night app for a broadcast about independent candidates: an AP poller, a producer control room, an on-air ticker and nineteen full-screen graphics, all on the AP Elections API. One codebase runs two ways, with the same code in both: deployed on Vercel (ap-ind.vercel.app) or as a single Node process on any machine.

Documents: [technical spec](docs/spec.html) · [graphics data options](docs/graphics-data-options.html) · [control room build plan](docs/producer-plan.html) (also published at https://ap-ind.vercel.app).

## Run

Requires Node 24 or newer. No native dependencies, no Vercel account.

```sh
git clone https://github.com/eriktrautman/ap-ind.git && cd ap-ind/studio
npm install
cp .env.example .env        # set AP_API_KEY and STUDIO_PASSWORD; STORE_DIR=./data keeps everything local
npm start                   # http://localhost:3000  control room /studio · ticker /ticker · graphics /g/
```

`npm start` builds the static site into `dist/`, serves it, mounts the four API functions from `api/`, and runs the poller every 60 s (`POLL_SECONDS` to change, `--no-poll` to skip). With `STORE_DIR` set, the poller writes its JSON files to that folder and nothing leaves the machine except AP requests. With `BLOB_READ_WRITE_TOKEN` set instead (and `STORE_DIR` unset), it writes to the deployment's Vercel Blob store, so a laptop can stand in for the cron. `npm run serve` skips the build.

## Control room, graphics and on-air ticker (ap-ind on Vercel)

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

Local preview of the deployment (reads the live Blob data, refuses writes):

```sh
cd studio
npm run build && DEV_AUTHED=1 node scripts/dev.mjs 4174   # control room at http://localhost:4174/studio, graphics under /g/
node scripts/browse.mjs "http://localhost:4174/g/county.html?id=28594&feed=blob&bg=black" --shot out.png   # headless render check
npm run poll                                                # poll AP every 60 s from this machine if the cron is not running
```

## Data

- `config/candidates.json`: curated bios for the featured races, keyed by AP `candidateID`.
- `config/photos.json`: photo manifest for every candidate in every race: source, licence, confidence, and the CDN URL. Images are not in the repository.
- `config/featured.json`: candidate ids to feature regardless of party code. Any non-Democrat, non-Republican candidate is featured by default.
- `config/baseline-2024-pres.json`: 2024 presidential result by voting area for the featured states, from AP.
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

The broadcast server serves photos from `public/photos/` so air does not depend on the CDN; the Watch Party reads the CDN URLs from the manifest.

## Watch Party

`watch-party/` is a separate Vercel project (https://ind-watch-party.vercel.app): a poller writes JSON snapshots to Vercel Blob and static pages read them. It covers every race the AP key returns (Senate, House, governor, other statewide offices, ballot measures, big-city mayors; not state legislatures). Run the poller locally with `cd watch-party && node --env-file=.env.blob --env-file=../.env scripts/run-local.mjs`.

## Secrets

The AP key, the Blob token and the studio password live only in `studio/.env` (gitignored) or the Vercel project's environment variables. The key is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Deploying

Pushing `main` deploys the ap-ind Vercel project (root directory `studio/`). `vercel build && vercel deploy --prebuilt` from the repo root makes a preview. The docs in `docs/` and the graphics in `public/g/` are copied into the build.
