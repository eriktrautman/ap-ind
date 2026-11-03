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

// ?chartbg=<id>: a designated image inside the chart's panel, behind its contents. The page behind the panel is ?bg= (Outer Background).
// A new choice is an entry here plus its file in public/g/bg/. Lower thirds, strips and static images have no chart panel to fill.
export const CHART_BACKGROUNDS = [["", "None"], ["ali-race-card", "Ali Race Card BG"]];
export const chartTakesBackground = (id) => !/^[AI]/.test(String(id));
export function applyChartBackground(search = typeof location === "undefined" ? "" : location.search) {
  if (typeof document === "undefined") return;
  const id = new URLSearchParams(search).get("chartbg");
  if (!id || !CHART_BACKGROUNDS.some(([v]) => v === id)) return;
  // The art is drawn at 1920 wide with a red rule 172 px down, starting at the panel's left margin: it fits the panel's width and slides so
  // that rule lands exactly on the chart's header line, whose own line it replaces. Where that leaves a gap above, the art's navy fades in.
  const SCALE = 1728 / 1920, RULE = 172 * SCALE, NAVY = "#04204f";
  const style = document.createElement("style");
  const paint = (y) => { style.textContent = `.panel { background: linear-gradient(${NAVY}, ${NAVY} ${Math.max(0, y)}px, transparent ${Math.max(0, y) + 30}px), url(/g/bg/${id}.jpg) 0 ${y}px / 1728px auto no-repeat, ${NAVY} !important; text-shadow: 0 1px 6px rgba(0, 10, 40, .85); } .panel .head { border-bottom-color: transparent !important; }`; };
  paint(-Math.round((1080 * SCALE - 920) / 2));
  document.head.appendChild(style);
  const fit = () => { const h = document.querySelector(".panel > .head"); if (h && h.offsetHeight) paint(Math.round(h.offsetTop + h.offsetHeight - RULE)); };
  const start = () => { fit(); const h = document.querySelector(".panel > .head"); if (h && typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(h); };
  document.body ? start() : document.addEventListener("DOMContentLoaded", start);
}
applyChartBackground();

// ?fit=1 (the Studio's Preview links and its thumbnails): keep the 1920x1080 layout but scale it to the
// window, so a producer on a laptop sees the whole graphic, and a thumbnail frame half the size paints a
// quarter of the pixels. Broadcast outputs never pass it. Node imports this module too, hence the guard.
export function applyFit(search = typeof location === "undefined" ? "" : location.search) {
  if (typeof document === "undefined" || new URLSearchParams(search).get("fit") !== "1") return;
  const fit = () => {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080, 1);
    document.body.style.transformOrigin = "0 0";
    document.body.style.transform = `scale(${k})`;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.background = getComputedStyle(document.body).backgroundColor;
  };
  window.addEventListener("resize", fit);
  document.body ? fit() : document.addEventListener("DOMContentLoaded", fit);
}
applyFit();
const LS_LOCAL = "studio.local";

/** The slate: the six independents the broadcast follows (cand = the independent's AP id). Order is the default ticker order. */
export const FEATURED_RACES = [
  { id: "28594", label: "NE-SEN", state: "NE", title: "U.S. Senate", who: "Dan Osborn", cand: "168007" },
  { id: "27607", label: "MT-SEN", state: "MT", title: "U.S. Senate", who: "Seth Bodnar", cand: "177955" },
  { id: "13252", label: "ID-SEN", state: "ID", title: "U.S. Senate", who: "Todd Achilles", cand: "162421" },
  { id: "42003", label: "SD-SEN", state: "SD", title: "U.S. Senate", who: "Brian Bengs", cand: "70405" },
  { id: "5696",  label: "CA-6",   state: "CA", title: "U.S. House, District 6", who: "Kevin Kiley", cand: "69756" },
  { id: "2015",  label: "AK-AL",  state: "AK", title: "U.S. House, at large", who: "Bill Hill", cand: "177719" },
  // ID-1 (Sarah Zabel) left the slate on 2026-10-29; the candidate stays curated in config/candidates.json.
];

