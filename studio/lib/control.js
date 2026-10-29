// Producer control state shared by the Studio (/studio), the ticker and every
// graphic. One schema, three sources:
//   default  the shipped values in this file
//   global   producer.json in the store, read as /data/producer.json (production: what the deployed ticker and graphics read)
//   local    this browser's localStorage; never written to Blob
// A page picks its source with ?src=default|global|local, else the selector the Studio
// saved in this browser, else global. A local source with nothing saved falls back to global.
//
// Usage in a graphic:
//   import { watchState } from "./control.js";
//   watchState({ onState: (state, info) => render(state) });   // info: {source, requested, error, preview}

export const SOURCES = ["default", "global", "local"];

// ?opacity=10..100: the chart panel at that opacity, for layering a graphic over video. Panels,
// strips, bugs and the ticker band all paint with the --panel/--panel-edge (ticker: --band/--band-edge)
// colours, so those variables are rewritten as rgba on <html>, which beats every stylesheet value.
// 100 (or no parameter) leaves the solid colours. Node imports this module too, hence the guard.
export function applyPanelOpacity(search = typeof location === "undefined" ? "" : location.search) {
  if (typeof document === "undefined") return;
  const o = Number(new URLSearchParams(search).get("opacity"));
  if (!new URLSearchParams(search).has("opacity") || !Number.isFinite(o) || o < 0 || o >= 100) return;
  const apply = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const v of ["--panel", "--panel-edge", "--band", "--band-edge"]) {
      const m = /^#([0-9a-f]{6})$/i.exec(cs.getPropertyValue(v).trim());
      if (m) document.documentElement.style.setProperty(v, `rgba(${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)},${o / 100})`);
    }
  };
  document.body ? apply() : document.addEventListener("DOMContentLoaded", apply);
}
applyPanelOpacity();
const LS_LOCAL = "studio.local";
const LS_SOURCE = "studio.source";

/** Curated races: the seven independents the broadcast follows (cand = the independent's AP id). Order is the default ticker order. */
export const FEATURED_RACES = [
  { id: "28594", label: "NE-SEN", state: "NE", title: "U.S. Senate", who: "Dan Osborn", cand: "168007" },
  { id: "27607", label: "MT-SEN", state: "MT", title: "U.S. Senate", who: "Seth Bodnar", cand: "177955" },
  { id: "13252", label: "ID-SEN", state: "ID", title: "U.S. Senate", who: "Todd Achilles", cand: "162421" },
  { id: "42003", label: "SD-SEN", state: "SD", title: "U.S. Senate", who: "Brian Bengs", cand: "70405" },
  { id: "5696",  label: "CA-6",   state: "CA", title: "U.S. House, District 6", who: "Kevin Kiley", cand: "69756" },
  { id: "2015",  label: "AK-AL",  state: "AK", title: "U.S. House, at large", who: "Bill Hill", cand: "177719" },
  { id: "13253", label: "ID-1",   state: "ID", title: "U.S. House, District 1", who: "Sarah Zabel", cand: "178015" },
];

/**
 * Every graphic in the lookbook. kind: race (needs ?id=), movement (C and D series), or other (A and
 * F series, which have no section in the Studio and show only in the Chart Catalog). built: a page exists.
 *
 * CHART IDS ARE FIXED (from 27 October 2026). The lookbook ids (B5, C1, D7, ...) have been shared and are
 * used in rundowns and by other people, so an id never changes meaning and is never reused:
 *   - to retire a chart, keep its entry and set retired: true (optionally retiredNote); the Studio
 *     greys it out with a placeholder and refuses to add it, and existing selections drop it cleanly;
 *   - a new chart gets a NEW id at the end of its series (B14, C10, D12, ...), never a freed one;
 *   - renaming a chart's page is fine; renaming its id is not;
 *   - a chart that joins a DEFAULTS list after launch carries added: "YYYY-MM-DD": the Studio puts it into a browser's saved
 *     lists once (studio.knownCharts), so an existing workbench sees a new default without Restore All Default Settings.
 */
