// AP Elections API v3 client for the watch-party poller. Mirrors the broadcast server's
// ap.ts/model.ts in plain JS so the serverless bundle has no TypeScript or JSON-import needs.

// AP_API_BASE exists for the test suite, which points it at a port nobody answers to rehearse a lost AP.
const base = () => process.env.AP_API_BASE ?? "https://api.ap.org/v3";

// Runtime overrides (from settings.json in Blob) win over the environment, so the studio
// can switch test/live without a redeploy.
let overrides = {};
export function setOverrides(o) { overrides = o ?? {}; }

export function cfg() {
  const key = process.env.AP_API_KEY;
  if (!key) throw new Error("AP_API_KEY is not set");
  return {
    key,
    electionDate: process.env.AP_ELECTION_DATE ?? "2026-11-03",
    resultsType: overrides.resultsType ?? process.env.AP_RESULTS_TYPE ?? "t",
  };
}

export async function fetchAp(path, params) {
  const { key } = cfg();
  const u = new URL(`${base()}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("format", "json");
  const res = await fetch(u, { headers: { "x-api-key": key, "Accept-Encoding": "gzip", Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) {
    const e = new Error(`AP ${res.status} for ${path}`);
    e.apStatus = res.status;
    throw e;
  }
  return res.json();
}

// Every office the key returns for Nov 3: federal, statewide, ballot measures, big-city mayors.
// State legislatures and other local offices are not in the entitlement.
export const OFFICES = "S,H,G,A,SS,L,USD,RR,I,M";

export async function fetchRaces(level, extra = {}) {
  const { electionDate, resultsType } = cfg();
  return fetchAp(`/elections/${electionDate}`, { officeID: OFFICES, level, resultsType, ...extra });
}

// Party codes that never mean "independent": the two majors, nonpartisan, and ballot-measure sides.
const NOT_INDEPENDENT = new Set(["Dem", "GOP", "NP", "Yes", "No"]);
const PLACEHOLDER = new Set(["Total Write-ins", "Other", "Write-ins", "Blank", "Scattering"]);
const AT_LARGE = new Set(["AK", "DE", "ND", "SD", "VT", "WY"]);

/** Office code → { kind, short badge, long title }. kind groups the site's filters. */
export const OFFICE = {
  S:   { kind: "federal",   badge: "SENATE",   title: "U.S. Senate" },
  H:   { kind: "federal",   badge: "HOUSE",    title: "U.S. House" },
  USD: { kind: "federal",   badge: "DELEGATE", title: "U.S. Delegate" },
  G:   { kind: "governor",  badge: "GOVERNOR", title: "Governor" },
  L:   { kind: "statewide", badge: "LT GOV",   title: "Lieutenant Governor" },
  A:   { kind: "statewide", badge: "AG",       title: "Attorney General" },
  SS:  { kind: "statewide", badge: "SEC STATE", title: "Secretary of State" },
  RR:  { kind: "statewide", badge: "RR COMM",  title: "Railroad Commissioner" },
  I:   { kind: "measure",   badge: "MEASURE",  title: "Ballot measure" },
  M:   { kind: "local",     badge: "MAYOR",    title: "Mayor" },
};

const slug = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
const MEASURE_CODE = { Proposition: "PROP", Amendment: "AMEND", "Constitutional Amendment": "AMEND", Question: "Q", Measure: "MEASURE", Issue: "ISSUE", Proposal: "PROPOSAL", Initiative: "INIT" };

/** Short, URL-safe, human-readable id: GA-SEN, NE-2, AK-AL, AZ-GOV, AZ-PROP-316, CA-MAYOR-LOS-ANGELES. */
export function raceLabel(state, office, seatNum, seatName, r = {}) {
  if (office === "S") return `${state}-SEN`;
  if (office === "H") return AT_LARGE.has(state) || /at large/i.test(seatName ?? "") ? `${state}-AL` : `${state}-${seatNum ?? "?"}`;
  if (office === "G") return `${state}-GOV`;
  if (office === "A") return `${state}-AG`;
  if (office === "SS") return `${state}-SOS`;
  if (office === "L") return `${state}-LTGOV`;
  if (office === "USD") return `${state}-DELEGATE`;
  if (office === "RR") return `${state}-RRC${seatNum ? "-" + seatNum : ""}`;
  if (office === "I") {
    const num = (seatName ?? "").match(/^\s*([A-Z0-9-]+)\s*-/i)?.[1];
    return `${state}-${MEASURE_CODE[r.officeName] ?? "MEASURE"}-${num ?? r.raceID}`;
  }
  if (office === "M") return `${state}-MAYOR${seatName ? "-" + slug(seatName) : ""}`;
  return `${state}-${office}-${r.raceID}`;
}

/** Display title for a race page or row. */
export function raceTitle(state, stateName, office, seatName, r = {}) {
  if (office === "S") return "U.S. Senate";
  if (office === "H") return AT_LARGE.has(state) || /at large/i.test(seatName ?? "") ? "U.S. House, at large" : `U.S. House, ${seatName ?? ""}`;
  if (office === "I") {
    const m = (seatName ?? "").match(/^\s*([A-Z0-9-]+)\s*-\s*(.*)$/i);
    return m ? `${r.officeName ?? "Measure"} ${m[1]}: ${m[2]}` : (r.officeName ?? "Ballot measure");
  }
  if (office === "M") return seatName ? `Mayor of ${seatName}` : "Mayor";
  if (office === "RR") return `Railroad Commissioner${seatName ? ", " + seatName : ""}`;
  return OFFICE[office]?.title ?? r.officeName ?? office;
}

export function isIndependent(c) {
  return !NOT_INDEPENDENT.has(c.party) && !PLACEHOLDER.has(c.last);
}

function fullName(c) {
  return [c.first, c.last, c.suffix].filter(Boolean).join(" ");
}

function unitCandidates(u) {
  const total = u.candidates.reduce((s, c) => s + (c.voteCount ?? 0), 0);
  return u.candidates
    .filter((c) => !PLACEHOLDER.has(c.last))
    .map((c) => ({
      id: c.candidateID, name: fullName(c), last: c.last, party: c.party,
      votes: c.voteCount ?? 0, pct: total ? Math.round(((c.voteCount ?? 0) / total) * 1000) / 10 : 0,
      incumbent: !!c.incumbent, winner: c.winner === "X", independent: isIndependent(c),
    }))
    .sort((a, b) => b.votes - a.votes);
}

/** Normalize an AP race from its state-level unit. Returns null for national aggregates. */
export function normalizeRace(r) {
  const ru = r.reportingUnits.find((u) => u.reportingunitLevel === 1) ?? r.reportingUnits[0];
  if (!ru || ru.reportingunitLevel === 0 || !OFFICE[r.officeID]) return null;
  const candidates = unitCandidates(ru);
  const winner = candidates.find((c) => c.winner);
  const calledAt = ru.candidates.find((c) => c.winner === "X")?.winnerDateTime ?? null;
  const nonpartisan = /nonpartisan/i.test(r.raceType ?? "") || r.officeID === "I";
  return {
    id: r.raceID, state: ru.statePostal, stateName: ru.stateName, office: r.officeID,
    kind: OFFICE[r.officeID].kind, officeName: r.officeName ?? OFFICE[r.officeID].title, nonpartisan,
    title: raceTitle(ru.statePostal, ru.stateName, r.officeID, r.seatName, r),
    description: r.officeID === "I" ? (r.description ?? "") : undefined, summary: r.officeID === "I" ? (r.summary ?? "") : undefined, category: r.officeID === "I" ? (r.category ?? "") : undefined,
    seat: r.seatName ?? "", label: raceLabel(ru.statePostal, r.officeID, r.seatNum, r.seatName, r),
    callStatus: r.raceCallStatus ?? "", called: !!winner || r.raceCallStatus === "Called", calledAt,
    precinctsPct: ru.precinctsReportingPct ?? 0, eevp: ru.eevp ?? r.eevp ?? 0,
    totalVotes: candidates.reduce((s, c) => s + c.votes, 0),
    lastUpdated: ru.lastUpdated, pollClose: ru.pollClosingTime ?? null,
    rankedChoice: !!r.rankedChoice, flipped: !!r.flippedSeat, currentParty: r.currentParty ?? null,
    candidates,
  };
}

/** County units for one AP race (level=ru response). */
export function normalizeCounties(r) {
  return r.reportingUnits
    .filter((u) => u.reportingunitLevel === 2)
    .map((u) => ({
      fips: u.fipsCode ?? null, name: (u.reportingunitName ?? "").replace(/ County$/, ""),
      precinctsPct: u.precinctsReportingPct ?? 0, eevp: u.eevp ?? 0, lastUpdated: u.lastUpdated ?? null,
      votes: Object.fromEntries(u.candidates.filter((c) => !PLACEHOLDER.has(c.last)).map((c) => [c.candidateID, c.voteCount ?? 0])),
    }));
}

/** AP Trend report (balance of power) for an office: s = Senate, h = House, g = Governor. */
export async function fetchTrend(officeCode) {
  const { electionDate, resultsType } = cfg();
  const id = `Trend-${officeCode}-${electionDate.replace(/-/g, "")}-US-${resultsType === "t" ? "Test" : "Live"}`;
  return fetchAp(`/reports/${id}`, {});
}

/** Trend report → { office, timestamp, parties: { Dem: {won, leading, holdovers, winningTrend, current, net}, GOP, caucusDem, caucusGop, other } }. */
export function normalizeTrend(d) {
  const t = d.trendtable ?? {};
  const key = { "Dem": "Dem", "GOP": "GOP", "Others caucus with Dem": "caucusDem", "Others caucus with GOP": "caucusGop", "Others": "other" };
  const num = (arr, name) => Number((arr ?? []).find((x) => x.name === name)?.value ?? 0);
  const parties = {};
  for (const p of t.party ?? []) {
    const k = key[p.title] ?? p.title;
    parties[k] = { won: num(p.trend, "Won"), leading: num(p.trend, "Leading"), holdovers: num(p.trend, "Holdovers"), winningTrend: num(p.trend, "Winning Trend"), current: num(p.trend, "Current"), insufficient: num(p.trend, "InsufficientVote"), net: num(p.NetChange?.trend, "Winners"), netLeaders: num(p.NetChange?.trend, "Leaders") };
  }
  return { office: t.office ?? null, code: t.OfficeTypeCode ?? null, timestamp: t.timestamp ?? null, parties };
}
