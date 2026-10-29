# Election Producer

The app is **Election Producer**; the product producers sign in to is **Studio**. The site is **electionproducer.com**. The repository and the Vercel project are still called `ap-ind`, and ap-ind.vercel.app keeps serving the same deployment, so old bookmarks work.

Election-night app for a broadcast about independent candidates: an AP poller, the Studio, a ticker and some forty-five full-screen graphics (54 chart ids, the catalog in `studio/lib/control.js`), all on the AP Elections API. One codebase runs two ways, with the same code in both: deployed on Vercel (electionproducer.com) or as a single Node process on any machine.

Documents, for whoever works on the code (they are not published on the site):

- [docs/producer-plan.html](docs/producer-plan.html): the build plan and burndown, every story and a log of every change. Open it in a browser from the repo. Updated in the same commit as any change it describes.
- [docs/graphics-data-options.html](docs/graphics-data-options.html): the graphics lookbook, every chart by series with its data source and on-air notes; the chart ids come from here.
- [docs/spec.html](docs/spec.html): the technical spec, requirements, the architecture as built, open questions.
- [docs/watch-party.html](docs/watch-party.html): the design of the Watch Party, the public site for every race in the AP feed (a separate deployment).

## TL;DR: a new machine

1. Install Node 24 or newer (`node -v`) and clone the repo. No other tools, no database server, no Vercel account.
2. `cd studio && npm install && cp .env.example .env`, then put the AP key on the `AP_API_KEY=` line and choose any password on the `STUDIO_PASSWORD_PRODUCER_FIRST_LAST=` line (put your own name in the suffix). The key is the one secret; it lives only in `studio/.env`, which is gitignored.
3. `npm start` in `studio/` and open http://localhost:3000/studio. That is the Studio; the ticker is `/ticker` and the graphics are under `/g/`.
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
STUDIO_PASSWORD_PRODUCER_FIRST_LAST=anything you like   # your Studio password on your machine; the name says what it entitles, then whose it is
STUDIO_TEST_PASSWORD=test1234       # optional: the rehearsal password, flagged in the Studio
```

Leave `STORE_DIR=./data` as it is. Then:

```sh
npm start
```

and open http://localhost:3000/studio. Sign in with the password you chose. Your laptop starts as the deployment's **standby**: within a few seconds it has copied the deployment's results, poller status and published ticker into `studio/data/`, and it refreshes that copy every 30 seconds without making a single AP request. The status bar's purple STANDBY strip shows how old the copy is, whether the website is reachable, and this laptop's address on the local network. The ticker is at http://localhost:3000/ticker and the graphics under http://localhost:3000/g/ (the Studio links to every one). Stop it with Ctrl-C; `npm start` again picks up where it left off.

What you will be sent, and what it is for:

| Key | Needed to run locally? | What it does |
|---|---|---|
| `AP_API_KEY` | **Yes** | Reads results from the AP Elections API. AP allows ten requests a minute per key, and one polling run uses 6 or 7 (the national feed plus a tenth of the states' counties, each state every ten minutes), so **only one machine polls at a time**: the deployment while it is up, the laptop once it has been promoted. A standby laptop never polls; it copies the deployment's files. The key is needed locally so that the laptop *can* poll the moment it becomes production. |
| `STUDIO_PASSWORD_PRODUCER_<FIRST>_<LAST>` | You choose it yourself | Password for `/studio` on your machine only, signing in as First Last with full rights. Not a shared secret. |
| `STUDIO_TEST_PASSWORD` | Optional | A second, easy password for rehearsals (`test1234` until the night). Signing in with it shows a purple TEST LOGIN banner. |
| `BLOB_READ_WRITE_TOKEN` | No | Leave it off a laptop. `npm start` never writes production's data store from a laptop even if the token is present. The token exists for one command, `npm run poll`, which stands in for the Vercel cron when the cron has died but the website's pages are fine; run that only when asked. |
| `CRON_SECRET` | No | Vercel only; lets the cron call the poll function. Unused locally. |

`AP_RESULTS_TYPE=t` in `.env` means AP's simulated test election; change it to `l` for live results on election night (the Studio's Test/Live switch does the same without a restart). The key must never be committed or put in a URL; `.env` is gitignored.

**Two tickers and two screens, one publish.** The Studio is a workbench saved in that browser. Its **Ticker Builder** (the crawl order of races, text and chunks, the chunks themselves, AP Call highlight, idle text) is the one thing that can be published, and it goes to one place: the **Live Ticker** at the fixed address `/ticker`, which picks up new parameters within about 5 seconds at the next item boundary without restarting the crawl (a note under the published preview says while the live address has not picked a publish up yet, and when it has). **Publish** replaces the live ticker's parameters with the builder's after listing every change and warning if someone else published since you last looked; **Pull** copies the live ticker's parameters into the builder. The builder's own address (Copy URL) is a ticker that carries its parameters and never changes. Everything else on the page (featured races, chart lists, persistent elements) organises that browser's view and is never published; **Restore defaults** resets the page, not the live ticker. The row under the builder always says where you stand ("Builder matches the live ticker" or "differs: 3 changes").

On a laptop, production is whatever `GLOBAL` in `.env` says:

- `GLOBAL=https://electionproducer.com` (the default): the deployment is production and this laptop is its standby, in **mirror** mode. Its ticker and graphics show the deployment's live ticker; its files are a copy of the deployment's data, refreshed every 30 seconds (`MIRROR_SECONDS` changes that). Pull works with nothing more. Publish needs `GLOBAL_PASSWORD`, your own password on the deployment (publishes are stamped with that name); without it the builder row says **pull only** and the Publish button explains what to add. The poller controls (Poll now, pause, Test/Live) are hidden, because a standby has no poller: those live on the website's Studio.
- `GLOBAL=self`: this machine *is* production, in **poll** mode. It polls AP every minute into its own files, its outputs read them, and publish writes its own live ticker. Start a machine this way only when the deployment is gone for good or was never there; the normal road from standby to production is Promote, below. A store that has never been published to starts from a copy of the deployment's live ticker, so a fresh production machine begins where the website was.