export const CHARTS = [
  // A: persistent elements and lower thirds (the ticker is the one built)
  { id: "A1",  kind: "other", name: "Live ticker",                  page: "/ticker",           built: true },
  { id: "A2",  kind: "other", name: "Name and title lower third",   page: "/g/lower-third.html",                built: true },
  { id: "A3",  kind: "other", name: "Race-status bug",              page: "/g/bug.html",                built: true, needsRace: true },
  { id: "A4",  kind: "other", name: "AP call alert",                page: "/g/call-alert.html", built: true, needsRace: true },
  { id: "A5",  kind: "other", name: "Poll-closing strip",           page: "/g/poll-closing.html",                built: true },
  { id: "A6",  kind: "other", name: "Featured races strip",         page: "/g/featured-strip.html",                built: true },
  // B: featured race deep dives
  { id: "B1",  kind: "race", name: "Candidate profile",             page: "/g/profile.html",                built: true },
  { id: "B2",  kind: "race", name: "Race setup",                    page: "/g/setup.html",                built: true },
  { id: "B3",  kind: "race", name: "Polling trend",                 page: "/g/poll-trend.html",                built: true },
  { id: "B4",  kind: "race", name: "Path to victory map",           page: "/g/path.html",                built: true },
  { id: "B5",  kind: "race", name: "Live race result",              page: "/g/race.html",      built: true },
  { id: "B6",  kind: "race", name: "Live county map",               page: "/g/county.html",    built: true },
  { id: "B7",  kind: "race", name: "Margin tracker",                page: "/g/margin.html",    built: true },
  { id: "B8",  kind: "race", name: "Votes still out",               page: "/g/outstanding.html", built: true },
  { id: "B9",  kind: "race", name: "Ranked-choice rounds",          page: "/g/rcv.html",       built: true, only: (r) => !!r?.rankedChoice },
  { id: "B10", kind: "race", name: "Then vs now",                   page: "/g/then-now.html",  built: true },
  { id: "B11", kind: "race", name: "Quote card",                    page: "/g/quote.html",                built: true },
  { id: "B12", kind: "race", name: "Who voted for the independent", page: null,                built: false, unavailable: "needs an AP VoteCast licence" },
  { id: "B13", kind: "race", name: "Versus the 2024 presidential ticket, by area", page: "/g/swing.html", built: true },
  { id: "B14", kind: "race", name: "Head-to-head",                  page: "/g/head-to-head.html", built: true },
  // C: the independent movement
  { id: "C1",  kind: "movement", name: "Featured races board",      page: "/g/board.html",     built: true },
  { id: "C2",  kind: "movement", name: "Independents across the map", page: "/g/ind-map.html",              built: true },
  { id: "C3",  kind: "movement", name: "Big-number stats",          page: "/g/big-numbers.html",                built: true },
  { id: "C4",  kind: "movement", name: "Independents in Congress, historically", page: "/g/history.html",   built: true },
  { id: "C5",  kind: "movement", name: "Top independent performers tonight", page: "/g/top-independents.html", built: true },
  { id: "C6",  kind: "movement", name: "National independent vote", page: "/g/ind-vote.html",  built: true },
  { id: "C7",  kind: "movement", name: "Poll vs result",            page: "/g/polls.html",     built: true },
  { id: "C8",  kind: "movement", name: "What if the featured candidates win", page: "/g/scenario.html",      built: true },
  { id: "C9",  kind: "movement", name: "Explainer cards",           page: "/g/explainer.html",                built: true },
  // D: election updates
  { id: "D1",  kind: "movement", name: "State of the Senate races, map", page: "/g/senate-map.html", built: true },
  { id: "D2",  kind: "movement", name: "State of the House races, map",  page: "/g/house-map.html",  built: true },
  { id: "D3",  kind: "movement", name: "Balance of power, Senate",  page: "/g/bop-senate.html", built: true },
  { id: "D4",  kind: "movement", name: "Balance of power, House",   page: "/g/bop-house.html",  built: true },
  { id: "D5",  kind: "movement", name: "Key races grid",            page: "/g/key-races.html",  built: true },
  { id: "D6",  kind: "movement", name: "Race zoom-in",              page: "/g/zoom.html",       built: true, needsRace: true },
  { id: "D7",  kind: "movement", name: "Status map",                page: "/g/tiles.html",      built: true },
  { id: "D8",  kind: "movement", name: "Calls timeline",            page: "/g/calls-timeline.html",                 built: true },
  { id: "D9",  kind: "movement", name: "State overview",            page: "/g/state-overview.html", built: true, needsState: true },
  { id: "D10", kind: "movement", name: "National popular vote",     page: "/g/house-pv.html",   built: true },
  { id: "D11", kind: "movement", name: "Too close to call",         page: "/g/too-close.html",  built: true },
  { id: "D12", kind: "movement", name: "The benchmark board",       page: "/g/benchmark.html",  built: true, added: "2026-10-29" },
  { id: "D13", kind: "movement", name: "Independent scoreboard",    page: "/g/scoreboard.html", built: true, added: "2026-10-29" },
  // F: from the AP reports feed
  { id: "F1",  kind: "other", name: "Balance of power from AP Trend", page: "/g/reports.html?view=bop",              built: true },
  { id: "F2",  kind: "other", name: "House composition and net change", page: "/g/reports.html?view=house",            built: true },
  { id: "F3",  kind: "other", name: "Closing times by district",    page: "/g/reports.html?view=closing",                built: true },
  { id: "F4",  kind: "other", name: "How this state counts",        page: "/g/reports.html?view=counts", built: true, needsState: true },
  { id: "F5",  kind: "other", name: "When to expect results",       page: "/g/reports.html?view=expect",                built: true },
  { id: "F6",  kind: "other", name: "Ballot roster and status",     page: "/g/reports.html?view=roster", built: true, needsState: true },
  { id: "F7",  kind: "other", name: "Party names from AP codes",    page: "/g/reports.html?view=parties",                built: true },
];

