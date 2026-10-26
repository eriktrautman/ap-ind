// Download AP's historical results for one election date into a local SQLite database built for
// analytics (flat tables, one row per candidate per reporting unit), while being kind to the key:
//   - AP's quota is 10 requests/minute (x-electionsapi-q-minute-* headers). We send one request at
//     a time, at most one every REQUEST_GAP_MS, and pause when the headers say the bucket is nearly empty.
//   - Every successful response is stored (gzipped) in raw_responses, so a re-run costs zero requests
//     and only re-normalizes. Use --refresh to re-download.
//   - County level (level=ru) must be requested per state; a national ru pull times out at AP's gateway.
//
//   node --env-file=.env scripts/fetch-history.mjs 2024-11-05
//   node --env-file=.env scripts/fetch-history.mjs 2022-11-08 --offices P,S,H --states CA,TX
//   node --env-file=.env scripts/fetch-history.mjs 2024-11-05 --dry-run        # list planned requests
//   node --env-file=.env scripts/fetch-history.mjs 2024-11-05 --no-ru          # state/national level only
//   node --env-file=.env scripts/fetch-history.mjs 2024-11-05 --reparse        # rebuild tables from stored raw
//
// Options: --db <path> (default data/ap-history.sqlite), --results-type l|c|t (default l; AP lists
// certifiedResults=true for some dates and 'c' asks for that feed), --gap <ms> between requests.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

