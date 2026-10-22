// One poll cycle: national state-level feed for every race the key covers (federal, governor,
// statewide offices, ballot measures, big-city mayors), county
// units for a rotating subset of states, written as JSON files to Vercel Blob.
//
//   index.json       every race, totals and candidates (rewritten each run)
//   state/<ST>.json  that state's races with county units (rewritten when the state's slot runs)
//   status.json      poller health and freshness
//
// Runs as a Vercel function (api/poll.js) or from scripts/run-local.mjs; same code either way.

import { put } from "@vercel/blob";
import { fetchRaces, normalizeRace, normalizeCounties, cfg } from "./ap.js";

const CANDIDATE_INDEX = "https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/config/candidates.json";
const COUNTY_SLOTS = 5; // each state's counties refresh every 5 runs

let curatedCache = null;
async function curated() {
  if (curatedCache) return curatedCache;
  try {
    const d = await (await fetch(CANDIDATE_INDEX)).json();
    curatedCache = new Map(d.candidates.map((c) => [c.id, c]));
  } catch {
    curatedCache = new Map();
  }
  return curatedCache;
}

const PHOTO_MANIFEST = "https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/config/photos.json";
let photoCache = null;
async function photoManifest() {
  if (photoCache) return photoCache;
  try {
    const d = await (await fetch(PHOTO_MANIFEST)).json();
    photoCache = new Map(Object.entries(d.photos ?? {}));
  } catch {
    photoCache = new Map();
  }
  return photoCache;
}

async function write(path, data) {
  const body = JSON.stringify(data);
  const res = await put(path, body, {
    access: "public", addRandomSuffix: false, contentType: "application/json",
    cacheControlMaxAge: 60, allowOverwrite: true,
  });
  return { path, url: res.url, bytes: body.length };
}

export async function pollOnce({ run = Date.now(), log = console.log } = {}) {
  const started = new Date();
  const { resultsType } = cfg();
  const status = { generated: started.toISOString(), resultsType, ok: false, errors: [], countyFreshness: {} };

  // 1. national feed, full fetch (no delta cursor: at one request a minute the full body is cheap and self-correcting)
  const nat = await fetchRaces("state");
  // Every race; hasIndependent drives the site's filter.
  const races = nat.races.map(normalizeRace).filter(Boolean);
  const cur = await curated();
  const ph = await photoManifest();
  for (const r of races) {
    r.hasIndependent = r.candidates.some((c) => c.independent);
    r.featured = cur.size ? [...cur.values()].some((c) => c.raceId === r.id && c.featured) : false;
    for (const c of r.candidates) {
      const k = cur.get(c.id);
      const m = ph.get(c.id);
      // Photos are served only from our own CDN copies (config/photos.json cdn field); nothing is hotlinked.
      // Low-confidence photos are withheld until a person has checked them.
      c.photo = m?.cdn && m.confidence !== "low" ? m.cdn : null;
      c.partyLabel = k?.partyLabel ?? null;
    }
  }
  status.apTimestamp = nat.timestamp;
  status.raceCount = races.length;
  status.withIndependent = races.filter((r) => r.hasIndependent).length;
  status.called = races.filter((r) => r.called).length;
  status.byKind = Object.fromEntries(["federal", "governor", "statewide", "measure", "local"].map((k) => [k, races.filter((r) => r.kind === k).length]));
  status.counting = races.filter((r) => !r.called && r.totalVotes > 0).length;

  const index = {
    generated: started.toISOString(), resultsType, apTimestamp: nat.timestamp,
    races: races.map((r) => ({ ...r, candidates: r.candidates.slice(0, 6) })),
  };
  const writes = [write("index.json", index)];

  // 2. counties for this run's slot of states
  const states = [...new Set(races.map((r) => r.state))].sort();
  const slot = Math.floor(run / 60_000) % COUNTY_SLOTS;
  const due = states.filter((_, i) => i % COUNTY_SLOTS === slot);
  for (const st of due) {
    try {
      const d = await fetchRaces("ru", { statePostal: st });
      const byId = new Map(d.races.map((r) => [r.raceID, r]));
      const stateRaces = races.filter((r) => r.state === st).map((r) => {
        const raw = byId.get(r.id);
        return { ...r, counties: raw ? normalizeCounties(raw) : [] };
      });
      writes.push(write(`state/${st}.json`, { generated: started.toISOString(), state: st, races: stateRaces }));
      status.countyFreshness[st] = started.toISOString();
    } catch (e) {
      status.errors.push(`${st}: ${e.message}`);
    }
  }

  const results = await Promise.allSettled(writes);
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) status.errors.push(`write: ${f.reason?.message ?? f.reason}`);
  status.ok = failed.length === 0;
  status.lastApSuccess = started.toISOString();
  status.durationMs = Date.now() - started.getTime();
  status.countyStatesThisRun = due;
  await write("status.json", status);
  log(`[poll] ${races.length} races, counties for ${due.join(",")}, ${results.length} writes, ${status.durationMs}ms${status.errors.length ? ", errors: " + status.errors.join("; ") : ""}`);
  return status;
}