/** The chart whose page is this URL (pathname plus any query the registry entry carries, e.g. reports.html?view=counts). */
export function chartForPage(pathname, search = "") {
  const path = pathname.replace(/\.html$/, ""), q = new URLSearchParams(search);
  return CHARTS.find((c) => {
    if (!c.page) return false;
    const [p, pq] = c.page.split("?");
    return p.replace(/\.html$/, "") === path && [...new URLSearchParams(pq ?? "")].every(([k, v]) => q.get(k) === v);
  }) ?? null;
}
/** The chart-id address (/g/B5?...) for a page address, or null when the page is not a chart. The page's own
 *  query (view=...) is dropped; everything else, including id=, is kept and resolved by the router. */
export function canonicalAddress(pathname, search = "") {
  const c = chartForPage(pathname, search);
  if (!c || !c.page.startsWith("/g/")) return null;
  const own = new URLSearchParams((c.page.split("?")[1]) ?? "");
  const q = new URLSearchParams(search);
  for (const k of own.keys()) q.delete(k);
  const s = q.toString();
  return `/g/${c.id}${s ? "?" + s : ""}`;
}

/** The shipped state. pinnedRaceIds is the ticker list (the name the ticker has always read). */
export const DEFAULTS = Object.freeze({
  pinnedRaceIds: FEATURED_RACES.map((r) => r.id),
  callHighlight: true,
  manualItems: [],
  idleText: "Welcome to the Independent Election Night coverage",
  tickerBg: "black",          // the live ticker's background when its address names none ("" transparent, black, green)
  featuredRaceIds: FEATURED_RACES.map((r) => r.id),
  featuredCharts: ["B5", "B6", "B7", "B8", "B9", "B10", "B13"],
  movementCharts: ["C1", "C6", "C7", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D10", "D11", "D12", "D13"],
  keyRaceIds: [],            // D5; empty means "the ticker races"
  persistentCharts: [],      // A series elements in the Persistent Elements section (never A1, the ticker)
  persistentSettings: {},    // per element inputs: A2 {name, title}, A3 {raceId}, A4 {raceId}
  contextLines: {},          // D6: raceId -> one line the producer typed
  // Live Screens: two fixed pages (/live-screen-one, /live-screen-two), each showing one published chart. chart is a
  // chart id, race a race id (NE-SEN), state two letters for state charts, params the chart's extra address parameters.
  screenA: { chart: "B5", race: "NE-SEN", state: "", params: {}, bg: "black" },
  screenB: { chart: "C1", race: "", state: "", params: {}, bg: "black" },
  updatedAt: null,
  updatedBy: null,   // who published (the signer's name); set by the server on every publish
});
const SCREENS = ["screenA", "screenB"];
/** One Live Screen definition, validated: a built chart id, a race id or AP id, a state, and up to 12 short parameters. */
function screenDef(raw, dflt) {
  if (!raw || typeof raw !== "object") return structuredClone(dflt);   // absent (older stored state): the shipped screen
  const r = raw;
  const id = String(r.chart ?? "").toUpperCase();
  const chart = CHARTS.some((c) => c.id === id && c.built && !c.retired && c.page) ? id : dflt.chart;
  const race = typeof r.race === "string" ? r.race.trim().toUpperCase().slice(0, 40) : "";
  const state = /^[A-Za-z]{2}$/.test(r.state ?? "") ? r.state.toUpperCase() : "";
  const params = {};
  for (const [k, v] of Object.entries(r.params && typeof r.params === "object" ? r.params : {})) if (/^[a-zA-Z]{1,12}$/.test(k) && typeof v === "string" && v.trim()) params[k] = v.trim().slice(0, 200);
  const bg = ["", "black", "green"].includes(r.bg) ? r.bg : dflt.bg;   // the screen's background when its address names none
  return { chart, race, state, params: Object.fromEntries(Object.entries(params).slice(0, 12)), bg };
}
/** The chart-id address a Live Screen shows: /g/<chart>?bg=..&opacity=..&race=..&<params>. display: {bg, opacity, sample, preview}. */
export function screenAddress(s, display = {}) {
  const chart = CHARTS.find((c) => c.id === s.chart);
  const p = new URLSearchParams();
  if (display.bg) p.set("bg", display.bg);
  if (display.opacity && display.opacity !== "100") p.set("opacity", display.opacity);
  if (s.race && (chart?.kind === "race" || chart?.needsRace || chart?.needsState)) p.set("race", s.race);
  if (s.state && chart?.needsState) p.set("state", s.state);
  for (const [k, v] of Object.entries(s.params ?? {})) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(display)) if (!["bg", "opacity"].includes(k) && v) p.set(k, v);
  const q = p.toString();
  return `/g/${s.chart}${q ? "?" + q : ""}`;
}
/** "B5 Live race result · NE-SEN · cand=Ricketts" for dialogs and the live parameters table. */
export function describeScreen(s) {
  const c = CHARTS.find((x) => x.id === s.chart);
  const extra = Object.entries(s.params ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
  return `${s.chart} ${c?.name ?? ""}${s.race ? " · " + s.race : s.state ? " · " + s.state : ""}${extra ? " · " + extra : ""} · on ${s.bg || "transparent"}`;
}

const LIMITS = { pins: 60, featured: 40, manual: 20, text: 240, key: 8, context: 120 };
const idOk = (s) => typeof s === "string" && /^[0-9]{1,12}$/.test(s);
const uniqIds = (arr, max) => [...new Set((Array.isArray(arr) ? arr : []).filter(idOk))].slice(0, max);
const chartIds = (arr, kind) => {
  const known = new Set(CHARTS.filter((c) => c.kind === kind && !c.retired && c.id !== "A1").map((c) => c.id));
  return [...new Set((Array.isArray(arr) ? arr : []).filter((id) => known.has(id)))];
};

/**
 * Coerce anything (a Blob file, a localStorage blob, a request body) into a complete, valid
 * state. Fields that are missing or invalid take the shipped default; an empty ticker list
 * means the default list, because the ticker must always have at least one race.
 * Pure and dependency-free so the API and the browser share it.
 */
export function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pins = uniqIds(r.pinnedRaceIds, LIMITS.pins);
  const manual = (Array.isArray(r.manualItems) ? r.manualItems : [])
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ id: String(m.id ?? Date.now()).slice(0, 40), text: m.text.trim().slice(0, LIMITS.text), createdAt: m.createdAt ?? new Date().toISOString() }))
    .slice(0, LIMITS.manual);
  const context = {};
  if (r.contextLines && typeof r.contextLines === "object") {
    for (const [k, v] of Object.entries(r.contextLines)) if (idOk(k) && typeof v === "string" && v.trim()) context[k] = v.trim().slice(0, LIMITS.context);
  }
  return {
    pinnedRaceIds: pins.length ? pins : [...DEFAULTS.pinnedRaceIds],
    callHighlight: typeof r.callHighlight === "boolean" ? r.callHighlight : DEFAULTS.callHighlight,
    manualItems: manual,
    idleText: typeof r.idleText === "string" ? r.idleText.trim().slice(0, LIMITS.text) : "",
    tickerBg: ["", "black", "green"].includes(r.tickerBg) ? r.tickerBg : DEFAULTS.tickerBg,
    featuredRaceIds: Array.isArray(r.featuredRaceIds) ? uniqIds(r.featuredRaceIds, LIMITS.featured) : [...DEFAULTS.featuredRaceIds],
    featuredCharts: Array.isArray(r.featuredCharts) ? chartIds(r.featuredCharts, "race") : [...DEFAULTS.featuredCharts],
    movementCharts: Array.isArray(r.movementCharts) ? chartIds(r.movementCharts, "movement") : [...DEFAULTS.movementCharts],
    keyRaceIds: uniqIds(r.keyRaceIds, LIMITS.key),
    persistentCharts: Array.isArray(r.persistentCharts) ? chartIds(r.persistentCharts, "other").filter((id) => id[0] === "A") : [],
    persistentSettings: (() => { const out = {}; const src = r.persistentSettings && typeof r.persistentSettings === "object" ? r.persistentSettings : {}; for (const [k, v] of Object.entries(src)) { if (!/^A\d+$/.test(k) || !v || typeof v !== "object") continue; const o = {}; for (const [f, x] of Object.entries(v)) if (/^[a-zA-Z]+$/.test(f) && typeof x === "string") o[f] = x.trim().slice(0, LIMITS.context); out[k] = o; } return out; })(),
    contextLines: context,
    screenA: screenDef(r.screenA, DEFAULTS.screenA),
    screenB: screenDef(r.screenB, DEFAULTS.screenB),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" && r.updatedBy.trim() ? r.updatedBy.trim().slice(0, 40) : null,
  };
}

