// Shared data feed for the graphics pages. The poller writes JSON files (index.json, status.json,
// state/<ST>.json, history.json, trend.json) and every page polls them through /data/: Vercel
// rewrites that path to Blob storage, npm start serves it from the local store. Pages see
// snapshot, update and counties messages, a freshness indicator, and helpers for county units,
// margin history, trend reports and the committed baselines.
//   ?demo=1   an embedded sample snapshot, no network (the docs site's embeds)
//   ?sample=auto  (the control room's previews) when no race has any votes yet, every race gets
//             fabricated results (sample.js) and the page shows a SAMPLE DATA badge; the moment
//             real votes arrive, the real feed takes over.
//   ?preview=1 inside the control room: the room posts {type:"feed", index, status} to the frame,
//             so forty thumbnails share one download instead of each polling; a frame that gets no
//             message within 5 s falls back to polling on its own.
// Usage: const feed = connectFeed({ onSnapshot, onUpdate, onStatus });

import { FEATURED_RACES } from "./control.js";

const FEATURED_CANDS = new Set(FEATURED_RACES.map((r) => r.cand));
/** True for the curated independents, whatever party label AP gives them (NP, Ind, ...). */
export const isFeaturedCand = (id) => FEATURED_CANDS.has(String(id));

// ?fit=1 (the control room's Preview links): keep the 1920x1080 layout but scale it to the
// window, so a producer on a laptop sees the whole graphic. Broadcast outputs never pass it.
if (new URLSearchParams(location.search).get("fit") === "1") {
  const fit = () => {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080, 1);
    document.body.style.transformOrigin = "0 0";
    document.body.style.transform = `scale(${k})`;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.background = getComputedStyle(document.body).backgroundColor;
  };
  window.addEventListener("resize", fit);
  if (document.body) fit(); else document.addEventListener("DOMContentLoaded", fit);
}

const INDEX_MS = 15_000;
const STATUS_MS = 30_000;
const COUNTY_MS = 60_000;