/**
 * Every graphic in the lookbook. kind: race (needs ?id=), movement (C and D series), or other (A and
 * F series). built: a page exists.
 *
 * CHART IDS ARE FIXED (from 27 October 2026). The lookbook ids (B5, C1, D7, ...) have been shared and are
 * used in rundowns and by other people, so an id never changes meaning and is never reused:
 *   - to retire a chart, keep its entry and set retired: true (optionally retiredNote); the Studio
 *     greys it out with a placeholder and refuses to add it, and existing selections drop it cleanly;
 *   - a new chart gets a NEW id at the end of its series (B14, C10, D12, ...), never a freed one;
 *   - renaming a chart's page is fine; renaming its id is not;
 */
/** Every background a page can show behind its graphic: a keying colour, or one of the backplates in public/g/bg/.
 *  The id is the ?bg= value and the body class (bg-capitol); the label is what the Studio's dropdowns say. */
export const BACKGROUNDS = [["", "Transparent"], ["black", "Black"], ["green", "Green Key"], ["capitol", "Capitol & flag"], ["flag", "Flag glass"], ["panels", "Red, white & blue"]];
export const BG_IDS = BACKGROUNDS.map(([id]) => id);
export const DEFAULT_BG = "green";   // the background a fresh state, a new draft and the Studio's display settings start on
export const CHARTS = [
  // A: lower thirds and strips (the ticker is the one managed in its own section)
  { id: "A1",  kind: "other", name: "Live ticker",                  page: "/ticker",           built: true },
  { id: "A2",  kind: "other", name: "Name and title lower third",   page: "/g/lower-third.html",                built: true },
  { id: "A3",  kind: "other", name: "Race-status bug",              page: "/g/bug.html",                built: true, needsRace: true },
  { id: "A4",  kind: "other", name: "AP call alert",                page: "/g/call-alert.html", built: true, needsRace: true },
  { id: "A5",  kind: "other", name: "Poll-closing strip",           page: "/g/poll-closing.html",                built: true },
  { id: "A6",  kind: "other", name: "Featured races strip",         page: "/g/featured-strip.html",                built: true },
  // I: a static image from the Studio's image library, in a playlist or on a live screen like any chart. Not listed in the Chart Catalog.
  { id: "I1",  kind: "other", name: "Static image",                 page: "/g/image.html",  built: true },
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
  { id: "B15", kind: "race", name: "Race called",                   page: "/g/called.html", built: true },
  { id: "B16", kind: "race", name: "Photo live race result",        page: "/g/photo-race.html", built: true, added: "2026-11-03", only: (r) => r?.kind !== "measure" && r?.office !== "I" },
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

/** The shipped state. The ticker crawls tickerItems, a sequence of races, text and bundles (named packages of races and
 *  text, defined once and placed anywhere in the sequence, any number of times). pinnedRaceIds and manualItems are derived
 *  from that sequence by normalize() (the races in crawl order, the texts in crawl order) for everything that has always
 *  read them: older addresses, D5's fallback, older clients that publish only those two. */
/** The shipped bundle: the slate's races, one package. The default crawl is this bundle and nothing else. */
export const SLATE_BUNDLE = Object.freeze({ id: "slate", name: "Slate", items: [{ t: "text", id: "mw0ymgx495d9", text: "Independent Slate" }, ...FEATURED_RACES.map((r) => ({ t: "race", id: r.id }))] });
// Every Toss Up and Lean race on Cook's Nov. 2 ratings, plus the races the show already follows, by the time zone their polls close in, earliest
// close first, each opened by a line naming the zone. They wait in the builder until someone places them in the crawl order. A state split across
// zones goes with most of its voters. Alaska closes last and has its own bundle; Hawaii has no race in the set.
const ZONE_DEFS = [
  { id: "easternraces", name: "Eastern Races", races: ["15026", "18015", "10031", "10033", "10396", "11129", "11587", "10019", "10023", "10045", "12029", "12301", "30003", "41922", "41938", "47001", "47003", "47009", "35385", "34977", "35984", "36033", "36043", "36027", "36031", "36005", "84327", "20645", "20643", "23814", "23808", "23811", "24074", "24463", "31218", "39008", "39017", "39014", "39015", "36597", "36601"] },   // IN-5 KY-6 FL-13 FL-14 FL-22 FL-25 FL-27 FL-7 FL-9 FL-GOV GA-GOV GA-SEN NH-SEN SC-1 SC-SEN VA-1 VA-2 VA-5 NC-1 NC-11 NC-SEN OH-10 OH-15 OH-7 OH-9 OH-GOV OH-SEN ME-2 ME-SEN MI-10 MI-4 MI-7 MI-GOV MI-SEN NJ-7 PA-1 PA-10 PA-7 PA-8 NY-17 NY-21
  { id: "centralraces", name: "Central Races", races: ["1374", "17559", "17585", "42003", "45885", "45893", "49478", "49479", "45901", "46643", "17071", "17072", "17073", "17076", "17247", "24007", "24704", "25151", "28385", "28006", "28594", "50040", "50048", "50016"] },   // AL-2 KS-GOV KS-SEN SD-SEN TX-15 TX-23 TX-34 TX-35 TX-GOV TX-SEN IA-1 IA-2 IA-3 IA-GOV IA-SEN MN-1 MN-GOV MN-SEN NE-2 NE-GOV NE-SEN WI-1 WI-3 WI-GOV
  { id: "mountainraces", name: "Mountain Races", races: ["3004", "3006", "3544", "3014", "6616", "6617", "7727", "33279", "13253", "13252", "28447", "27607", "45669"] },   // AZ-1 AZ-2 AZ-6 AZ-GOV CO-4 CO-5 CO-8 NM-2 ID-1 ID-SEN MT-1 MT-SEN UT-1
  { id: "pacificraces", name: "Pacific Races", races: ["30989", "29861", "38019", "5712", "5730", "8149", "5696", "6123", "48009"] },   // NV-2 NV-GOV OR-GOV CA-22 CA-40 CA-48 CA-6 CA-GOV WA-3
  { id: "alaskaraces", name: "Alaska Races", races: ["2015", "2010", "3079"] },   // AK-AL AK-GOV AK-SEN
];
export const ZONE_BUNDLES = Object.freeze(ZONE_DEFS.map(({ id, name, races }) => ({ id, name, items: [{ t: "text", id: `${id}title`, text: name }, ...races.map((r) => ({ t: "race", id: r }))] })));
export const DEFAULTS = Object.freeze({
  tickerItems: [{ t: "bundle", id: SLATE_BUNDLE.id }],   // {t:"race",id} | {t:"text",id,text} | {t:"bundle",id}
  bundles: [SLATE_BUNDLE, ...ZONE_BUNDLES],                               // {id, name, items: [{t:"race",id} | {t:"text",id,text}]}
  pinnedRaceIds: FEATURED_RACES.map((r) => r.id),
  callHighlight: true,
  manualItems: [],
  idleText: "Welcome to the Independent Election Night coverage",
  tickerBg: "green",          // the live ticker's background when its address names none ("" transparent, black, green)
  theme: "election-night-v1", // the stylesheet every output paints with (an id in /g/themes.js); pushed by a producer
  featuredRaceIds: FEATURED_RACES.map((r) => r.id),
  keyRaceIds: [],            // D5; empty means "the ticker races"
  contextLines: {},          // D6: raceId -> one line the producer typed
  // Live Screens: two fixed pages (/live-screen-one, /live-screen-two), each showing one published chart. chart is a
  // chart id, race a race id (NE-SEN), state two letters for state charts, params the chart's extra address parameters.
  screenA: { chart: "B5", race: "NE-SEN", state: "", params: {}, bg: "green" },
  screenB: { chart: "C1", race: "", state: "", params: {}, bg: "green" },
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
  const bg = BG_IDS.includes(r.bg) ? r.bg : dflt.bg;   // the screen's background when its address names none
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
  const extra = Object.entries(s.params ?? {}).map(([k, v]) => (k === "chartbg" ? `chart background ${CHART_BACKGROUNDS.find(([id]) => id === v)?.[1] ?? v}` : `${k}=${v}`)).join(" ");
  return `${s.chart} ${c?.name ?? ""}${s.race ? " · " + s.race : s.state ? " · " + s.state : ""}${extra ? " · " + extra : ""} · on ${s.bg || "transparent"}`;
}

const LIMITS = { pins: 60, featured: 40, manual: 60, text: 240, key: 8, context: 120, seq: 120, bundles: 60, bundleItems: 50, bundleName: 60 };
const idOk = (s) => typeof s === "string" && /^[0-9]{1,12}$/.test(s);
const uniqIds = (arr, max) => [...new Set((Array.isArray(arr) ? arr : []).filter(idOk))].slice(0, max);

// ---------- the ticker sequence ----------
const bundleIdOk = (id) => typeof id === "string" && /^[a-zA-Z0-9]{1,24}$/.test(id);
/** One race, text or bundle entry, validated; null if it is none of those. Text ids are kept (or made from the position). */
function seqItem(it, i, allowBundle) {
  if (!it || typeof it !== "object") return null;
  if (it.t === "race" && idOk(it.id)) return { t: "race", id: it.id };
  if (it.t === "text" && typeof it.text === "string" && it.text.trim()) return { t: "text", id: String(it.id ?? "").slice(0, 40) || `t${i}`, text: it.text.trim().slice(0, LIMITS.text) };
  if (allowBundle && (it.t === "bundle" || it.t === "chunk") && bundleIdOk(it.id)) return { t: "bundle", id: it.id };   // "chunk": the old name, in states saved before the rename
  return null;
}
const seqItems = (raw, allowBundle, max) => (Array.isArray(raw) ? raw : []).map((it, i) => seqItem(it, i, allowBundle)).filter(Boolean).slice(0, max);
export const MAX_BUNDLES = LIMITS.bundles;
/** A list of bundles, validated: ids unique, names and pieces within their limits. */
function bundleList(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c === "object" && bundleIdOk(c.id) && !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ id: c.id, name: typeof c.name === "string" ? c.name.trim().slice(0, LIMITS.bundleName) : "", items: seqItems(c.items, false, LIMITS.bundleItems) })).slice(0, LIMITS.bundles);
}
/** The shared bundle library (bundles.json): what everyone in the Studio builds crawls from. It starts as the shipped bundles. */
export const normalizeBundleLibrary = (raw) => ({ bundles: bundleList(raw?.bundles), updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null, updatedBy: typeof raw?.updatedBy === "string" ? raw.updatedBy : null });
export const defaultBundleLibrary = () => normalizeBundleLibrary({ bundles: structuredClone(DEFAULTS.bundles) });
/** The bundles a state's crawl actually uses: what airs, so what Publish sends and what "differs from live" compares. */
export const airingBundles = (s) => (s.bundles ?? []).filter((b) => (s.tickerItems ?? []).some((it) => it.t === "bundle" && it.id === b.id));
/** A browser's bundles from before the library was shared, joining it once: every library bundle, every bundle only this browser has, and, where
 *  this browser's copy of a library bundle was edited, that copy under its own name so the work survives. An unedited shipped copy needs no keeping. */