/** True when two states would produce the same ticker and graphics. */
export function sameState(a, b) {
  const A = normalize(a), B = normalize(b);
  delete A.updatedAt; delete B.updatedAt; delete A.updatedBy; delete B.updatedBy;
  return JSON.stringify(A) === JSON.stringify(B);
}

/** Plain-English list of what changes going from `from` to `to`, per field. Empty when nothing does. */
export function diffState(from, to) {
  const A = normalize(from), B = normalize(to);
  const out = [];
  // Race ids are wrapped in {id} so the Studio can print labels instead of AP numbers.
  const list = (field, label, isRace) => {
    const a = A[field], b = B[field];
    const wrap = (x) => (isRace ? `{${x}}` : x);
    const added = b.filter((x) => !a.includes(x)), removed = a.filter((x) => !b.includes(x));
    const reordered = !added.length && !removed.length && a.join() !== b.join();
    if (added.length) out.push({ field, text: `${label}: added ${added.map(wrap).join(", ")}` });
    if (removed.length) out.push({ field, text: `${label}: removed ${removed.map(wrap).join(", ")}` });
    if (reordered) out.push({ field, text: `${label}: order changes to ${b.map(wrap).join(", ")} (was ${a.map(wrap).join(", ")})` });
    else if ((added.length || removed.length) && a.join() !== b.join()) out.push({ field, text: `${label}: order is now ${b.map(wrap).join(", ")}` });
  };
  list("pinnedRaceIds", "Ticker races", true);
  list("featuredRaceIds", "Featured races", true);
  list("featuredCharts", "Featured charts", false);
  list("movementCharts", "Movement charts", false);
  list("keyRaceIds", "Key races", true);
  list("persistentCharts", "Persistent elements", false);
  for (const k of SCREENS) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push({ field: k, text: `Live Screen ${k === "screenA" ? "One" : "Two"}: ${describeScreen(B[k])} (was ${describeScreen(A[k])})` });
  for (const k of new Set([...Object.keys(A.persistentSettings), ...Object.keys(B.persistentSettings)])) {
    if (JSON.stringify(A.persistentSettings[k] ?? {}) !== JSON.stringify(B.persistentSettings[k] ?? {})) out.push({ field: "persistentSettings", text: `${k} settings: ${Object.entries(B.persistentSettings[k] ?? {}).map(([f, v]) => `${f} "${v}"`).join(", ") || "(cleared)"}` });
  }
  if (A.callHighlight !== B.callHighlight) out.push({ field: "callHighlight", text: `AP Call highlight: ${B.callHighlight ? "on" : "off"}` });
  if (A.idleText !== B.idleText) out.push({ field: "idleText", text: `Idle text: "${B.idleText || "(none)"}"` });
  if (A.tickerBg !== B.tickerBg) out.push({ field: "tickerBg", text: `Ticker background: ${B.tickerBg || "transparent"}` });
  const am = A.manualItems.map((m) => m.text), bm = B.manualItems.map((m) => m.text);
  for (const t of bm.filter((t) => !am.includes(t))) out.push({ field: "manualItems", text: `Manual item added: "${t}"` });
  for (const t of am.filter((t) => !bm.includes(t))) out.push({ field: "manualItems", text: `Manual item removed: "${t}"` });
  for (const k of new Set([...Object.keys(A.contextLines), ...Object.keys(B.contextLines)])) {
    if (A.contextLines[k] !== B.contextLines[k]) out.push({ field: "contextLines", text: `Context line for {${k}}: "${B.contextLines[k] ?? "(removed)"}"` });
  }
  return out;
}