// ---------- CLI ----------
const argv = process.argv.slice(2);
const dates = argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const has = (name) => argv.includes(`--${name}`);
const opts = {
  offices: String(flag("offices", "P,S,H")),
  states: flag("states", null) ? String(flag("states")).split(",").map((s) => s.trim().toUpperCase()) : null,
  resultsType: String(flag("results-type", "l")),
  db: String(flag("db", "data/ap-history.sqlite")),
  gapMs: Number(flag("gap", 7000)), // 7 s => max ~8.5/min, under AP's 10/min
  dryRun: has("dry-run"),
  noRu: has("no-ru"),
  refresh: has("refresh"),
  reparse: has("reparse"),
};
if (dates.length === 0 && !has("list")) {
  console.error("usage: fetch-history.mjs <YYYY-MM-DD>... [--offices P,S,H] [--states CA,TX] [--no-ru] [--dry-run] [--refresh] [--reparse] [--list]");
  process.exit(2);
}
const key = process.env.AP_API_KEY;
if (!key && !opts.dryRun && !opts.reparse) throw new Error("AP_API_KEY not set (use --env-file=.env)");

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// ---------- DB ----------
mkdirSync(dirname(opts.db), { recursive: true });
const db = new DatabaseSync(opts.db);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  -- Every AP response, verbatim (gzip). request_key identifies the logical request so re-runs skip it.
  CREATE TABLE IF NOT EXISTS raw_responses (
    id INTEGER PRIMARY KEY,
    election_date TEXT NOT NULL,
    request_key TEXT NOT NULL,          -- e.g. "2024-11-05|P,S,H|ru|CA|l"
    url TEXT NOT NULL,                  -- never contains the key (it travels in a header)
    fetched_at TEXT NOT NULL,
    status INTEGER NOT NULL,
    bytes INTEGER,
    race_count INTEGER,
    ap_timestamp TEXT,
    quota_used INTEGER, quota_allowed INTEGER,
    body_gz BLOB,
    UNIQUE (request_key)
  );

  -- Election dates AP exposes to this key (from GET /v3/elections).
  CREATE TABLE IF NOT EXISTS ap_elections (
    election_date TEXT PRIMARY KEY,
    live_results INTEGER, test_results INTEGER, live_reports INTEGER, certified_results INTEGER,
    listed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS races (
    election_date TEXT NOT NULL,
    state_postal TEXT NOT NULL,         -- from the state-level reporting unit; "US" for national rollups
    race_id TEXT NOT NULL,              -- unique only within a state (the presidential race is "0" in every state)
    state_id TEXT,
    office_id TEXT,                     -- P, S, H, G, ...
    office_name TEXT,
    seat_name TEXT,                     -- "District 12", "Class I"...
    seat_num TEXT,
    census_district TEXT,               -- House district number as AP codes it ("00" at-large)
    race_type TEXT,                     -- General, Special General, Primary...
    race_type_id TEXT,
    race_call_status TEXT,
    tabulation_status TEXT,
    tabulation_status_phase TEXT,
    uncontested INTEGER,
    ranked_choice INTEGER,
    flipped_seat INTEGER,
    key_race INTEGER,
    national INTEGER,
    num_runoff INTEGER,
    win_threshold REAL,
    eevp REAL,
    party_race_call TEXT,
    event_id TEXT,
    results_type TEXT,
    test INTEGER,
    incumbents_json TEXT,
    extra_json TEXT,                    -- any race-level fields not mapped above
    PRIMARY KEY (election_date, state_postal, race_id)
  );

  CREATE TABLE IF NOT EXISTS reporting_units (
    election_date TEXT NOT NULL,
    state_postal TEXT NOT NULL,         -- state of the race (the unit itself is in the same state, or "US" for national rollups)
    race_id TEXT NOT NULL,
    ru_key TEXT NOT NULL,               -- reportingunitID, or "<ST>:state" / "US:national" for rollups
    ru_level INTEGER,                   -- 0 national, 1 state, 2 county (or town / district)
    level_name TEXT,                    -- AP "level": national, state, FIPSCode, township, district...
    state_name TEXT,
    ru_name TEXT,
    fips TEXT,                          -- county FIPS (or state FIPS prefix for New England towns)
    town_fips TEXT,                     -- New England town FIPS, when AP reports by town
    precincts_reporting INTEGER,
    precincts_total INTEGER,
    precincts_reporting_pct REAL,
    eevp REAL,
    elect_total INTEGER,
    last_updated TEXT,
    poll_closing_time TEXT,
    total_votes INTEGER,                -- sum of candidate voteCount in this unit (computed)
    extra_json TEXT,
    PRIMARY KEY (election_date, state_postal, race_id, ru_key)
  );

  -- One row per candidate per reporting unit: the long table for analytics.
  CREATE TABLE IF NOT EXISTS results (
    election_date TEXT NOT NULL,
    state_postal TEXT NOT NULL,
    race_id TEXT NOT NULL,
    ru_key TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    pol_id TEXT,
    party TEXT,
    vote_count INTEGER,
    vote_pct REAL,                      -- of total_votes in the unit (computed)
    winner TEXT,                        -- "X" called winner, "R" runoff, "N" no winner...
    winner_datetime TEXT,
    incumbent INTEGER,
    ballot_order INTEGER,
    elect_won INTEGER,
    rcv_json TEXT,                      -- ranked-choice rounds, when present
    PRIMARY KEY (election_date, state_postal, race_id, ru_key, candidate_id)
  );

  -- Who each candidate_id is (per election; names/party can vary across elections).
  CREATE TABLE IF NOT EXISTS candidates (
    election_date TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    pol_id TEXT, pol_num TEXT,
    first TEXT, middle TEXT, last TEXT, suffix TEXT, abbrv TEXT,
    party TEXT, caucus_with TEXT,
    PRIMARY KEY (election_date, candidate_id)
  );

  CREATE INDEX IF NOT EXISTS results_cand ON results (candidate_id, election_date);
  CREATE INDEX IF NOT EXISTS results_party ON results (election_date, party);
  CREATE INDEX IF NOT EXISTS ru_level ON reporting_units (election_date, ru_level);
  CREATE INDEX IF NOT EXISTS ru_fips ON reporting_units (fips);
  CREATE INDEX IF NOT EXISTS races_office ON races (election_date, office_id, state_postal);

  -- Convenience views -----------------------------------------------------------------------
  -- Statewide (or district-wide for House) result per candidate, with names, for every race.
  CREATE VIEW IF NOT EXISTS v_race_results AS
    SELECT r.election_date, r.race_id, r.state_postal, r.office_id, r.office_name, r.seat_name, r.race_type,
           r.race_call_status, r.uncontested, r.ranked_choice, r.flipped_seat,
           c.candidate_id, c.pol_id, c.first, c.last, c.party, res.incumbent,
           res.vote_count, res.vote_pct, res.winner, res.winner_datetime,
           u.total_votes, u.precincts_reporting, u.precincts_total, u.eevp
    FROM results res
    JOIN reporting_units u USING (election_date, state_postal, race_id, ru_key)
    JOIN races r USING (election_date, state_postal, race_id)
    JOIN candidates c USING (election_date, candidate_id)
    WHERE u.ru_level = 1;

  -- County / town level rows with names, for maps and swing analysis.
  CREATE VIEW IF NOT EXISTS v_county_results AS
    SELECT r.election_date, r.race_id, r.state_postal, r.office_id, r.seat_name, r.race_type,
           u.ru_key, u.ru_name, u.fips, u.level_name,
           c.candidate_id, c.first, c.last, c.party, res.incumbent,
           res.vote_count, res.vote_pct, res.winner,
           u.total_votes, u.precincts_reporting, u.precincts_total
    FROM results res
    JOIN reporting_units u USING (election_date, state_postal, race_id, ru_key)
    JOIN races r USING (election_date, state_postal, race_id)
    JOIN candidates c USING (election_date, candidate_id)
    WHERE u.ru_level >= 2;

  -- One row per race: the winner and the margin over the runner-up (state/district level).
  CREATE VIEW IF NOT EXISTS v_race_summary AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY election_date, state_postal, race_id ORDER BY vote_count DESC) AS rk
      FROM v_race_results
    )
    SELECT w.election_date, w.race_id, w.state_postal, w.office_id, w.office_name, w.seat_name, w.race_type,
           w.race_call_status, w.uncontested, w.ranked_choice, w.flipped_seat, w.total_votes,
           w.candidate_id AS leader_id, w.first AS leader_first, w.last AS leader_last, w.party AS leader_party,
           w.vote_count AS leader_votes, w.vote_pct AS leader_pct, w.winner AS leader_winner_flag,
           s.last AS second_last, s.party AS second_party, s.vote_count AS second_votes, s.vote_pct AS second_pct,
           w.vote_count - COALESCE(s.vote_count, 0) AS margin_votes,
           ROUND(w.vote_pct - COALESCE(s.vote_pct, 0), 3) AS margin_pct
    FROM ranked w LEFT JOIN ranked s ON s.election_date = w.election_date AND s.state_postal = w.state_postal AND s.race_id = w.race_id AND s.rk = 2
    WHERE w.rk = 1;