export function mergeIntoLibrary(live, mine, newId) {
  const same = (a, b) => a.name === b.name && JSON.stringify(a.items) === JSON.stringify(b.items);
  const titleless = { ...SLATE_BUNDLE, items: SLATE_BUNDLE.items.filter((i) => i.t === "race") };   // the Slate as it first shipped
  const shipped = (c) => [...DEFAULTS.bundles, titleless].some((d) => d.id === c.id && same(d, c));
  const kept = [], copies = [];
  for (const c of mine) {
    const l = live.find((x) => x.id === c.id);
    if (!l) kept.push(c);
    else if (!same(l, c) && !shipped(c)) { const name = `${c.name || c.id} (my copy)`.slice(0, LIMITS.bundleName); kept.push({ ...c, id: newId(), name }); copies.push(name); }
  }
  const bundles = [...live, ...kept];
  return { bundles, copies, over: bundles.length > MAX_BUNDLES };
}
/** The crawl order as flat race and text entries, bundles expanded (a bundle entry becomes its items, each carrying bundle: id). */
export function expandTicker(state) {
  const bundles = new Map((state.bundles ?? []).map((c) => [c.id, c]));
  const out = [];
  for (const it of state.tickerItems ?? []) {
    if (it.t === "bundle") { const c = bundles.get(it.id); if (c) for (const x of c.items) out.push({ ...x, bundle: c.id }); }
    else out.push(it);
  }
  return out;
}
/** The sequence an older state implies: its races in order with a manual item after every two, the rule the ticker had. */
function legacySequence(pins, manual) {
  const out = []; let mi = 0;
  pins.forEach((id, i) => { out.push({ t: "race", id }); if (i % 2 === 1 && mi < manual.length) { const m = manual[mi++]; out.push({ t: "text", id: m.id, text: m.text }); } });
  while (mi < manual.length) { const m = manual[mi++]; out.push({ t: "text", id: m.id, text: m.text }); }
  return out;
}