// ---------- browser-side storage (safe when storage is blocked) ----------
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export function readLocal() { try { const raw = ls.get(LS_LOCAL); return raw ? normalize(JSON.parse(raw)) : null; } catch { return null; } }
export function saveLocal(state) { const s = normalize({ ...state, updatedAt: new Date().toISOString() }); ls.set(LS_LOCAL, JSON.stringify(s)); return s; }
export function getSavedSource() { const s = ls.get(LS_SOURCE); return SOURCES.includes(s) ? s : "global"; }
export function setSavedSource(src) { if (SOURCES.includes(src)) ls.set(LS_SOURCE, src); }

/** Which source this page should use: the URL wins, then the saved selector, then global. */
function requestedSource(search = location.search) {
  const q = new URLSearchParams(search).get("src");
  return SOURCES.includes(q) ? q : getSavedSource();
}

// Production is read as a static file through the CDN, never through a function: every open ticker and graphic
// asks for the same address within each 5 s bucket, so the CDN answers all of them from one copy and a flood of
// readers (ours or anyone's) costs no invocations. The Studio's Pull and conflict check still use
// GET /api/producer, which is uncached and authoritative. A store that has never been published to is a 404: the defaults.
export const GLOBAL_BUCKET_MS = 5_000;
export async function loadGlobal() {
  const res = await fetch(`/data/producer.json?t=${Math.floor(Date.now() / GLOBAL_BUCKET_MS)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return normalize(DEFAULTS);
  if (!res.ok) throw new Error(`producer: ${res.status}`);
  return normalize(await res.json());
}

/** The fields the Live Global Ticker is made of: the only ones that are ever published. Everything else a page needs comes
 *  from its address or the shipped defaults. */
export const TICKER_FIELDS = ["pinnedRaceIds", "callHighlight", "manualItems", "idleText", "tickerBg"];
/** Everything that is ever published: the ticker fields and the two Live Screens. */
export const PUBLISHED_FIELDS = [...TICKER_FIELDS, "screenA", "screenB"];

/**
 * Resolve the state for a source once. Non-ticker fields are always the shipped defaults (a page's address
 * overrides them, see urlOverrides); the ticker fields come from the live ticker (global), this browser's
 * saved builder (local) or the defaults. Returns {state, source, requested, error}.
 */
async function loadState(requested = requestedSource(), { lastGlobal = null } = {}) {
  const base = normalize(DEFAULTS);
  const withTicker = (s) => normalize({ ...base, ...Object.fromEntries(PUBLISHED_FIELDS.map((k) => [k, s[k]])) });
  if (requested === "default") return { state: base, source: "default", requested, error: null };
  if (requested === "local") {
    const local = readLocal();
    if (local) return { state: local, source: "local", requested, error: null };
  }
  try {
    return { state: withTicker(await loadGlobal()), source: "global", requested, error: null };
  } catch (e) {
    if (lastGlobal) return { state: lastGlobal, source: "global", requested, error: e.message };
    return { state: base, source: "default", requested, error: e.message };
  }
}

// ---------- a page's address has the final say ----------
// ?races=NE-SEN,MT-SEN  the race list a chart draws or highlights (featured, key and ticker lists alike); race ids or AP ids
// ?context=<text>       the D6 context line for the race in ?id=
// Race ids are resolved against the live index, fetched once per page; the featured races resolve without it.
let indexRaces = null;
async function resolveRaceKeys(keys) {
  const feat = FEATURED_RACES.map((r) => ({ label: r.label, id: r.id }));
  const need = keys.some((k) => !/^\d{1,12}$/.test(k) && !feat.some((f) => f.label === k.toUpperCase()));
  if (need && indexRaces === null && !new URLSearchParams(location.search).get("demo")) {
    try { indexRaces = (await (await fetch("/data/index.json", { cache: "no-store", signal: AbortSignal.timeout(6000) })).json()).races ?? []; } catch { indexRaces = []; }
  }
  const list = [...feat, ...(indexRaces ?? [])];
  return keys.map((k) => (/^\d{1,12}$/.test(k) ? k : list.find((r) => r.label === k.toUpperCase())?.id ?? null)).filter(Boolean);
}
async function urlOverrides(search = location.search) {
  const q = new URLSearchParams(search);
  const o = {};
  if (q.has("races")) { const ids = await resolveRaceKeys(q.get("races").split(",").map((s) => s.trim()).filter(Boolean)); o.featuredRaceIds = ids; o.keyRaceIds = ids; if (ids.length) o.pinnedRaceIds = ids; }
  if (q.has("context") && q.get("id")) o.contextLines = { [q.get("id")]: q.get("context") };
  return o;
}

export function watchState({ source = requestedSource(), intervalMs = 0, onState, preview = new URLSearchParams(location.search).get("preview") === "1" } = {}) {
  // intervalMs > 0 re-reads the live ticker on a timer (the ticker itself does; graphics read once). Local changes
  // made in another tab of this browser arrive through the storage event; the Studio can post a draft with
  // postMessage {type:"producer", state} (preview mode). The address's own parameters sit on top of all of it.
  let requested = source;
  let lastGlobal = null;
  let current = null;
  let pushed = null;
  let timer = null;
  const overrides = urlOverrides();
  const emit = async (state, info) => {
    const merged = normalize({ ...state, ...(await overrides) });
    const key = JSON.stringify(merged);
    if (current === key) return;
    current = key;
    onState?.(merged, info);
  };
  async function tick() {
    if (pushed) return;
    const r = await loadState(requested, { lastGlobal });
    if (r.source === "global" && !r.error) lastGlobal = r.state;
    emit(r.state, { source: r.source, requested, error: r.error, preview: false });
  }
  const onStorage = (e) => { if (e.key === LS_LOCAL || e.key === LS_SOURCE) tick(); };
  const onMessage = (e) => {
    if (e.data?.type === "producer" && e.data.state) { pushed = normalize(e.data.state); emit(pushed, { source: "preview", requested, error: null, preview: true }); }
    if (e.data?.type === "producer-source" && SOURCES.includes(e.data.source)) { pushed = null; requested = e.data.source; tick(); }
  };
  window.addEventListener("storage", onStorage);
  if (preview) window.addEventListener("message", onMessage);
  tick();
  if (intervalMs > 0) timer = setInterval(tick, intervalMs);
  return {
    get state() { return current ? JSON.parse(current) : null; },
    setSource(src) { if (SOURCES.includes(src)) { requested = src; tick(); } },
    refresh: tick,
    stop() { clearInterval(timer); window.removeEventListener("storage", onStorage); window.removeEventListener("message", onMessage); },
  };
}
