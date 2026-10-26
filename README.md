# ap-ind

Middleware between the AP Elections API and broadcast graphics for an election-night program about independent candidates: a live ticker, full-screen result graphics, a candidate index, and a control API.

Documents: [technical spec](docs/spec.html) · [graphics data options](docs/graphics-data-options.html) (also published at https://ap-ind.vercel.app by the `studio/` deployment).

## Run

Requires Node 24 or newer. No build step; no native dependencies.

```sh
git clone https://github.com/eriktrautman/ap-ind.git && cd ap-ind
npm install
cp .env.example .env        # set AP_API_KEY
npm run dev                 # http://127.0.0.1:3000
```

`.env` options: `AP_RESULTS_TYPE` (`t` test data, `l` live), `AP_ELECTION_DATE`, `AP_POLL_INTERVAL_SECONDS` (default 20), `PORT`, `HOST`, `DB_PATH`.

The server polls AP on the interval, stores every raw response and a normalized snapshot in `data/ap-ind.sqlite`, emits events from the diffs, and pushes updates to connected pages over WebSocket.

## Pages

| Path | Purpose |
|---|---|
| `/` | Status and links |
| `/g/ticker.html` | Lower-third crawl, 1920×1080. Transparent background; add `?bg=black` or `?bg=green` for keying |
| `/g/race.html?id=<raceID>` | Full-screen race result. Race ids from `/api/races` |
| `/candidates.html` | Candidate index for the featured races: bios, verified photos, live numbers |
| `/docs/` | Spec and graphics data options |

Any graphic accepts `?demo=1` to run on an embedded sample snapshot without the server.

## API

`GET /api/status` · `GET /api/snapshot` · `GET /api/races` · `GET /api/races/:id` · `GET /api/events` · `GET /api/ticker` · `GET /api/candidates` · `GET /healthz` · WebSocket `/ws`

Producer controls (no auth yet; bind to localhost or put behind a password): `PUT /api/producer` `{pinnedRaceIds, manualItems, eventWindowMinutes}` · `POST /api/producer/manual` `{text}` · `POST /api/poll`

## Studio and on-air ticker (ap-ind on Vercel)

The broadcast ticker and its producer panel live in `studio/`, deployed as the ap-ind Vercel project (ap-ind.vercel.app, which also serves these docs), with no server of our own: the poller writes JSON to Vercel Blob once a minute (Vercel Cron), the pages poll those files.

| Path on ap-ind.vercel.app | Purpose |
|---|---|
| `/studio` | Producer panel (shared password, `STUDIO_PASSWORD` env var). Poller status and controls; pick and order the races on the ticker, add manual items, preview, publish. |
| `/ticker` | On-air ticker, 1920×1080, transparent. `?bg=black` or `?bg=green` for keying. Open it in its own tab or as the switcher's browser input; it is never changed from the panel, only its content is. |

The ticker polls producer state every 5 s and results every 15 s; a publish reaches air within about 30 s (Blob propagation). With nothing pinned it shows the featured races; with none of those it crawls the idle text. Fetch failures keep the last good crawl on screen. A `TEST DATA` badge appears whenever the poller is on AP test data.

Poller controls in the panel: **Poll now**, **Poll now + reset caches**, **Pause/Resume polling**, and the **Test/Live** results switch. These write `settings.json` in Blob, which the poller reads at the start of every run, so none of them need a redeploy. `status.json` is written on every run, including failures, with a plain-English diagnosis and what to do.

The Watch Party project (`watch-party/`, ind-watch-party.vercel.app) is now a pure reader of the same Blob files: static pages, no functions, no secrets.

Functions: `GET/POST /api/login`, `GET/PUT /api/producer`, `GET/PUT /api/settings`, `GET|POST /api/poll` (cron bearer or studio cookie). Env vars on the Vercel project: `AP_API_KEY`, `AP_RESULTS_TYPE`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `STUDIO_PASSWORD`.

Local fallback (same Blob store, same pages):

```sh
cd studio
# .env needs AP_API_KEY, BLOB_READ_WRITE_TOKEN and STUDIO_PASSWORD
npm run build && vercel dev --listen 3100   # studio at http://localhost:3100/studio, ticker at /ticker, docs at /
npm run poll               # poll AP every 60 s from this machine if the Vercel cron is not running
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

The AP key lives only in `.env` (gitignored) and is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Docs site

`vercel deploy --prod` publishes `docs/` (plus a copy of `public/g` for the demo-mode graphics) to https://ap-ind.vercel.app. The live server does not run on Vercel.