/**
 * Coerce anything (a Blob file, a localStorage blob, a request body) into a complete, valid
 * state. Fields that are missing or invalid take the shipped default; an empty ticker list
 * means the default list, because the ticker must always have at least one race.
 * Pure and dependency-free so the API and the browser share it.
 */
export function normalize(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  // Bundles first (the sequence may point at them), then the sequence: the stored one, or the one an older state implies.
  const seenBundle = new Set();
  const rawBundles = r.bundles ?? r.chunks;   // chunks: the old name, in states saved before the rename
  const bundles = bundleList(rawBundles);
  bundles.forEach((b) => seenBundle.add(b.id));
  let tickerItems;
  if (Array.isArray(r.tickerItems)) tickerItems = seqItems(r.tickerItems, true, LIMITS.seq).filter((it) => it.t !== "bundle" || seenBundle.has(it.id));
  else {
    const oldPins = uniqIds(r.pinnedRaceIds, LIMITS.pins);
    const oldManual = (Array.isArray(r.manualItems) ? r.manualItems : []).filter((m) => m && typeof m.text === "string" && m.text.trim()).map((m, i) => ({ id: String(m.id ?? `m${i}`).slice(0, 40), text: m.text.trim().slice(0, LIMITS.text) })).slice(0, LIMITS.manual);
    tickerItems = legacySequence(oldPins, oldManual);
  }
  if (!tickerItems.length) {   // the ticker always has something to crawl: the Slate bundle, defined here if the state lacks it
    if (!seenBundle.has(SLATE_BUNDLE.id)) bundles.unshift(structuredClone(SLATE_BUNDLE));
    tickerItems = DEFAULTS.tickerItems.map((it) => ({ ...it }));
  }
  const flat = expandTicker({ tickerItems, bundles });
  const pins = uniqIds(flat.filter((it) => it.t === "race").map((it) => it.id), LIMITS.pins);
  const manual = flat.filter((it) => it.t === "text").map((it) => ({ id: it.id, text: it.text })).slice(0, LIMITS.manual);
  const context = {};
  if (r.contextLines && typeof r.contextLines === "object") {
    for (const [k, v] of Object.entries(r.contextLines)) if (idOk(k) && typeof v === "string" && v.trim()) context[k] = v.trim().slice(0, LIMITS.context);
  }
  return {
    tickerItems,
    bundles,
    pinnedRaceIds: pins.length ? pins : [...DEFAULTS.pinnedRaceIds],   // derived: the races in crawl order (the default list when the crawl has none)
    callHighlight: typeof r.callHighlight === "boolean" ? r.callHighlight : DEFAULTS.callHighlight,
    manualItems: manual,                                                 // derived: the texts in crawl order
    idleText: typeof r.idleText === "string" ? r.idleText.trim().slice(0, LIMITS.text) : "",
    tickerBg: BG_IDS.includes(r.tickerBg) ? r.tickerBg : DEFAULTS.tickerBg,
    theme: typeof r.theme === "string" && /^[a-z0-9-]{1,40}$/.test(r.theme) ? r.theme : DEFAULTS.theme,
    featuredRaceIds: Array.isArray(r.featuredRaceIds) ? uniqIds(r.featuredRaceIds, LIMITS.featured) : [...DEFAULTS.featuredRaceIds],
    keyRaceIds: uniqIds(r.keyRaceIds, LIMITS.key),
    contextLines: context,
    stamps: Object.fromEntries(["ticker", ...SCREENS].flatMap((k) => { const s = r.stamps?.[k]; return typeof s?.at === "string" ? [[k, { at: s.at, by: typeof s.by === "string" ? s.by : null }]] : []; })),   // who published each of the three outputs, and when; only the server writes it
    screenA: screenDef(r.screenA, DEFAULTS.screenA),
    screenB: screenDef(r.screenB, DEFAULTS.screenB),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" && r.updatedBy.trim() ? r.updatedBy.trim().slice(0, 40) : null,
  };
}

