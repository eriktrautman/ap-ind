// Shared data feed for graphics pages. Three ways to get data, picked at load:
//   server  the local broadcast server: WebSocket /ws with a /api/snapshot polling fallback
//   blob    the deployment: JSON files the poller writes to Vercel Blob, read through /data/
//   demo    ?demo=1: an embedded sample snapshot, no network (the docs site)
// The page sees the same messages either way (snapshot, update, counties, status), plus a
// freshness indicator and helpers for county units and the 2024 baseline.
// Usage: const feed = connectFeed({ onSnapshot, onUpdate, onTicker, onStatus });

import { FEATURED_RACES } from "./control.js";

const FEATURED_CANDS = new Set(FEATURED_RACES.map((r) => r.cand));
/** True for the curated independents, whatever party label AP gives them (NP, Ind, ...). */
export const isFeaturedCand = (id) => FEATURED_CANDS.has(String(id));
const BLOB_INDEX_MS = 15_000;
const BLOB_STATUS_MS = 30_000;
const BLOB_COUNTY_MS = 60_000;

export function connectFeed(handlers) {
  const params = new URLSearchParams(location.search);
  const state = { races: new Map(), status: null, ticker: [], connected: false, mode: null };
  let ws = null;
  let pollTimer = null;

  function apply(msg) {
    if (msg.type === "snapshot") {
      state.races = new Map(msg.races.map((r) => [r.id, r]));
      state.status = msg.status;
      state.ticker = msg.ticker ?? [];
      handlers.onSnapshot?.(state, msg);
    } else if (msg.type === "update") {
      for (const r of msg.changed) state.races.set(r.id, r);
      state.status = msg.status;
      state.ticker = msg.ticker ?? state.ticker;
      handlers.onUpdate?.(state, msg);
    } else if (msg.type === "counties") {
      handlers.onUpdate?.(state, msg);
    } else if (msg.type === "ticker") {
      state.ticker = msg.ticker;
      handlers.onTicker?.(state, msg);
    } else if (msg.type === "status") {
      state.status = msg.status;
    }
    handlers.onStatus?.(state);
  }

  // ---------- server mode ----------
  async function pollOnce() {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) apply(await res.json());
    } catch {}
  }
  function openSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      state.connected = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      handlers.onStatus?.(state);
    };
    ws.onmessage = (e) => apply(JSON.parse(e.data));
    ws.onclose = () => {
      state.connected = false;
      handlers.onStatus?.(state);
      if (!pollTimer) pollTimer = setInterval(pollOnce, 5000);
      setTimeout(openSocket, 2000);
    };
    ws.onerror = () => ws.close();
  }

  // ---------- blob mode ----------
  // index.json is rewritten every minute by the poller; state/<ST>.json every five.
  // Each poll compares race records and reports only the changed ones, so pages re-render
  // exactly as they would on a WebSocket update.
  const bucket = (ms) => Math.floor(Date.now() / ms);
  async function getJSON(url) {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }
  let blobStatus = null;
  let blobFirst = true;
  function blobStatusView(index) {
    const s = blobStatus ?? {};
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
      running: true,
    };
  }
  function raceKey(r) {
    return `${r.lastUpdated}|${r.totalVotes}|${r.called}|${r.eevp}|${r.candidates.map((c) => c.votes).join(",")}`;
  }
  async function blobIndex() {
    let index;
    try { index = await getJSON(`/data/index.json?t=${bucket(BLOB_INDEX_MS)}`); } catch { handlers.onStatus?.(state); return; }
    if (!Array.isArray(index.races)) return;
    // The local server flags the curated candidate as featured; the Blob index flags the race.
    // Mark the curated independent here (the poller also writes c.featured; this covers older files).
    for (const r of index.races) for (const c of r.candidates) c.featured = !!c.featured || FEATURED_CANDS.has(c.id) || (!r.featured && !!c.independent);
    state.connected = true;
    if (blobFirst) {
      blobFirst = false;
      apply({ type: "snapshot", races: index.races, status: blobStatusView(index), ticker: [] });
      return;
    }
    const changed = index.races.filter((r) => { const old = state.races.get(r.id); return !old || raceKey(old) !== raceKey(r); });
    apply({ type: "update", changed, status: blobStatusView(index), ticker: state.ticker });
  }
  async function blobStatusPoll() {
    try { blobStatus = await getJSON(`/data/status.json?t=${bucket(BLOB_STATUS_MS)}`); } catch {}
    if (!blobFirst) apply({ type: "status", status: blobStatusView(null) });
  }
  const stateFiles = new Map(); // ST -> { generated, races }
  async function blobCounties(raceId) {
    const r = state.races.get(raceId);
    if (!r) return null;
    const st = r.state;
    const cached = stateFiles.get(st);
    if (cached && Date.now() - cached.at < BLOB_COUNTY_MS) return cached.data.races.find((x) => x.id === raceId)?.counties ?? null;
    try {
      const data = await getJSON(`/data/state/${st}.json?t=${bucket(BLOB_COUNTY_MS)}`);
      stateFiles.set(st, { at: Date.now(), data });
      return data.races.find((x) => x.id === raceId)?.counties ?? null;
    } catch { return cached?.data.races.find((x) => x.id === raceId)?.counties ?? null; }
  }
  function startBlob() {
    state.mode = "blob";
    blobStatusPoll().then(blobIndex);
    setInterval(blobIndex, BLOB_INDEX_MS);
    setInterval(blobStatusPoll, BLOB_STATUS_MS);
    setInterval(() => apply({ type: "counties", changed: [], states: [] }), BLOB_COUNTY_MS);
  }

  // ---------- helpers every mode offers ----------
  /** County-level units for a race: [{fips, name, precinctsPct, eevp, lastUpdated, votes:{candId: n}}] or null. */
  state.counties = async (raceId) => {
    if (state.mode === "demo") { const { SAMPLE_COUNTIES } = await import("./sample-counties.js"); return SAMPLE_COUNTIES[raceId] ?? null; }
    if (state.mode === "blob") return blobCounties(raceId);
    try { const d = await (await fetch(`/api/races/${raceId}/counties`)).json(); return d.units ?? null; } catch { return null; }
  };
  /** 2024 presidential result by county for a state, or null. */
  state.baseline2024 = async (st) => {
    try {
      if (state.mode === "server") return await (await fetch(`/api/baseline/pres2024/${st}`)).json();
      const d = await (await fetch("./baseline-2024-pres.json")).json();
      return d.states[st] ?? null;
    } catch { return null; }
  };

  /** Margin history points for a featured race from the poller: [[epochSec, leaderId, gapPts, eevp, totalVotes], ...] or null. */
  state.history = async (raceId) => {
    if (state.mode !== "blob") return null;
    try { const h = await getJSON(`/data/history.json?t=${bucket(BLOB_INDEX_MS)}`); return h.races?.[raceId] ?? null; } catch { return null; }
  };

  // ---------- pick a mode ----------
  if (params.get("demo")) {
    state.mode = "demo";
    import("./sample-data.js").then(({ SAMPLE }) => {
      const now = new Date().toISOString();
      apply({ ...SAMPLE, status: { ...SAMPLE.status, lastSuccess: now, lastAttempt: now } });
      handlers.onUpdate?.(state, { type: "counties", changed: [], states: [] });
      state.connected = true;
      handlers.onStatus?.(state);
      setInterval(() => { state.status.lastSuccess = new Date().toISOString(); handlers.onStatus?.(state); }, 30_000);
    });
    return state;
  }
  const forced = params.get("feed"); // ?feed=blob|server to skip the probe
  if (forced === "blob") { startBlob(); return state; }
  if (forced === "server") { state.mode = "server"; pollOnce().then(openSocket); return state; }
  // Probe: the local server answers /api/snapshot; the deployment has no such route (404),
  // so the page reads the Blob files instead and never tries the socket.
  fetch("/api/snapshot", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then(async (res) => {
      const ok = res.ok && (res.headers.get("content-type") ?? "").includes("json");
      if (!ok) throw new Error("no server");
      state.mode = "server";
      apply(await res.json());
      openSocket();
    })
    .catch(startBlob);
  return state;
}

/** "fresh" | "stale" | "dead" from the last successful AP poll. The deployment polls once a
 *  minute, so its thresholds are wider than the local server's 20 s cadence. */
export function freshness(status) {
  if (!status?.lastSuccess) return "dead";
  const age = Date.now() - Date.parse(status.lastSuccess);
  const [fresh, stale] = status.mode === "blob" ? [180_000, 600_000] : [60_000, 180_000];
  return age < fresh ? "fresh" : age < stale ? "stale" : "dead";
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
 *  fitted to [w, h]. Needs d3 and topojson globals. */
export async function loadGeo(st, [w, h] = [900, 560]) {
  const topo = await (await fetch(`/geo/${st}.json`)).json();
  const obj = topo.objects[Object.keys(topo.objects)[0]];
  const feats = topojson.feature(topo, obj).features;
  const fc = { type: "FeatureCollection", features: feats };
  const [lon, lat] = d3.geoCentroid(fc);
  const proj = d3.geoConicEqualArea().rotate([-lon, 0]).center([0, lat]).parallels([lat - 6, lat + 6]).fitSize([w, h], fc);
  return { feats, kind: feats[0]?.properties?.kind ?? "county", path: d3.geoPath(proj) };
}