export function connectFeed(handlers) {
  const params = new URLSearchParams(location.search);
  const state = { races: new Map(), status: null, connected: false, mode: "blob", sample: false };
  const sampleAuto = params.get("sample") === "auto";
  let sampleMod = null, sampleData = null;
  async function maybeFabricate(index) {
    const empty = !index.races.some((r) => r.totalVotes > 0);
    if (!sampleAuto || !empty) { setSample(false); return index; }
    sampleMod ??= await import("./sample.js");
    sampleData ??= (await import("./sample-data.js")).SAMPLE;
    setSample(true);
    return sampleMod.fabricateIndex(index, sampleData.races);
  }
  function setSample(on) {
    if (on === state.sample) return;
    state.sample = on;
    let b = document.getElementById("sample-badge");
    if (on && !b) { b = document.createElement("div"); b.id = "sample-badge"; b.textContent = "SAMPLE DATA · the count has not started"; b.style.cssText = "position:absolute;left:96px;top:24px;z-index:9;background:#f59e0b;color:#1a1200;font:700 22px/1 Helvetica,Arial,sans-serif;letter-spacing:.06em;padding:10px 18px;border-radius:4px"; document.body.appendChild(b); }
    if (!on && b) b.remove();
  }

  function apply(msg) {
    if (msg.type === "snapshot") {
      state.races = new Map(msg.races.map((r) => [r.id, r]));
      state.status = msg.status;
      handlers.onSnapshot?.(state, msg);
    } else if (msg.type === "update") {
      for (const r of msg.changed) state.races.set(r.id, r);
      state.status = msg.status;
      handlers.onUpdate?.(state, msg);
    } else if (msg.type === "counties") {
      handlers.onUpdate?.(state, msg);
    } else if (msg.type === "status") {
      state.status = msg.status;
    }
    handlers.onStatus?.(state);
  }

  // Bucketed URLs let the browser cache share one copy between the dozen thumbnails the
  // control room keeps open; the poller rewrites index.json once a minute.
  const bucket = (ms) => Math.floor(Date.now() / ms);
  async function getJSON(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }
  let pollerStatus = null;
  let first = true;
  function statusView(index) {
    const s = pollerStatus ?? {};
    return {
      mode: "blob",
      lastSuccess: s.lastApSuccess ?? index?.generated ?? null,
      lastAttempt: s.generated ?? null,
      apTimestamp: s.apTimestamp ?? index?.apTimestamp ?? null,
      resultsType: s.resultsType ?? index?.resultsType ?? null,
      lastError: s.lastError ?? null,
      consecutiveErrors: s.consecutiveFailures ?? 0,
      paused: !!s.paused,
      countyFreshness: s.countyFreshness ?? {},
      raceCount: index?.races?.length ?? s.raceCount ?? 0,
    };
  }
  const raceKey = (r) => `${r.lastUpdated}|${r.totalVotes}|${r.called}|${r.eevp}|${r.candidates.map((c) => c.votes).join(",")}`;
  async function applyIndex(index) {
    if (!Array.isArray(index?.races)) return;
    index = await maybeFabricate(index);
    // The curated independent is flagged on every candidate record (older files lack the flag).
    for (const r of index.races) for (const c of r.candidates) c.featured = !!c.featured || FEATURED_CANDS.has(c.id) || (!r.featured && !!c.independent);
    state.connected = true;
    if (first) { first = false; apply({ type: "snapshot", races: index.races, status: statusView(index) }); return; }
    const changed = index.races.filter((r) => { const old = state.races.get(r.id); return !old || raceKey(old) !== raceKey(r); });
    apply({ type: "update", changed, status: statusView(index) });
  }
  async function loadIndex() {
    let index;
    try { index = await getJSON(`/data/index.json?t=${bucket(INDEX_MS)}`); } catch { state.connected = false; handlers.onStatus?.(state); return; }
    applyIndex(index);
  }
  async function loadStatus() {
    try { pollerStatus = await getJSON(`/data/status.json?t=${bucket(STATUS_MS)}`); } catch {}
    if (!first) apply({ type: "status", status: statusView(null) });
  }
  const stateFiles = new Map(); // ST -> { at, data }
  /** County-level units for a race: [{fips, name, precinctsPct, eevp, lastUpdated, votes:{candId: n}}] or null. */
  state.counties = async (raceId) => {
    if (state.mode === "demo") { const { SAMPLE_COUNTIES } = await import("./sample-counties.js"); return SAMPLE_COUNTIES[raceId] ?? null; }
    const r = state.races.get(raceId);
    if (!r) return null;
    const cached = stateFiles.get(r.state);
    const pick = (data) => { const u = data?.races.find((x) => x.id === raceId)?.counties ?? null; return state.sample && u && sampleMod ? sampleMod.fabricateCounties(u, r) : u; };
    if (cached && Date.now() - cached.at < COUNTY_MS) return pick(cached.data);
    try { const data = await getJSON(`/data/state/${r.state}.json?t=${bucket(COUNTY_MS)}`); stateFiles.set(r.state, { at: Date.now(), data }); return pick(data); }
    catch { return pick(cached?.data); }
  };
  /** 2024 presidential result by county for a state (config/baseline-2024-pres.json), or null. */
  state.baseline2024 = async (st) => { try { return (await (await fetch("./baseline-2024-pres.json")).json()).states[st] ?? null; } catch { return null; } };
  /** 2024 national totals and the prior contest per featured seat (config/baseline-federal.json), or null. */
  state.baselineFederal = async () => { try { return await (await fetch("./baseline-federal.json")).json(); } catch { return null; } };
  /** Margin history for a featured race from the poller: [[epochSec, leaderId, gapPts, eevp, totalVotes], ...] or null. */
  state.history = async (raceId) => {
    if (state.sample && sampleMod) { const r = state.races.get(raceId); return r ? sampleMod.fabricateHistory(r) : null; }
    try { return (await getJSON(`/data/history.json?t=${bucket(INDEX_MS)}`)).races?.[raceId] ?? null; } catch { return null; }
  };
  /** AP balance-of-power trend from the poller: { senate: {parties}, house: {parties} } or null. */
  state.trend = async () => {
    if (state.sample && sampleMod) return sampleMod.fabricateTrend([...state.races.values()]);
    try { return await getJSON(`/data/trend.json?t=${bucket(INDEX_MS)}`); } catch { return null; }
  };

  if (params.get("demo")) {
    state.mode = "demo";
    import("./sample-data.js").then(({ SAMPLE }) => {
      const now = new Date().toISOString();
      apply({ ...SAMPLE, status: { ...SAMPLE.status, mode: "demo", lastSuccess: now, lastAttempt: now } });
      handlers.onUpdate?.(state, { type: "counties", changed: [], states: [] });
      state.connected = true;
      handlers.onStatus?.(state);
      setInterval(() => { state.status.lastSuccess = new Date().toISOString(); handlers.onStatus?.(state); }, 30_000);
    });
    return state;
  }
  const fedByParent = params.get("preview") === "1" && window.parent !== window;
  let polling = false;
  const startPolling = () => {
    if (polling) return; polling = true;
    loadStatus().then(loadIndex);
    setInterval(loadIndex, INDEX_MS);
    setInterval(loadStatus, STATUS_MS);
  };
  if (fedByParent) {
    let fed = false;
    window.addEventListener("message", (e) => {
      if (e.data?.type !== "feed") return;
      fed = true;
      if (e.data.status) pollerStatus = e.data.status;
      if (e.data.index) applyIndex(e.data.index);
      else if (!first) apply({ type: "status", status: statusView(null) });
    });
    window.parent.postMessage({ type: "feed-request" }, "*");
    setTimeout(() => { if (!fed) startPolling(); }, 5000);
  } else startPolling();
  setInterval(() => apply({ type: "counties", changed: [], states: [] }), COUNTY_MS);
  return state;
}