// ---------- playlists ----------
// A playlist is one person's run of charts for a segment, in order. Each item is a chart spec of the same shape as a Live
// Screen definition (chart, race, state, params, bg). Playlists are shared: they live in playlists.json beside the published
// state and are edited through /api/playlists (publisher or producer; only a producer adds, renames or removes people and
// playlists). Every chart the Studio keeps close lives in one: the shipped set is General (Slate, Race Overview, Movement Overview) and Ryan.
export const PLAYLIST_LIMITS = { users: 40, playlists: 40, items: 80, name: 60 };
export const PLAYLIST_SLATE_CHARTS = ["B5", "B6", "B7", "B8", "B10", "B13"];   // B9 is ranked-choice only
const plId = (s) => (typeof s === "string" && /^[a-zA-Z0-9]{1,24}$/.test(s) ? s : null);
const plName = (s) => (typeof s === "string" ? s.trim().slice(0, PLAYLIST_LIMITS.name) : "");
/** One chart spec, validated like a Live Screen definition; null when the chart id is not a built chart. */
export function specDef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.chart ?? "").toUpperCase();
  if (!CHARTS.some((c) => c.id === id && c.built && !c.retired && c.page)) return null;
  return screenDef({ ...raw, chart: id }, { ...DEFAULTS.screenA, chart: id });
}
export function normalizePlaylists(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const seenU = new Set();
  const users = (Array.isArray(r.users) ? r.users : []).filter((u) => u && typeof u === "object" && plId(u.id) && !seenU.has(u.id) && seenU.add(u.id)).slice(0, PLAYLIST_LIMITS.users).map((u) => {
    const seenP = new Set();
    const playlists = (Array.isArray(u.playlists) ? u.playlists : []).filter((p) => p && typeof p === "object" && plId(p.id) && !seenP.has(p.id) && seenP.add(p.id)).slice(0, PLAYLIST_LIMITS.playlists)
      .map((p) => ({ id: p.id, name: plName(p.name), items: (Array.isArray(p.items) ? p.items : []).map(specDef).filter(Boolean).slice(0, PLAYLIST_LIMITS.items) }));
    return { id: u.id, name: plName(u.name), playlists };
  });
  // Charts a producer has marked as on the way out: grayed in the Studio's catalogs and playlists, and still fully usable.
  const deprecatedCharts = [...new Set((Array.isArray(r.deprecatedCharts) ? r.deprecatedCharts : []).filter((id) => CHARTS.some((c) => c.id === id && !c.retired && id !== "A1")))];
  return { users, deprecatedCharts, generalSeeded: r.generalSeeded === true, ryanB16Seeded: r.ryanB16Seeded === true, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null, updatedBy: typeof r.updatedBy === "string" && r.updatedBy.trim() ? r.updatedBy.trim().slice(0, 40) : null };
}
export const PLAYLIST_RACE_OVERVIEW = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D10", "D11", "D12", "D13"];
export const PLAYLIST_MOVEMENT_OVERVIEW = ["C1", "C6", "C7"];
const plSpec = (chart, race = "") => ({ chart, race, state: "", params: {}, bg: DEFAULT_BG });
const slateItems = () => FEATURED_RACES.flatMap((r) => PLAYLIST_SLATE_CHARTS.map((chart) => plSpec(chart, r.label)));
/** General: the slate's races with six charts each, the charts for many races at once, and the movement as a whole. */
const generalPerson = () => ({ id: "general", name: "General", playlists: [
  { id: "slate", name: "Slate", items: slateItems() },
  // D6 draws one race, so it starts on the first of the slate
  { id: "raceoverview", name: "Race Overview", items: PLAYLIST_RACE_OVERVIEW.map((chart) => plSpec(chart, chart === "D6" ? FEATURED_RACES[0].label : "")) },
  { id: "movementoverview", name: "Movement Overview", items: PLAYLIST_MOVEMENT_OVERVIEW.map((chart) => plSpec(chart)) },
] });
/** The shipped playlists: General, then Ryan with the same slate. */
const b5ToB16 = (s) => (s.chart === "B5" ? { ...s, chart: "B16" } : s);
export function defaultPlaylists() {
  return normalizePlaylists({ generalSeeded: true, ryanB16Seeded: true, users: [generalPerson(), { id: "ryan", name: "Ryan", playlists: [{ id: "slate", name: "Slate", items: slateItems().map(b5ToB16) }] }] });
}
/** A stored document from before General existed gains it once, in front. The flag goes back with the next write, so a
 *  producer who later removes General does not see it return. */
