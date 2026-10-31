// Shared data feed for the graphics pages. The poller writes JSON files (index.json, status.json,
// state/<ST>.json, history.json, trend.json) and every page polls them through /data/: Vercel
// rewrites that path to Blob storage, npm start serves it from the local store. Pages see
// snapshot, update and counties messages, a freshness indicator, and helpers for county units,
// margin history, trend reports and the committed baselines.
//   ?demo=1   an embedded sample snapshot, no network (the docs site's embeds)
//   ?sample=auto  (the Studio's previews) when no race has any votes yet, every race gets
//             fabricated results (sample.js) and the page shows a SAMPLE DATA badge; the moment
//             real votes arrive, the real feed takes over.
//   ?preview=1 inside the Studio: the room posts {type:"feed", index, status} to the frame,
//             so forty thumbnails share one download instead of each polling; a frame that gets no
//             message within 5 s falls back to polling on its own.
// Usage: const feed = connectFeed({ onSnapshot, onUpdate, onStatus });

import { FEATURED_RACES, canonicalAddress } from "./control.js";
import { watchTheme } from "./themes.js";
watchTheme();   // the published stylesheet, or the address's ?theme=; repainted within seconds of a push

// Only the chart-id address (/g/B5?race=NE-SEN) is served at the top level: a page opened directly
// (an old-style /g/race.html?id=... saved somewhere) forwards itself there, so one address style
// exists on air. Inside a frame (the router, the Studio's thumbnails, the lookbook) the page
// draws as it is; ?demo=1 (the lookbook's embedded sample) is left alone too.
if (window.self === window.top && !new URLSearchParams(location.search).get("demo")) {
  const a = canonicalAddress(location.pathname, location.search);
  if (a) location.replace(a);
}

const FEATURED_CANDS = new Set(FEATURED_RACES.map((r) => r.cand));
/** True for the curated independents, whatever party label AP gives them (NP, Ind, ...). */
export const isFeaturedCand = (id) => FEATURED_CANDS.has(String(id));

// ?fit=1 (the Studio's Preview links and thumbnails) is applied by control.js, imported above.

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
    return sampleMod.fabricateIndex(index, sampleData.races, FEATURED_CANDS);
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
  // Studio keeps open; the poller rewrites index.json once a minute.
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
  if (party === "Yes") return "yes";
  if (party === "No") return "no";
  return "ind";
}

export function fmt(n) {
  return n.toLocaleString("en-US");
}

/** RULE: every time shown on air carries its zone. Default Eastern, written "ET" (never EST/EDT); ?tz=CT|MT|PT|AKT|HT
 *  switches a page. clock(when) -> "9:41 PM ET"; clockS(when) -> "9:41:05 PM ET" for Updated stamps. */
const ZONES = { ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles", AKT: "America/Anchorage", HT: "Pacific/Honolulu" };
const TZ = (() => { const t = String(new URLSearchParams(location.search).get("tz") ?? "ET").toUpperCase(); return ZONES[t] ? t : "ET"; })();
export function clock(when = Date.now(), { seconds = false } = {}) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), timeZone: ZONES[TZ] }) + " " + TZ;
}
export const clockS = (when) => clock(when, { seconds: true });

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
/** A ballot measure (a proposition, amendment, question): its "candidates" are the Yes and No options. */
export const isMeasure = (r) => !!r && (r.kind === "measure" || r.office === "I");
export const isOption = (c) => !!c && (c.party === "Yes" || c.party === "No");
/** The small box before a name: YES / NO for a measure's options, else the party letter. */
export function candTag(c) {
  const k = partyKey(c);
  return { cls: k, text: k === "yes" ? "YES" : k === "no" ? "NO" : k === "ind" ? "I" : k === "dem" ? "D" : k === "gop" ? "R" : String(c?.party ?? "") };
}
/** The name after the tag: nothing for a measure's options (the tag says Yes or No), else the candidate's name. */
export const candName = (c, full = false) => (isOption(c) ? "" : (full ? c?.name : c?.last ?? c?.name) ?? "");
export function partyKey(c) {
  if (!c) return "oth";
  if (c.party === "Yes") return "yes";
  if (c.party === "No") return "no";
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

// Party colours for scripts that paint SVG and inline styles: read from the page's variables at use time, so a
// stylesheet change reaches them too. (ind here is the gold used for featured independents in those charts.)
const cssVar = (name, fallback) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; } };
export const PARTY_COLOR = { get dem() { return cssVar("--dem", "#3b82f6"); }, get gop() { return cssVar("--gop", "#ef4444"); }, get ind() { return cssVar("--gold", "#facc15"); }, oth: "#a855f7", yes: "#22c55e", no: "#f97316" };