/** "fresh" | "stale" | "dead" from the poller's last successful AP fetch (it runs once a minute). */
export function freshness(status) {
  if (!status?.lastSuccess) return "dead";
  const age = Date.now() - Date.parse(status.lastSuccess);
  return age < 180_000 ? "fresh" : age < 600_000 ? "stale" : "dead";
}

export function partyClass(party) {
  if (party === "Dem") return "dem";
  if (party === "GOP") return "gop";
  return "ind";
}

export function fmt(n) {
  return n.toLocaleString("en-US");
}

/** "U.S. Senate" / "U.S. House, District 6" / "Governor" for a race record. */
export function officeText(race) {
  if (!race) return "";
  if (race.office === "S") return "U.S. Senate";
  if (race.office === "H") return /AL$/.test(race.label ?? "") ? "U.S. House, at large" : `U.S. House, ${race.seat ?? ""}`;
  return race.title ?? race.officeName ?? "";
}

/** AP unit name → key that matches the geometry files for non-county units. */
export const normName = (n) => String(n ?? "").toLowerCase().replace(/\s+(county|parish|borough|census area|municipality|city and borough|town|city|plantation)$/i, "").replace(/[^a-z0-9]/g, "");

/** Per-state geometry from /geo/<ST>.json (counties; towns in New England; house districts in Alaska),
 *  fitted to [w, h]. Needs the d3 and topojson globals. */
export async function loadGeo(st, [w, h] = [900, 560]) {
  const topo = await (await fetch(`/geo/${st}.json`)).json();
  const obj = topo.objects[Object.keys(topo.objects)[0]];
  const feats = topojson.feature(topo, obj).features;
  const fc = { type: "FeatureCollection", features: feats };
  const [lon, lat] = d3.geoCentroid(fc);
  const proj = d3.geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels([lat - 6, lat + 6]).fitSize([w, h], fc);
  return { feats, kind: feats[0]?.properties?.kind ?? "county", path: d3.geoPath(proj) };
}

/** dem | gop | ind | oth for a candidate; curated independents are always ind. */
export function partyKey(c) {
  if (!c) return "oth";
  if (c.featured || c.independent || isFeaturedCand(c.id)) return "ind";
  if (c.party === "Dem") return "dem";
  if (c.party === "GOP") return "gop";
  return "oth";
}

/** Where a race stands: { status: called | leading | open | closed, party, cand, margin }.
 *  leading = votes counted, no call; open = no votes and polls not closed; closed = polls closed, nothing counted. */
export function raceState(r) {
  const cands = [...(r.candidates ?? [])].sort((a, b) => b.votes - a.votes);
  const winner = cands.find((c) => c.winner);
  if (r.called && winner) return { status: "called", party: partyKey(winner), cand: winner, margin: (winner.pct ?? 0) - (cands.find((c) => c.id !== winner.id)?.pct ?? 0) };
  if (r.totalVotes > 0 && cands[0]) return { status: "leading", party: partyKey(cands[0]), cand: cands[0], margin: (cands[0].pct ?? 0) - (cands[1]?.pct ?? 0) };
  const closed = r.pollClose ? Date.parse(r.pollClose) <= Date.now() : (r.precinctsPct ?? 0) > 0;
  return { status: closed ? "closed" : "open", party: null, cand: null, margin: null };
}

export const PARTY_COLOR = { dem: "#3b82f6", gop: "#ef4444", ind: "#facc15", oth: "#a855f7" };