export function seedPlaylists(doc) {
  if (doc.generalSeeded && doc.ryanB16Seeded) return doc;
  let users = doc.generalSeeded || doc.users.some((u) => u.id === "general") ? doc.users : [generalPerson(), ...doc.users];
  // Ryan's B5s became B16s once, on 2026-11-03; the same flag rule, so a B5 put back in by hand stays.
  if (!doc.ryanB16Seeded) users = users.map((u) => (u.id !== "ryan" ? u : { ...u, playlists: u.playlists.map((p) => ({ ...p, items: p.items.map(b5ToB16) })) }));
  return normalizePlaylists({ ...doc, users, generalSeeded: true, ryanB16Seeded: true });
}

// The image library (images.json, /api/images). A file's name is random and is written once, so an address never changes what it shows.
export const IMAGE_CHART = "I1";
export const IMAGE_LAYOUTS = [["fill", "Fill the frame (crops the edges)"], ["fit", "Fit the whole image (bars)"], ["lower", "Across the bottom (lower third)"], ["corner", "Top right corner"], ["panel", "In a chart panel, with the caption as its title"]];
export const IMAGE_LIMITS = { count: 500, name: 80, credit: 160, bytes: 3_000_000, thumbBytes: 150_000 };   // a Vercel function takes 4.5 MB, and base64 adds a third
export const imageNameOk = (s) => typeof s === "string" && /^[a-zA-Z0-9]{1,24}(-t)?\.(jpg|png|webp)$/.test(s);
export function normalizeLibrary(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const images = (Array.isArray(r.images) ? r.images : []).filter((x) => x && imageNameOk(x.file) && imageNameOk(x.thumb)).slice(0, IMAGE_LIMITS.count).map((x) => ({
    file: x.file, thumb: x.thumb, name: String(x.name ?? "").slice(0, IMAGE_LIMITS.name), credit: String(x.credit ?? "").slice(0, IMAGE_LIMITS.credit),
    w: Number(x.w) || 0, h: Number(x.h) || 0, bytes: Number(x.bytes) || 0, alpha: x.alpha === true, deprecated: x.deprecated === true,
    uploadedBy: typeof x.uploadedBy === "string" ? x.uploadedBy.slice(0, 40) : null, uploadedAt: typeof x.uploadedAt === "string" ? x.uploadedAt : null,
  }));
  return { images, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null, updatedBy: typeof r.updatedBy === "string" ? r.updatedBy.slice(0, 40) : null };
}

