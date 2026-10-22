# ap-ind

Middleware between the AP Elections API and broadcast graphics for an election-night program about independent candidates: a live ticker, full-screen result graphics, a candidate index, and a control API.

Documents: [technical spec](docs/spec.html) · [graphics data options](docs/graphics-data-options.html) (also published at https://ap-ind.vercel.app).

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

## Data

- `config/candidates.json`: curated bios for the featured races, keyed by AP `candidateID`.
- `config/photos.json`: photo manifest for every candidate in every race: source, licence, confidence, and the CDN URL. Images are not in the repository.
- `config/featured.json`: candidate ids to feature regardless of party code. Any non-Democrat, non-Republican candidate is featured by default.
- `config/baseline-2024-pres.json`: 2024 presidential result by voting area for the featured states, from AP.
- `watch-party/public/geo/<ST>.json`: map geometry per state, matching AP's reporting units (counties; towns in New England; House districts in Alaska). Built by `scripts/build-geo.mjs`.

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

## Secrets

The AP key lives only in `.env` (gitignored) and is sent as a request header, so it never appears in URLs or logs. Never commit `.env`.

## Docs site

`vercel deploy --prod` publishes `docs/` (plus a copy of `public/g` for the demo-mode graphics) to https://ap-ind.vercel.app. The live server does not run on Vercel.
