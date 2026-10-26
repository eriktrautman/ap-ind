// One poll cycle: national state-level feed for every race the key covers (federal, governor,
// statewide offices, ballot measures, big-city mayors), county units for a rotating subset
// of states, written as JSON files to Vercel Blob.
//
//   index.json       every race, totals and candidates (rewritten each run)
//   state/<ST>.json  that state's races with county units (rewritten when the state's slot runs)
//   status.json      poller health and freshness; written on every run, including failures
//   settings.json    studio overrides read at the start of each run (test/live, pause)
//
// Runs as a Vercel function (api/poll.js) or from scripts/run-local.mjs; same code either way.

import { fetchRaces, normalizeRace, normalizeCounties, cfg, setOverrides } from "./ap.js";
import { writeJson, readJson, defaultSettings } from "./store.js";

const CANDIDATE_INDEX = "https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/config/candidates.json";
const PHOTO_MANIFEST = "https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/config/photos.json";
const COUNTY_SLOTS = 5; // each state's counties refresh every 5 runs

let curatedCache = null;
let photoCache = null;

/** Drop the in-memory copies of the curated candidate and photo files (studio "reset"). */
export function resetCaches() {
  curatedCache = null;
  photoCache = null;
}

async function curated() {
  if (curatedCache) return curatedCache;
  try {
    const d = await (await fetch(CANDIDATE_INDEX, { cache: "no-store" })).json();
    curatedCache = new Map(d.candidates.map((c) => [c.id, c]));
  } catch {
    curatedCache = new Map();
  }
  return curatedCache;
}

async function photoManifest() {
  if (photoCache) return photoCache;
  try {
    const d = await (await fetch(PHOTO_MANIFEST, { cache: "no-store" })).json();
    photoCache = new Map(Object.entries(d.photos ?? {}));
  } catch {
    photoCache = new Map();
  }
  return photoCache;
}

/** Turn a thrown error into something a producer can act on. */
export function diagnose(e) {
  const msg = e?.message ?? String(e);
  if (/AP_API_KEY is not set/.test(msg)) return { code: "no-key", text: "AP_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy." };
  if (e?.apStatus === 401 || e?.apStatus === 403) return { code: "ap-auth", text: `AP rejected the key (${e.apStatus}). Check AP_API_KEY in Vercel, and that the key is entitled to this election date.` };
  if (e?.apStatus === 429) return { code: "ap-rate", text: "AP rate-limited us (429). Polling too often; wait a minute and try again." };
  if (e?.apStatus >= 500) return { code: "ap-down", text: `AP returned ${e.apStatus}. Their side; retry in a minute.` };
  if (/timeout|aborted|TimeoutError/i.test(msg) || e?.name === "TimeoutError") return { code: "ap-timeout", text: "AP did not answer within 25 s. Retry; if it persists AP may be degraded." };
  if (/BLOB_READ_WRITE_TOKEN|blob/i.test(msg)) return { code: "blob", text: `Could not write to Vercel Blob: ${msg}. Check BLOB_READ_WRITE_TOKEN in Vercel.` };
  if (/fetch failed|ENOTFOUND|ECONNRESET/i.test(msg)) return { code: "network", text: `Network error reaching AP: ${msg}.` };
  return { code: "unknown", text: msg };
}

async function previousStatus() {
  try { return (await readJson("status.json")) ?? {}; } catch { return {}; }
}

export async function pollOnce({ run = Date.now(), log = console.log, fresh = false } = {}) {
  const started = new Date();
  if (fresh) resetCaches();

  // Studio overrides, then environment. A missing settings file is the normal first-run state.
  let settings = defaultSettings;
  try { settings = { ...defaultSettings, ...((await readJson("settings.json")) ?? {}) }; } catch (e) { log(`[poll] settings.json unreadable: ${e.message}`); }
  setOverrides({ resultsType: settings.resultsType ?? undefined });

  const prev = await previousStatus();
  const base = {
    generated: started.toISOString(),
    lastApSuccess: prev.lastApSuccess ?? null,
    apTimestamp: prev.apTimestamp ?? null,
    consecutiveFailures: prev.consecutiveFailures ?? 0,
    pollEnabled: settings.pollEnabled !== false,
  };

  if (settings.pollEnabled === false) {
    const status = { ...base, resultsType: prev.resultsType ?? null, ok: true, paused: true, errors: [], countyFreshness: prev.countyFreshness ?? {} };
    await writeJson("status.json", status);
    log("[poll] paused by studio settings; nothing fetched");
    return status;
  }

  let resultsType;
  try { resultsType = cfg().resultsType; } catch (e) { return fail(base, prev, e, log); }
  const status = { ...base, resultsType, ok: false, errors: [], countyFreshness: prev.countyFreshness ?? {} };

  // 1. national feed, full fetch (no delta cursor: at one request a minute the full body is cheap and self-correcting)
  let nat;
  try { nat = await fetchRaces("state"); } catch (e) { return fail(status, prev, e, log); }

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
  const writes = [writeJson("index.json", index)];

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
      writes.push(writeJson(`state/${st}.json`, { generated: started.toISOString(), state: st, races: stateRaces }));
      status.countyFreshness[st] = started.toISOString();
    } catch (e) {
      status.errors.push(`${st} counties: ${diagnose(e).text}`);
    }
  }

  const results = await Promise.allSettled(writes);
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) status.errors.push(`write: ${diagnose(f.reason).text}`);
  status.ok = failed.length === 0;
  if (results[0].status === "fulfilled") {
    status.lastApSuccess = started.toISOString();
    status.consecutiveFailures = 0;
    status.lastError = null;
  } else {
    status.consecutiveFailures = (prev.consecutiveFailures ?? 0) + 1;
    status.lastError = { at: started.toISOString(), ...diagnose(results[0].reason) };
  }
  status.durationMs = Date.now() - started.getTime();
  status.countyStatesThisRun = due;
  try { await writeJson("status.json", status); } catch (e) { log(`[poll] could not write status.json: ${e.message}`); }
  log(`[poll] ${races.length} races, counties for ${due.join(",")}, ${results.length} writes, ${status.durationMs}ms${status.errors.length ? ", errors: " + status.errors.join("; ") : ""}`);
  return status;
}

async function fail(status, prev, e, log) {
  const d = diagnose(e);
  const out = {
    ...status, ok: false, errors: [d.text],
    lastError: { at: status.generated, ...d },
    consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1,
    durationMs: Date.now() - Date.parse(status.generated),
  };
  try { await writeJson("status.json", out); } catch (e2) { log(`[poll] could not write status.json: ${e2.message}`); }
  log(`[poll] failed: ${d.text}`);
  return out;
}