/** The letter after a candidate's name: D, R, L (Libertarian), G (Green); I for the slate's independents and every other
 *  non-major label (NP, NPA, Una, minor parties), so the only I in a race is normally our independent; nothing for a
 *  measure's Yes/No options. The colour classes (partyKey in feed.js) are a separate question and unchanged. */
export function partyLetter(c) {
  if (!c || c.party === "Yes" || c.party === "No") return "";
  if (c.party === "Dem") return "D";
  if (c.party === "GOP") return "R";
  if (c.party === "Lib") return "L";
  if (c.party === "Grn") return "G";
  return "I";
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
  // The crawl: one line naming the new order when anything in it changes; bundles by name.
  const seqText = (st) => st.tickerItems.map((it) => it.t === "race" ? `{${it.id}}` : it.t === "text" ? `"${it.text}"` : `[${st.bundles.find((c) => c.id === it.id)?.name || "bundle"}]`).join(", ");
  if (JSON.stringify(A.tickerItems) !== JSON.stringify(B.tickerItems)) out.push({ field: "tickerItems", text: `Crawl order: ${seqText(B)} (was ${seqText(A)})` });
  const itemsText = (c) => c.items.map((it) => it.t === "race" ? `{${it.id}}` : `"${it.text}"`).join(", ") || "(empty)";
  for (const id of new Set([...A.bundles.map((c) => c.id), ...B.bundles.map((c) => c.id)])) {
    const a = A.bundles.find((c) => c.id === id), b = B.bundles.find((c) => c.id === id);
    if (a && !b) out.push({ field: "bundles", text: `Bundle "${a.name || id}" removed` });
    else if (!a && b) out.push({ field: "bundles", text: `Bundle "${b.name || id}" added: ${itemsText(b)}` });
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: "bundles", text: `Bundle "${b.name || id}"${a.name !== b.name ? ` (was "${a.name || id}")` : ""}: ${itemsText(b)}` });
  }
  list("featuredRaceIds", "Featured races", true);
  list("keyRaceIds", "Key races", true);
  for (const k of SCREENS) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push({ field: k, text: `Live Screen ${k === "screenA" ? "One" : "Two"}: ${describeScreen(B[k])} (was ${describeScreen(A[k])})` });
  if (A.callHighlight !== B.callHighlight) out.push({ field: "callHighlight", text: `AP Call highlight: ${B.callHighlight ? "on" : "off"}` });
  if (A.idleText !== B.idleText) out.push({ field: "idleText", text: `Idle text: "${B.idleText || "(none)"}"` });
  if (A.tickerBg !== B.tickerBg) out.push({ field: "tickerBg", text: `Ticker background: ${B.tickerBg || "transparent"}` });
  if (A.theme !== B.theme) out.push({ field: "theme", text: `Stylesheet: ${B.theme}` });
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

/** Which source this page should use: the URL wins, else global. An old saved choice must never turn a live ticker into this browser's draft. */
function requestedSource(search = location.search) {
  const q = new URLSearchParams(search).get("src");
  return SOURCES.includes(q) ? q : "global";
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
export const TICKER_FIELDS = ["tickerItems", "bundles", "pinnedRaceIds", "callHighlight", "manualItems", "idleText", "tickerBg"];
/** Everything that is ever published: the ticker fields and the two Live Screens. */
export const PUBLISHED_FIELDS = [...TICKER_FIELDS, "screenA", "screenB", "theme"];

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
  const onStorage = (e) => { if (e.key === LS_LOCAL) tick(); };
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