Results data never needs copying by hand: the mirror does it, and a promoted laptop polls AP itself. `node --env-file=.env scripts/serve.mjs --no-mirror` serves without copying (nothing to fall back on); `--poll` on a connected laptop polls AP anyway, which is only right with an AP key of its own.

**If the deployment is down** (ticker, graphics and Studio all gone), the drill is three steps and needs no restart and no file edits. On the standby laptop's Studio (a producer sign-in), press **Promote: make this laptop production** in the STANDBY strip and confirm. The laptop stops copying, polls AP itself from then on, and serves its own copy of everything; the strip turns orange and reads PRODUCTION · THIS LAPTOP with the address to use. Change the hostname on the switcher's browser inputs from `ap-ind.vercel.app` to that address (the laptop's IP on the studio network, not localhost); every path is the same. Publish the ticker builder if it needs changing. When the website is back, **Return to standby** reverses it and the switcher goes back to the website. The Promote dialog warns if the website is still answering: its cron and the laptop would then share one AP key and both be refused, so promote only when production is down, or pause polling on the website first. If only the cron has stopped while the pages are fine, a laptop with the Blob token runs `npm run poll` instead and nothing else changes.

**Before the night, once.** Each role signs in to the website's Studio once (producer, publisher, read only), since a bug that only a non-producer sees never shows from a producer account. Put `GLOBAL_PASSWORD` in the standby laptop's `.env` so it can publish. Run the drill: Promote on the laptop, open `/ticker` from another machine at the address the strip shows, then Return to standby; a minute, and it proves the switcher's path to the laptop works. After a rehearsal, glance at the Vercel dashboard's Firewall → Traffic view to see that neither rate-limit rule caught real use. In the Studio, the **i** beside PRODUCER ACTIONS and beside STANDBY opens a plain-English panel saying what every control on that strip does.

**If the studio loses the internet** while the website is fine, the switcher cannot reach the website and the laptop cannot reach AP, but the laptop can still serve its last copy to the switcher over the local network: promote it, point the switcher at it, and the ticker and graphics stay up, frozen at the last minute copied. The only cure for frozen data is a second path to the internet, a phone hotspot on the laptop; with that, the promoted laptop polls AP over the hotspot and serves the switcher over the studio network.

Everything under `npm start` is the same code that runs on electionproducer.com: the static site, the four API functions in `api/`, and the poller in `lib/poll.js`. `scripts/serve.mjs` exists only for local use (its neighbours `poll-local.mjs`, `browse.mjs` and `version.mjs` are tools, not the app); it stands in for Vercel's static hosting, function routing and cron, and adds the mirror, Promote and Return to standby, which only a laptop needs. `POLL_SECONDS` changes the polling interval on a production machine; `--no-poll` on one serves what the files hold.

## How it fits together

The broadcast pages live in `studio/` (Studio, ticker, poller functions) and `public/g/` (graphics), deployed together as the ap-ind Vercel project (electionproducer.com). No server of our own: the poller writes JSON to Vercel Blob (`/api/poll`, Vercel Cron once a minute; the cron's request is accepted only when `CRON_SECRET` is set on the project, so a fresh project polls nothing until its env vars are in), the pages poll those files.

| Path on electionproducer.com | Purpose |
|---|---|
| `/` | Landing page: what the site is and a sign-in link to the Studio. |
| `/studio` | The **Studio** (one password per person; the variable's name says what it entitles: `STUDIO_PASSWORD_PRODUCER_…`, `…PUBLISHER_…`, `…READONLY_…`). Served only to a signed-in browser: without a valid cookie the request is redirected to `/studio/login` before any of the page leaves the server (`studio/proxy.js`, Vercel Routing Middleware). Status bar, then the sections: Chart Display Settings, Live Ticker, Live Screens, Slate, Races, Movement, Persistent Elements, Race Catalog, Chart Catalog. |
| `/ticker` | The ticker, 1920×1080, transparent. `?bg=black` or `?bg=green` for keying. With no other parameters it is the **Live Ticker**: the one fixed address, crawling whatever was last published, re-read every 5 seconds and applied at the next item boundary. **Built from its address instead**: `/ticker?bg=black&opacity=60&seq=NE-SEN|~Polls close at 7|MT-SEN|ID-SEN&calls=0&idle=Welcome` crawls exactly those races (race ids, in order; AP ids also work) and items with no publish involved; `calls=1|0` is the yellow AP Call highlight; the published ticker carries its own background, which `?bg=` on any address overrides; an empty `races` means the featured races. The Studio shows the address for the ticker on the page with a Copy URL button, and every chart card has one too. |
| `/live-screen-one`, `/live-screen-two` | **Live Screens**: two fixed addresses, each showing whatever chart was last published to it (a chart id, a race or state, and the chart's own parameters). The page re-reads the published definition every 5 s and cross-fades to a new chart, so the switcher points at one address forever. `?bg=`, `?opacity=` as elsewhere. The Studio's Live Screens section builds a draft on the left (chart, race, state and parameter selectors), and Publish moves it to the on-air screen on the right; Pull copies on-air back into the draft. |
| `/g/<chart id>?bg=…&opacity=…&race=<race id>` | **The semantic address for any graphic**, e.g. `/g/B5?bg=black&opacity=60&race=NE-SEN` or `/g/D9?state=MT`. Chart ids are the lookbook ids (B5, D4; case does not matter), race ids are AP's labels (`NE-SEN`, `CA-6`, `AK-GOV`, `AK-MEASURE-3`; an AP race id also works), shown on every card and row in the Studio (hover for the id). Display parameters go first (`bg`, `opacity`, `fit`, `src`), then the data. `cand=`, `a=` and `b=` take a candidate's last name or AP id. An address that does not fully specify its chart never shows a graphic: an unknown chart id, a race chart with no race, a race the feed does not have, or a state chart with no state puts up a red error card instead, listing the parameters received, what that chart needs, what is missing and a corrected example, so a bad address is obvious on the monitor and never mistaken for data. The address resolves (through `/g/chart.html`) to the page below and anything else in it is passed through. |
| `/facebook` | The candidate facebook: every candidate in every race the feed carries (about 1,600), with the cleared photo where there is one; search, state, office, photo, independent and featured-race filters (featured races by default); the twenty-five curated candidates carry their full background. Rendered in batches as you scroll. |
| `/styleguide` | The style guide: the colours, type, components and copy rules of the Studio and of the graphics, every value a token, with a theme switcher that shows how another style guide would be dropped in. |
| `/g/<page>?id=<raceID>` | The page behind each chart id. Opened directly at the top level it forwards itself to the chart-id address above (so an old-style address saved somewhere turns into the one style); the router draws it inside a frame. Which page is behind which id is the catalog in `studio/lib/control.js` (the Studio's Chart Catalog shows the same list) and the lookbook. `?bg=` as above; `?opacity=10..100` paints the chart panel at that percent opacity for layering over video (each Studio section has its own Background and Opacity dropdowns, each live draft its own BG, and a top Chart Display Settings block applies one pair to all); `?src=default|global|local` picks the producer state. |

**State model.** One schema (`studio/lib/control.js`, served at `/g/control.js`). The only shared state is what gets published: the Live Ticker (`tickerItems`, the crawl order of races, text and chunks; `chunks`, the named packages of races and text the order can place anywhere, any number of times; AP Call highlight, idle text, background; `pinnedRaceIds` and `manualItems` are derived from the crawl order for everything that has always read them) and the two Live Screen definitions (`screenA`, `screenB`: chart id, race, state, parameters), stored as `producer.json` and written only by a publish; `/ticker` and the live screens re-read them every 5 s as `/data/producer.json`, which `api/published.js` serves and the CDN keeps for one 5 s bucket (every open ticker and graphic asks for the same address within a bucket, so a flood of readers costs one invocation per bucket). A publish is written to the Blob file and to the Vercel Runtime Cache, and a read takes the newer of the two: the Blob CDN keeps an overwritten file for up to 60 s and ignores query strings, so the blob alone would put a publish on air up to a minute late. The Studio's Pull and conflict check use the uncached `GET /api/producer`. Every other field a page uses (featured races, key races, context lines) comes from the page's own address (`races=`, `context=`) or the shipped defaults; `watchState()` composes the two and nothing else is ever published. The Studio's working copy lives in the browser (localStorage). `?src=local` on the ticker shows this browser's builder, `?src=default` the shipped defaults.

**The domain.** electionproducer.com is registered at Squarespace, whose DNS carries two A records on the bare name and a CNAME on `www`, all pointing at Vercel; `vercel domains verify electionproducer.com` from `studio/` checks them. To move again: add the new domain to the project (`vercel domains add <domain> ap-ind`), put the records the dashboard shows into the registrar's DNS, wait for the dashboard to say valid (Vercel issues the certificate). Everything that runs there follows the new name on its own: the Studio, dialogs and status bar name the site by `location.host`, and the ticker and graphics use relative paths. Two places hold the address as text for laptops: the default in `studio/scripts/serve.mjs` (`DEPLOYMENT`) and the `GLOBAL` line in `studio/.env.example`; change both, and any laptop's own `.env`. The README and spec mention ap-ind.vercel.app in prose only.

**Every time carries its zone.** Any clock shown on air or in the Studio (Updated stamps, call times, poll closings, AP report times) is written in Eastern time with the suffix ET, never EST or EDT and never the browser's local zone. The graphics get this from `clock()` and `clockS()` in `public/g/feed.js`; `?tz=CT` (or MT, PT, AKT, HT) switches one page. New pages use the helpers rather than formatting a Date themselves.

**Chart ids are fixed.** The ids in the lookbook and the Studio (B5, C1, D7, …) have been shared and are used in rundowns and by other people, so from 27 October 2026 an id never changes meaning and is never reused. To retire a chart, keep its entry in `studio/lib/control.js` and set `retired: true`: the Studio greys it out with a placeholder, refuses to add it, and drops it from existing selections. A new chart gets a new id at the end of its series (B14, C10, D12, …).

**Graphics data.** `public/g/feed.js` polls the Blob files (`index.json` every 15 s, `status.json` every 30 s, `state/<ST>.json` on demand, `history.json` for the margin tracker, `trend.json` for the balance-of-power pages). Static data committed to the repo and copied into the build next to the pages: `config/baseline-2024-pres.json` (B13), `config/baseline-federal.json` (B2, B4, B10, B14, C6, D10; 2024 national totals and the last contest for each featured seat, from `scripts/fetch-baseline-federal.mjs`), `config/polls.json` (B2, B3, B14, C7; every row carries a source link), `config/party-codes.json` (C5, F7), `config/independents-history.json` (C4), `config/benchmarks.json` (D12, D13; the best independent result in each featured state, editorial), `config/quotes.json` (B11), `config/explainers.json` (C9), `config/state-notes.json` (F4), and `config/candidates.json` and `config/photos.json` (B1, B2, B14).

**Thumbnails.** Every card in the Studio runs the real page in a scaled iframe. At most 32 are live at once, featured sections first; cards load when scrolled into view and unload when scrolled away; Full Catalog cards show numbers until you press Preview. **Open 1920×1080** opens the graphic in a new tab with the chosen background and the current state source.

Poller controls (AP poller card): **Poll now**, **Poll now + reset caches**, **Pause/Resume polling**, **Test/Live**. These write `settings.json`, read at the start of every run, so none need a redeploy. `status.json` is written on every run, including failures, with a plain-English diagnosis shown in the status bar.

The Watch Party project (`watch-party/`, ind-watch-party.vercel.app) is a pure reader of the same Blob files.

Functions: `GET/POST/DELETE /api/login`, `GET/PUT /api/producer` (partial bodies merge over the stored state; every field validated), `GET/PUT /api/settings`, `GET|POST /api/poll`. Env vars on the Vercel project: `AP_API_KEY`, `AP_RESULTS_TYPE`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, one `STUDIO_PASSWORD_<PRODUCER|PUBLISHER|READONLY>_<FIRST>_<LAST>` per person, optionally `STUDIO_TEST_PASSWORD`.

Checking pages without a browser: `node scripts/browse.mjs "http://localhost:3000/g/county.html?id=28594&bg=black" --shot out.png` renders a page in headless Chrome, prints console errors and failed requests, and can run `--eval` snippets. `npm run poll` runs the poll loop alone (no web server) for a laptop standing in for the cron.

## Data

- `config/candidates.json`: curated bios for the featured races, keyed by AP `candidateID`.
- `config/photos.json`: photo manifest for every candidate in every race: source, licence, confidence, and the CDN URL. The resized set is not in the repository; only the fourteen hand-verified photos for the featured races are, under `public/photos/`.
- `config/baseline-2024-pres.json`: 2024 presidential result by voting area for the featured states, from AP (B13).
- `config/baseline-federal.json`: 2024 national Senate and House totals by party and the last contest for each featured seat, from AP (B10, C6, D10).
- `config/polls.json`: public polls for the featured races with a source on every row (B2, B3, B14, C7).
- `config/party-codes.json`: party names for AP's party codes (C5, F7).
- `config/independents-history.json`: independents in Congress since 1990 (C4).
- `config/quotes.json`, `config/explainers.json`, `config/state-notes.json`: editorial text for the quote card (B11), the explainer cards (C9) and how each state counts (F4).
- `config/benchmarks.json`: for each featured state, the best result an independent has had there in a federal race (name, year, share) and, where the count is known to run long, the note the scoreboard shows while counting. Drawn by D12 The benchmark board and D13 Independent scoreboard, in the Races section. Seeded from the producer's mockups; verify every row before air.
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
- **The live ticker shows whatever was last published; graphics show their address.** `/ticker` and the live screens read the published parameters from the public, read-only `/data/producer.json` every few seconds (a small function behind a 5 s CDN copy; `GET /api/producer` returns the same thing uncached, for the Studio). A graphic's content is fixed by its address (chart id, race id, display parameters); the shipped defaults fill what the address leaves out.
- **Nothing of the Studio is served before sign-in.** `studio/proxy.js` is Vercel Routing Middleware (`"proxy"` in `vercel.json`, matched on `/studio` and everything under it): it verifies the cookie's signature and expiry and redirects any other browser to `/studio/login`, the one open page there (plus the stylesheet). So the Studio's HTML and scripts are never in a signed-out browser's view-source or network log, not merely hidden by script. The laptop server (`scripts/serve.mjs`) applies the same check. Signing out, an expired cookie or the rehearsal rule at Live send the browser back to the sign-in page.
- **One password per person; its variable's name says what it entitles.** `/studio` accepts every `STUDIO_PASSWORD_<ROLE>_<FIRST>_<LAST>` variable on the project, where the role is one of three words and the suffix is the person's name in capitals with underscores (shown title-cased, so `MARY_ANN_SMITH` signs in as Mary Ann Smith), plus `STUDIO_TEST_PASSWORD` (the rehearsal one, `test1234`) when set:

  | Variable | Signs in as | May do |
  |---|---|---|
  | `STUDIO_PASSWORD_PRODUCER_FIRST_LAST` | First Last · producer | Everything: publish the ticker and the live screens, run or pause the poller, switch results Test/Live |
  | `STUDIO_PASSWORD_PUBLISHER_FIRST_LAST` | First Last · publisher | Publish the ticker and the live screens, nothing else |
  | `STUDIO_PASSWORD_READONLY_FIRST_LAST` | First Last · read only | See everything in the Studio, including what is live and who published it; change nothing |
  | `STUDIO_TEST_PASSWORD` | Rehearsal | Read only, and only while results are Test |

  The split is by blast radius: a bad publish is visible on the ticker and undone in five seconds by publishing again, while Test/Live, pause and poll change what the poller does for every output at once, so those stay with producers. The header says who you are signed in as and with what rights; controls a password cannot use are greyed with a lock and say which password they need. **View User Permissions** in the Studio's footer lists everyone on the site with their role and what it allows (names and roles only, to signed-in browsers only). Every publish is stamped with the signer's name: the live ticker's table shows it beside the time, and the conflict warning says who published at what time instead of "someone else". The rehearsal password works only while the poller is on AP's **Test** results: the moment anyone switches results to **Live**, sign-ins with it are refused and every browser already using it is signed out at the next request. The old unnamed `STUDIO_PASSWORD` is still accepted, as "Producer", so nothing breaks before a project is moved to named passwords; retire it once everyone has their own.

  Each password is its own secret: the sign-in cookie is signed with the password it was issued for, so changing or deleting one person's variable signs out that person and nobody else. **To add a person, change a password, change someone's rights, or revoke one** (from `studio/`, in a normal terminal, since `vercel env add` prompts for the value and the `!` shell inside Claude Code cannot):

  ```sh
  vercel env add STUDIO_PASSWORD_PUBLISHER_FIRST_LAST --environment production --sensitive   # add, or (after rm) change
  vercel env rm STUDIO_PASSWORD_PUBLISHER_FIRST_LAST --environment production --yes          # revoke
  vercel redeploy ap-ind.vercel.app
  ```

  To change rights, remove the old variable and add the new one with the same value; the person signs in again with the same password. Env changes take effect only after that redeploy. Vercel never shows a secret's value again, so each person keeps their own; a lost one is replaced the same way and signs out only that person. Switching results to Live is all election night needs; to switch the rehearsal password off for good anyway, remove `STUDIO_TEST_PASSWORD` the same way.
- **Only a publish changes the live ticker.** A publish is a `PUT /api/producer` carrying the ticker fields, accepted only with a producer's or publisher's signed cookie from `/studio`, and stamped with that person's name. A publish from a laptop goes through the laptop's own sign-in and then signs in to the deployment with `GLOBAL_PASSWORD`, that person's own password there, so the stamp is still a name. Per-person passwords gate every change; delete a person's variable in the Vercel project and only that person is signed out.
- **Per-browser knobs affect one screen only.** `?src=local` on a graphic reads that browser's own saved settings, and a few pages take display text from the URL (the lower third's `?name=&title=`, the quote card's `?quote=&who=`). They change what that one window shows and nothing else, and the text is rendered as text, never as markup. The operational rule that matters: the switcher operator opens graphics only from the Studio's **Show** buttons, never from a link someone else sends.
- **Denial of service.** Vercel's automatic DDoS mitigation is on for the project. Everything a viewer loads (pages, results data, the published ticker parameters) is static or CDN-cached, so a flood of readers never reaches a function. Two Vercel Firewall rate-limit rules, per IP per minute, cover the functions: sign-in attempts (`POST /api/login`) and the `/api/` paths as a whole; a client over the limit gets 429 until the minute turns. Both limits are far above what a Studio generates (about 7 requests a minute). They are project configuration, not code; `vercel firewall status` from `studio/` shows the live rules. On the night:
  - **If a real Studio is throttled** (429s in the status bar, publishes failing), the Vercel dashboard's Firewall → Traffic view shows which rule fired and from where. Turning a rule off takes seconds and no deploy:
    ```sh
    cd studio && vercel firewall rules disable "API functions: 200 per minute per IP" && vercel firewall publish --yes
    ```
    `rules enable` and another publish restore it. The counters are per Vercel region, so a distributed flood can exceed a limit by about the number of regions; that is the automatic mitigation's job, not these rules'.
  - **Attack Mode is the break-glass switch.** It is off. Enabled (dashboard, or `vercel firewall attack-mode enable --duration 1h --yes`), every unverified visitor gets a challenge page, which includes the switcher's browser inputs: the ticker and graphics on air would go blank until each input passed it. Enable it only during an incident, tell the Studio first, and prefer a short duration.
- **What is not there.** Sign-in is rate-limited but not locked out, so use long random passwords. The audit trail is the name and time on the last publish only; there is no history of earlier publishes.

## Secrets

The AP key, the Blob token and the studio password live only in `studio/.env` (gitignored) or the Vercel project's environment variables. The key is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Deploying

Pushing `main` deploys the ap-ind Vercel project (root directory `studio/`). `vercel build && vercel deploy --prebuilt` from the repo root makes a preview. The build copies the graphics in `public/g/`, the config data and the map geometry into `dist/`; the docs in `docs/` are not deployed.

## Tests

A small suite under `studio/test/`, run with Node's own test runner and no extra dependencies. It covers the routes a producer depends on rather than internals: the public outputs and data files, signing in (the gate, wrong passwords, roles, the rehearsal password shut out at Live), publishing the ticker and a live screen, and the two failovers (a poll that cannot reach AP keeps every file and says so; a standby laptop that cannot reach the deployment keeps serving its copy and Promote makes it production from that copy).

    cd studio
    npm test                                                 build, then everything against a local server it starts itself
    npm run test:unit                                        the library checks only
    SMOKE_URL=https://electionproducer.com npm run test:smoke   the route checks against a deployment, read-only
    SMOKE_URL=... SMOKE_PASSWORD=... npm run test:smoke      also signs in there and checks the Studio is served to that cookie

The suite never writes to a deployment: the publish and role checks run only against the local server. **It is capped at 100 tests for its whole life**; `budget.test.mjs` fails above that, so a new check replaces an old one rather than adding to the pile. `.github/workflows/test.yml` runs `npm test` on every push; on a push to `main` it then waits for production to be running that commit (the build writes `/version.json`, and the job polls it for up to six minutes) and runs the read-only route checks against the live site, so a deploy that broke something shows as a red run on that commit.
