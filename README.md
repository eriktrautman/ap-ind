# ap-ind

Election-night app for a broadcast about independent candidates: an AP poller, a producer control room, a ticker and nineteen full-screen graphics, all on the AP Elections API. One codebase runs two ways, with the same code in both: deployed on Vercel (ap-ind.vercel.app) or as a single Node process on any machine.

Documents: [technical spec](docs/spec.html) · [graphics data options](docs/graphics-data-options.html) · [control room build plan](docs/producer-plan.html) (also published at https://ap-ind.vercel.app).

## TL;DR: a new machine

1. Install Node 24 or newer (`node -v`) and clone the repo. No other tools, no database server, no Vercel account.
2. `cd studio && npm install && cp .env.example .env`, then put the AP key on the `AP_API_KEY=` line and choose any `STUDIO_PASSWORD`. The key is the one secret; it lives only in `studio/.env`, which is gitignored.
3. `npm start` in `studio/` and open http://localhost:3000/studio. That is the control room; the ticker is `/ticker` and the graphics are under `/g/`.
4. **Historical results database** (for SQL analytics, not needed for the broadcast): from the repo root run `npm run history -- --all --states auto`. It makes about 1,200 AP requests at one every 10 seconds, so roughly 3.5 hours, and writes `data/ap-history.sqlite` (about 220 MB). The file is gitignored and is never in the repo, so every machine regenerates it; the run can be stopped and restarted at any point without losing work. Everything a person or a Claude needs for this is under [Historical results](#historical-results-analytics).

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
STUDIO_TEST_PASSWORD=test1234       # optional: the rehearsal password, flagged in the control room
```

Leave `STORE_DIR=./data` as it is. Then:

```sh
npm start
```

and open http://localhost:3000/studio. Sign in with the password you chose. The first poll takes about ten seconds; after that the status bar turns green and the app polls AP once a minute. The ticker is at http://localhost:3000/ticker and the graphics under http://localhost:3000/g/ (the control room links to every one). Stop it with Ctrl-C; `npm start` again picks up where it left off, because the data files are in `studio/data/`.

What you will be sent, and what it is for:

| Key | Needed to run locally? | What it does |
|---|---|---|
| `AP_API_KEY` | **Yes** | Reads results from the AP Elections API. Without it nothing polls. AP allows ten requests a minute per key. A polling run (deployment or laptop) uses 6 or 7 a minute: the national feed plus a tenth of the states' counties, each state every ten minutes. The deployment already polls, so a laptop that only needs the pages should serve without polling (`node --env-file=.env scripts/serve.mjs --no-poll`) and read the shared store; two pollers on one key exceed the limit. |
| `STUDIO_PASSWORD` | You choose it yourself | Password for `/studio` on your machine only. Not a shared secret. |
| `STUDIO_TEST_PASSWORD` | Optional | A second, easy password for rehearsals (`test1234` until the night). Signing in with it shows a purple TEST LOGIN banner. |
| `BLOB_READ_WRITE_TOKEN` | No | Only if your laptop should write into the production data store (standing in for the Vercel cron). Then also delete the `STORE_DIR` line. Ask before using it: pause, test/live and every publish would then change production. |
| `CRON_SECRET` | No | Vercel only; lets the cron call the poll function. Unused locally. |

`AP_RESULTS_TYPE=t` in `.env` means AP's simulated test election; change it to `l` for live results on election night (the control room's Test/Live switch does the same without a restart). The key must never be committed or put in a URL; `.env` is gitignored.

**Two tickers and two screens, one publish.** The control room is a workbench saved in that browser. Its **Ticker Builder** (races and order, AP Call highlight, manual items, idle text) is the one thing that can be published, and it goes to one place: the **Live Ticker** at the fixed address `/ticker`, which picks up new parameters within 5 seconds at the next item boundary without restarting the crawl. **Publish** replaces the live ticker's parameters with the builder's after listing every change and warning if someone else published since you last looked; **Pull** copies the live ticker's parameters into the builder. The builder's own address (Copy URL) is a ticker that carries its parameters and never changes. Everything else on the page (featured races, chart lists, persistent elements) organises that browser's view and is never published; **Restore defaults** resets the page, not the live ticker. The row under the builder always says where you stand ("Builder matches the live ticker" or "differs: 3 changes").

On a laptop, production is whatever `GLOBAL` in `.env` says:

- `GLOBAL=https://ap-ind.vercel.app` (the default): the deployment's ticker is the Live Ticker. Pull works with nothing more. Publish needs `GLOBAL_PASSWORD`, the deployment's studio password; without it the builder row says **pull only** and the Publish button explains what to add. The laptop's own live ticker preview reads the deployment too.
- `GLOBAL=self`: this machine's ticker is the Live Ticker. Its own outputs read its own store, and publish writes there. This is the standby setup for the night the deployment is down. A store that has never been published to starts from a copy of the deployment's live ticker, so a fresh standby begins where production was.

Results data never needs copying: the laptop polls AP itself.

**If the deployment is down** (ticker, graphics and control room all gone): on the standby laptop set `GLOBAL=self`, start it, open http://laptop:3000/studio, publish the ticker builder (or restore defaults and rebuild it), and change the hostname on the switcher's browser inputs from `ap-ind.vercel.app` to the laptop. Every path is the same. If only the cron has stopped while the pages are fine, a laptop with the Blob token runs `npm run poll` instead and nothing else changes.

Everything under `npm start` is the same code that runs on ap-ind.vercel.app: the static site, the four API functions in `api/`, and the poller in `lib/poll.js`. `scripts/serve.mjs` is the only file that exists for local use; it stands in for Vercel's static hosting, function routing and cron. `POLL_SECONDS` changes the interval; `node --env-file=.env scripts/serve.mjs --no-poll --port 4000` serves without polling.

## How it fits together

The broadcast pages live in `studio/` (panel, ticker, poller functions) and `public/g/` (graphics), deployed together as the ap-ind Vercel project (ap-ind.vercel.app, which also serves these docs). No server of our own: the poller writes JSON to Vercel Blob (`/api/poll`, Vercel Cron once a minute; the cron's request is accepted only when `CRON_SECRET` is set on the project, so a fresh project polls nothing until its env vars are in), the pages poll those files.

| Path on ap-ind.vercel.app | Purpose |
|---|---|
| `/studio` | Producer control room (shared password, `STUDIO_PASSWORD`). Status bar, Default / Global / Local state selector, four sections: Ticker, Race Detail, Movement Overview, Full Catalog. |
| `/ticker` | The ticker, 1920×1080, transparent. `?bg=black` or `?bg=green` for keying. With no other parameters it is the **Live Ticker**: the one fixed address, crawling whatever was last published, re-read every 5 seconds and applied at the next item boundary. **Built from its address instead**: `/ticker?bg=black&opacity=60&races=NE-SEN,MT-SEN,ID-SEN&calls=0&item=Polls close at 7&item=…&idle=Welcome` crawls exactly those races (race ids, in order; AP ids also work) and items with no publish involved; `calls=1|0` is the yellow AP Call highlight; an empty `races` means the featured races. The control room shows the address for the ticker on the page with a Copy URL button, and every chart card has one too. |
| `/live-screen-one`, `/live-screen-two` | **Live Screens**: two fixed addresses, each showing whatever chart was last published to it (a chart id, a race or state, and the chart's own parameters). The page re-reads the published definition every 5 s and cross-fades to a new chart, so the switcher points at one address forever. `?bg=`, `?opacity=` as elsewhere. The control room's Live Screens section builds a draft on the left (chart, race, state and parameter selectors), and Publish moves it to the on-air screen on the right; Pull copies on-air back into the draft. |
| `/g/<chart id>?bg=…&opacity=…&race=<race id>` | **The semantic address for any graphic**, e.g. `/g/B5?bg=black&opacity=60&race=NE-SEN` or `/g/D9?state=MT`. Chart ids are the lookbook ids (B5, D4; case does not matter), race ids are AP's labels (`NE-SEN`, `CA-6`, `AK-GOV`, `AK-MEASURE-3`; an AP race id also works), shown on every card and row in the control room (hover for the id). Display parameters go first (`bg`, `opacity`, `fit`, `src`), then the data. `cand=`, `a=` and `b=` take a candidate's last name or AP id. An address that does not fully specify its chart never shows a graphic: an unknown chart id, a race chart with no race, a race the feed does not have, or a state chart with no state puts up a red error card instead, listing the parameters received, what that chart needs, what is missing and a corrected example, so a bad address is obvious on the monitor and never mistaken for data. The address resolves (through `/g/chart.html`) to the page below and anything else in it is passed through. |
| `/g/<page>?id=<raceID>` | The page behind each chart id. Opened directly at the top level it forwards itself to the chart-id address above (so an old-style address saved somewhere turns into the one style); the router draws it inside a frame. The pages: `race` (B5), `county` (B6), `margin` (B7), `outstanding` (B8), `rcv` (B9), `then-now` (B10), `swing` (B13), `head-to-head` (B14); movement: `board` (C1), `ind-vote` (C6), `polls` (C7), `senate-map` (D1), `house-map` (D2), `bop-senate` (D3), `bop-house` (D4), `key-races` (D5), `zoom` (D6), `tiles` (D7), `house-pv` (D10), `too-close` (D11). `?bg=` as above; `?opacity=10..100` paints the chart panel at that percent opacity for layering over video (each control room section has its own Background and Opacity dropdowns, each live draft its own BG, and a top Chart Display Settings block applies one pair to all); `?src=default|global|local` picks the producer state. |
| `/producer-plan` | Build plan and burndown for the control room. |

**State model.** One schema (`studio/lib/control.js`, served at `/g/control.js`). The only shared state is what gets published: the Live Ticker's four fields (ticker races, AP Call highlight, manual items, idle text) and the two Live Screen definitions (`screenA`, `screenB`: chart id, race, state, parameters), stored as `producer.json` and written only by a publish; `/ticker` re-reads them every 5 s as the static file `/data/producer.json` through the CDN (one copy per 5 s bucket serves every open ticker and graphic, so readers cost no function invocations); the control room's Pull and conflict check use the uncached `GET /api/producer`. Every other field a page uses (featured races, key races, context lines) comes from the page's own address (`races=`, `context=`) or the shipped defaults; `watchState()` composes the two and nothing else is ever published. The control room's working copy lives in the browser (localStorage). `?src=local` on the ticker shows this browser's builder, `?src=default` the shipped defaults.

**When the domain changes.** Point the new domain at the Vercel project and everything that runs there follows it on its own: the control room, dialogs and status bar name the site by `location.host`, and the ticker and graphics use relative paths. Two places hold the address as text for laptops: the default in `studio/scripts/serve.mjs` (`DEPLOYMENT`) and the `GLOBAL` line in `studio/.env.example`; change both, and any laptop's own `.env`. The README and spec mention ap-ind.vercel.app in prose only.

**Every time carries its zone.** Any clock shown on air or in the control room (Updated stamps, call times, poll closings, AP report times) is written in Eastern time with the suffix ET, never EST or EDT and never the browser's local zone. The graphics get this from `clock()` and `clockS()` in `public/g/feed.js`; `?tz=CT` (or MT, PT, AKT, HT) switches one page. New pages use the helpers rather than formatting a Date themselves.

**Chart ids are fixed.** The ids in the lookbook and the control room (B5, C1, D7, …) have been shared and are used in rundowns and by other people, so from 27 October 2026 an id never changes meaning and is never reused. To retire a chart, keep its entry in `studio/lib/control.js` and set `retired: true`: the control room greys it out with a placeholder, refuses to add it, and drops it from existing selections. A new chart gets a new id at the end of its series (B14, C10, D12, …).

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

`scripts/fetch-history.mjs` downloads AP's final results for past election dates into `data/ap-history.sqlite`, one row per candidate per reporting unit, for SQL analytics. The database is gitignored (`data/`, `*.sqlite`), so it exists only on machines that have run the script.

### Regenerating the database on another machine

What has to be true before starting:

- Node 24 or newer. The script uses only built-in modules (`node:sqlite`, `node:zlib`), so no `npm install` is needed for it.
- `studio/.env` exists with `AP_API_KEY=` filled in (the same key the app uses; copy `studio/.env.example` if the file is missing). The script reads nothing else from the file.
- Nothing else is hammering the key. AP allows 10 requests a minute per key, shared by everything using it. The script sends one every 10 seconds (6 a minute) and the deployed poller uses 6 or 7 a minute, so together they sit at the limit; add nothing else on the key while it runs, and never run a second copy of the script or a polling laptop at the same time.
- About 300 MB free under `data/` (219 MB database plus SQLite's journal).

The run, from the repo root:

```sh
npm run history -- --all --states auto
```

which is `node --env-file=studio/.env scripts/fetch-history.mjs --all --states auto`. What it does, in order:

1. Asks AP for the list of election dates this key can see (326 as of 27 October 2026, from 2012 onwards; stored in `ap_elections`).
2. For every date before today, general elections first (November of even years), then the rest newest first: one state-level request for every federal race (president, Senate, House), then one county-level request per state that had a federal race that day (`--states auto` reads that from the state-level response; a presidential general is 51 states, a special election is one).
3. Stores every response gzipped in `raw_responses` and normalises it into the tables below. Prints one line per request and a `== <date> done` summary per date.

Size of the job: 1,190 requests in total (ten generals at about 52 each, the other 314 dates average under three), one every 10 seconds, so about 3 hours 20 minutes if AP never makes it wait. The result is identical on every machine because AP's past results do not change.

Stopping and restarting: Ctrl-C at any time. Running the same command again skips every request already in `raw_responses` (zero API calls for those) and continues with the rest, so a run interrupted after two hours finishes in the remaining time. A request that fails (network, HTTP error) is logged with `skipped (re-run to retry)` and the same restart picks it up.

Checking it worked (the `sqlite3` command-line tool ships with macOS; `node -e` with `node:sqlite` works everywhere):

```sh
sqlite3 data/ap-history.sqlite "SELECT COUNT(*) FROM ap_elections; SELECT COUNT(*) FROM raw_responses WHERE status=200; SELECT COUNT(*) FROM results;"
# expect about 326, 1190 and 870,000 as of October 2026 (AP adds dates over time, so a later run returns slightly more)
sqlite3 -header data/ap-history.sqlite "SELECT * FROM v_coverage ORDER BY election_date DESC LIMIT 5;"
```

A past date whose `requests` in `v_coverage` is lower than 1 + its state count was interrupted; rerun the command. Future dates show zero until they happen.

Other forms of the same command:

```sh
npm run history -- 2024-11-05                     # one date: federal races, state + county level, 52 requests, about nine minutes
npm run history -- 2022-11-08 2020-11-03          # several dates
npm run history -- 2024-11-05 --offices G,S       # other offices (AP office codes; default P,S,H)
npm run history -- --all --states auto --dry-run  # list the planned requests, no API calls
npm run history -- --all --states auto --since 2020-01-01   # a date range (--until too)
npm run history -- 2024-11-05 --no-ru             # state and national level only, one request
npm run history -- 2024-11-05 --reparse           # rebuild the tables from the stored raw responses, no API calls
npm run history -- 2024-11-05 --refresh           # re-download even if cached
npm run history -- 2024-11-05 --gap 6000          # one request every 6 s (do not go under 6000 on a shared key)
```

`--db <path>` chooses another database file, `--results-type c` asks for AP's certified feed on the dates that have one.

Tables, all keyed by `(election_date, state_postal, race_id)` because AP race ids are unique only within a state (the presidential race is id `0` in every state):

| Table / view | One row per |
|---|---|
| `races` | race: office, seat, district, type, call status, uncontested, ranked choice, flipped seat |
| `reporting_units` | race × unit: national (`ru_level` 0), state (1), county or New England town (2), with FIPS, precincts, total votes |
| `results` | race × unit × candidate: votes, percentage of the unit, party, AP winner flag (`X` won, `R` to runoff), RCV rounds |
| `candidates` | candidate per election and state (AP reuses `candidate_id` numbers across states): names, party label on that ballot, `pol_id` (the person, stable across races and elections) |
| `ap_elections` | election date AP exposes to this key, with live/test/certified flags |
| `v_race_results` | state- or district-wide result per candidate, with names |
| `v_county_results` | county/town result per candidate, with names |
| `v_race_summary` | race: leader, runner-up, margin in votes and points |
| `v_coverage` | election date: requests made, races by office, states, county units, race types |

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

Sources, in order: official congressional portraits (public domain), hand-verified photos for the featured races, Ballotpedia for the rest. Each photo records its source and an automatic confidence; low-confidence photos are withheld until a person checks them at `/photos` (every candidate, filterable by state, confidence and source). `/candidates` is the curated index for the featured races: bios, links, photo credits and the live share from the feed.

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

## Who can change what

- **The ticker and every graphic are public links.** `/ticker` and the pages under `/g/` are fixed URLs, the same for everyone, and they only display. Anyone who has a link sees exactly what the switcher sees. No sign-in produces these links and opening one changes nothing.
- **The live ticker shows whatever was last published; graphics show their address.** `/ticker` reads the published parameters from the public, read-only, CDN-cached `/data/producer.json` every few seconds (`GET /api/producer` returns the same thing uncached, for the control room). A graphic's content is fixed by its address (chart id, race id, display parameters); the shipped defaults fill what the address leaves out.
- **Two passwords, one of them for rehearsals only.** `/studio` accepts `STUDIO_PASSWORD` (the real one) and, when set, `STUDIO_TEST_PASSWORD` (the rehearsal one, `test1234`). The rehearsal password works only while the poller is on AP's **Test** results. The moment anyone switches results to **Live** (the Test/Live switch in the control room, or `AP_RESULTS_TYPE=l` with no override), sign-ins with it are refused and every browser that used it is signed out, including laptops publishing with `GLOBAL_PASSWORD=test1234`; switching back to Test lets it work again. The cookie remembers which password signed in, so the control room shows a purple **TEST LOGIN** banner next to the TEST DATA banner for rehearsal sign-ins, and the sign-in page says when the rehearsal password is off. Sign out on the page clears only that one browser.

  **For election night nothing needs doing beyond switching results to Live.** To switch the rehearsal password off for good anyway (from `studio/`, in a terminal):

  ```sh
  vercel env rm STUDIO_TEST_PASSWORD --environment production --yes
  vercel redeploy ap-ind.vercel.app
  ```

  **To set or change the real password** (the first command prompts for it; the `!` shell inside Claude Code cannot prompt, so use a normal terminal):

  ```sh
  vercel env rm STUDIO_PASSWORD --environment production --yes
  vercel env add STUDIO_PASSWORD --environment production --sensitive
  vercel redeploy ap-ind.vercel.app
  ```

  Env changes take effect only after that redeploy. Vercel never shows a secret's value again, so keep the real password somewhere safe; if it is lost, set a new one the same way, which signs everyone out.
- **Only a publish changes the live ticker.** A publish is a `PUT /api/producer` carrying the four ticker fields, accepted only with the signed cookie you get by signing in to `/studio` with one of those passwords. A publish from a laptop goes through the laptop's own sign-in and then signs in to the deployment with `GLOBAL_PASSWORD`, which is that same password. One shared password gates every change; change it in the Vercel project and every open control room is signed out at once.
- **Per-browser knobs affect one screen only.** `?src=local` on a graphic reads that browser's own saved settings, and a few pages take display text from the URL (the lower third's `?name=&title=`, the quote card's `?quote=&who=`). They change what that one window shows and nothing else, and the text is rendered as text, never as markup. The operational rule that matters: the switcher operator opens graphics only from the control room's **Show** buttons, never from a link someone else sends.
- **Denial of service.** Vercel's automatic DDoS mitigation is on for the project. Everything a viewer loads (pages, results data, the published ticker parameters) is static or CDN-cached, so a flood of readers never reaches a function. Two Vercel Firewall rate-limit rules, per IP per minute, cover the functions: sign-in attempts (`POST /api/login`) and the `/api/` paths as a whole; a client over the limit gets 429 until the minute turns. Both limits are far above what a control room generates (about 7 requests a minute). They are project configuration, not code; `vercel firewall status` from `studio/` shows the live rules. On the night:
  - **If a real control room is throttled** (429s in the status bar, publishes failing), the Vercel dashboard's Firewall → Traffic view shows which rule fired and from where. Turning a rule off takes seconds and no deploy:
    ```sh
    cd studio && vercel firewall rules disable "API functions: 200 per minute per IP" && vercel firewall publish --yes
    ```
    `rules enable` and another publish restore it. The counters are per Vercel region, so a distributed flood can exceed a limit by about the number of regions; that is the automatic mitigation's job, not these rules'.
  - **Attack Mode is the break-glass switch.** It is off. Enabled (dashboard, or `vercel firewall attack-mode enable --duration 1h --yes`), every unverified visitor gets a challenge page, which includes the switcher's browser inputs: the ticker and graphics on air would go blank until each input passed it. Enable it only during an incident, tell the control room first, and prefer a short duration.
- **What is not there.** Sign-in is rate-limited but not locked out, so use a long random password. The shared password means no per-person revocation and no record of who published beyond the time of the last publish.

## Secrets

The AP key, the Blob token and the studio password live only in `studio/.env` (gitignored) or the Vercel project's environment variables. The key is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Deploying

Pushing `main` deploys the ap-ind Vercel project (root directory `studio/`). `vercel build && vercel deploy --prebuilt` from the repo root makes a preview. The docs in `docs/` and the graphics in `public/g/` are copied into the build.