`);

const ins = {
  raw: db.prepare(`INSERT OR REPLACE INTO raw_responses
    (election_date, request_key, url, fetched_at, status, bytes, race_count, ap_timestamp, quota_used, quota_allowed, body_gz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  rawExists: db.prepare("SELECT id, status FROM raw_responses WHERE request_key = ? AND status = 200"),
  election: db.prepare(`INSERT OR REPLACE INTO ap_elections VALUES (?, ?, ?, ?, ?, ?)`),
  race: db.prepare(`INSERT OR REPLACE INTO races VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  ru: db.prepare(`INSERT OR REPLACE INTO reporting_units VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  result: db.prepare(`INSERT OR REPLACE INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  cand: db.prepare(`INSERT OR REPLACE INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
};

// ---------- HTTP, politely ----------
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apGet(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = lastRequestAt + opts.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res;
    try {
      res = await fetch(url, {
        headers: { "x-api-key": key, "Accept-Encoding": "gzip", Accept: "application/json" },
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      console.warn(`  network error (${e.message}); retry ${attempt} in 20s`);
      await sleep(20_000);
      continue;
    }
    const h = res.headers;
    const quota = {
      used: Number(h.get("x-electionsapi-q-minute-used")),
      allowed: Number(h.get("x-electionsapi-q-minute-allowed")),
      available: Number(h.get("x-electionsapi-q-minute-available")),
      secondsLeft: Number(h.get("x-electionsapi-q-minute-secondsleft")),
    };
    const text = await res.text();
    if (res.status === 429) {
      const pause = (Number.isFinite(quota.secondsLeft) ? quota.secondsLeft : 60) + 5;
      console.warn(`  429 from AP; pausing ${pause}s (attempt ${attempt})`);
      await sleep(pause * 1000);
      continue;
    }
    if (res.status >= 500) {
      console.warn(`  ${res.status} from AP; retry ${attempt} in 30s: ${text.slice(0, 120)}`);
      await sleep(30_000);
      continue;
    }
    // Respect the bucket: if nearly drained, wait for the minute to roll over.
    if (Number.isFinite(quota.available) && quota.available <= 1 && Number.isFinite(quota.secondsLeft)) {
      console.log(`  quota nearly used (${quota.used}/${quota.allowed}); waiting ${quota.secondsLeft + 1}s`);
      await sleep((quota.secondsLeft + 1) * 1000);
    }
    return { status: res.status, text, quota };
  }
  throw new Error(`gave up on ${url}`);
}

function buildUrl(date, params) {
  const u = new URL(`https://api.ap.org/v3/elections/${date}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  u.searchParams.set("format", "json");
  return u.toString();
}

// ---------- Normalize ----------
const bool = (v) => (v == null ? null : v ? 1 : 0);
const RACE_KEYS = new Set(["raceID","stateID","officeID","officeName","seatName","seatNum","censusDistrict","raceType","raceTypeID","raceCallStatus","tabulationStatus","tabulationStatusPhase","uncontested","rankedChoice","flippedSeat","keyRace","national","numRunoff","winThreshold","eevp","partyRaceCall","eventID","resultsType","test","incumbents","reportingUnits"]);
const RU_KEYS = new Set(["reportingunitID","reportingunitLevel","level","statePostal","stateName","reportingunitName","fipsCode","townFIPSCode","precinctsReporting","precinctsTotal","precinctsReportingPct","eevp","electTotal","lastUpdated","pollClosingTime","candidates"]);

function ruKey(ru) {
  if (ru.reportingunitID) return String(ru.reportingunitID);
  if (ru.reportingunitLevel === 0) return "US:national";
  if (ru.reportingunitLevel === 1) return `${ru.statePostal}:state`;
  return `${ru.statePostal}:${ru.level}:${ru.fipsCode ?? ru.reportingunitName}`;
}

function ingest(date, data) {
  let nRaces = 0, nUnits = 0, nResults = 0;
  db.exec("BEGIN");
  try {
    for (const r of data.races ?? []) {
      const stateUnit = r.reportingUnits?.find((u) => u.reportingunitLevel === 1) ?? r.reportingUnits?.[0];
      const extra = Object.fromEntries(Object.entries(r).filter(([k]) => !RACE_KEYS.has(k)));
      const st = stateUnit?.statePostal ?? "??";
      ins.race.run(
        date, st, String(r.raceID), r.stateID ?? null, r.officeID ?? null, r.officeName ?? null,
        r.seatName ?? null, r.seatNum ?? null, r.censusDistrict ?? null, r.raceType ?? null, r.raceTypeID ?? null, r.raceCallStatus ?? null,
        r.tabulationStatus ?? null, r.tabulationStatusPhase ?? null, bool(r.uncontested), bool(r.rankedChoice),
        bool(r.flippedSeat), bool(r.keyRace), bool(r.national), r.numRunoff ?? null, r.winThreshold ?? null, r.eevp ?? null,
        r.partyRaceCall ?? null, r.eventID ?? null, r.resultsType ?? null, bool(r.test),
        r.incumbents ? JSON.stringify(r.incumbents) : null, Object.keys(extra).length ? JSON.stringify(extra) : null,
      );
      nRaces++;
      for (const u of r.reportingUnits ?? []) {
        const k = ruKey(u);
        const cands = u.candidates ?? [];
        const total = cands.reduce((s, c) => s + (c.voteCount ?? 0), 0);
        const uextra = Object.fromEntries(Object.entries(u).filter(([x]) => !RU_KEYS.has(x)));
        ins.ru.run(
          date, st, String(r.raceID), k, u.reportingunitLevel ?? null, u.level ?? null, u.stateName ?? null,
          u.reportingunitName ?? (u.reportingunitLevel === 1 ? u.stateName : u.reportingunitLevel === 0 ? "United States" : null),
          u.fipsCode ?? null, u.townFIPSCode ?? null, u.precinctsReporting ?? null, u.precinctsTotal ?? null, u.precinctsReportingPct ?? null,
          u.eevp ?? null, u.electTotal ?? null, u.lastUpdated ?? null, u.pollClosingTime ?? null, total,
          Object.keys(uextra).length ? JSON.stringify(uextra) : null,
        );
        nUnits++;
        for (const c of cands) {
          ins.result.run(
            date, st, String(r.raceID), k, String(c.candidateID), c.polID ?? null, c.party ?? null, c.voteCount ?? null,
            total ? +(((c.voteCount ?? 0) / total) * 100).toFixed(3) : null, c.winner ?? null, c.winnerDateTime ?? null,
            bool(c.incumbent), c.ballotOrder ?? null, c.electWon ?? null,
            c.rankedChoiceVoting ? JSON.stringify(c.rankedChoiceVoting) : null,
          );
          ins.cand.run(
            date, String(c.candidateID), c.polID ?? null, c.polNum ?? null, c.first ?? null, c.middle ?? null, c.last ?? null,
            c.suffix ?? null, c.abbrv ?? null, c.party ?? null, c.caucusWith ?? null,
          );
          nResults++;
        }
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { nRaces, nUnits, nResults };
}

// ---------- Plan ----------
function plan(date) {
  const reqs = [];
  const base = { officeID: opts.offices, resultsType: opts.resultsType };
  reqs.push({ key: `${date}|${opts.offices}|state|ALL|${opts.resultsType}`, url: buildUrl(date, { ...base, level: "state" }), label: "state level, all states" });
  if (!opts.noRu) {
    for (const st of opts.states ?? STATES) {
      reqs.push({ key: `${date}|${opts.offices}|ru|${st}|${opts.resultsType}`, url: buildUrl(date, { ...base, level: "ru", statePostal: st }), label: `county level, ${st}` });
    }
  }
  return reqs;
}

async function listElections() {
  const url = "https://api.ap.org/v3/elections?format=json";
  const { status, text } = await apGet(url);
  if (status !== 200) throw new Error(`elections list: ${status} ${text.slice(0, 200)}`);
  const d = JSON.parse(text);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  for (const e of d.elections ?? []) ins.election.run(e.electionDate, bool(e.liveResults), bool(e.testResults), bool(e.liveReports), bool(e.certifiedResults), now);
  db.exec("COMMIT");
  console.log(`AP lists ${d.elections?.length ?? 0} election dates for this key (stored in ap_elections)`);
}

async function runDate(date) {
  const reqs = plan(date);
  console.log(`\n== ${date}: ${reqs.length} requests planned (offices ${opts.offices}, resultsType ${opts.resultsType})`);
  if (opts.dryRun) {
    for (const r of reqs) console.log(`  ${ins.rawExists.get(r.key) ? "cached " : "FETCH  "} ${r.label}  ${r.url}`);
    return;
  }
  let fetched = 0, cached = 0;
  const totals = { nRaces: 0, nUnits: 0, nResults: 0 };
  const started = Date.now();
  for (const [i, r] of reqs.entries()) {
    const existing = ins.rawExists.get(r.key);
    let text;
    if (existing && !opts.refresh) {
      if (!opts.reparse) { cached++; continue; }
      const row = db.prepare("SELECT body_gz FROM raw_responses WHERE id = ?").get(existing.id);
      text = gunzipSync(row.body_gz).toString("utf8");
      cached++;
    } else {
      const { status, text: body, quota } = await apGet(r.url);
      let data = null;
      try { data = JSON.parse(body); } catch { /* keep raw even if not JSON */ }
      ins.raw.run(date, r.key, r.url, new Date().toISOString(), status, Buffer.byteLength(body), data?.races?.length ?? null,
        data?.timestamp ?? null, quota.used, quota.allowed, gzipSync(body));
      if (status !== 200) {
        console.warn(`  [${i + 1}/${reqs.length}] ${r.label}: HTTP ${status} ${body.slice(0, 160)}`);
        continue;
      }
      fetched++;
      text = body;
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`  [${i + 1}/${reqs.length}] ${r.label}: ${data?.races?.length ?? "?"} races, ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB, quota ${quota.used}/${quota.allowed}, ${elapsed}s elapsed`);
    }
    const n = ingest(date, JSON.parse(text));
    totals.nRaces += n.nRaces; totals.nUnits += n.nUnits; totals.nResults += n.nResults;
  }
  const counts = db.prepare(`SELECT (SELECT COUNT(*) FROM races WHERE election_date = ?) AS races,
    (SELECT COUNT(*) FROM reporting_units WHERE election_date = ?) AS units,
    (SELECT COUNT(*) FROM results WHERE election_date = ?) AS results,
    (SELECT COUNT(*) FROM candidates WHERE election_date = ?) AS candidates`).get(date, date, date, date);
  console.log(`== ${date} done: ${fetched} fetched, ${cached} from cache. DB now has ${counts.races} races, ${counts.units} reporting units, ${counts.results} result rows, ${counts.candidates} candidates for this date.`);
}

if (has("list") || (!opts.dryRun && !opts.reparse && db.prepare("SELECT COUNT(*) AS n FROM ap_elections").get().n === 0)) {
  await listElections();
}
for (const d of dates) await runDate(d);
db.close();
