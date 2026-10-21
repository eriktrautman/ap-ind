# ap-ind

Middleware that turns the AP Elections API into broadcast-ready graphics for an election-night program focused on independent candidates: a live ticker, full-screen charts, a studio-wall page, and a producer control panel.

Start with the spec: open [`docs/spec.html`](docs/spec.html) in a browser. It is the working "learn our architecture and plan" document.

## Secrets

The AP API key lives in `.env` (gitignored). Copy `.env.example` to `.env` and fill in `AP_API_KEY`. Never commit `.env` or paste the key into issues, chat, or logs.

## Running the spike

Requires Node 24+ (TypeScript runs directly; SQLite is built in). No build step.

```sh
npm install
cp .env.example .env      # then set AP_API_KEY
npm run dev               # http://127.0.0.1:3000
```

Pages (1920×1080, transparent background; add `&bg=black` or `&bg=green` for keying):

- `/g/ticker.html` — lower-third crawl of pinned races, AP calls and producer items
- `/g/race.html?id=<raceID>` — full-screen race result (ids from `/api/races`)

API: `/api/status`, `/api/snapshot`, `/api/races`, `/api/events`, `/api/ticker`, `/api/producer` (GET/PUT), `POST /api/producer/manual {text}`, `POST /api/poll`, `/healthz`. Live updates over `/ws`.

Data is stored in `data/ap-ind.sqlite` (gitignored), including every raw AP response for replay.
