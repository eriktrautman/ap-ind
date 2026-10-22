// AP Elections API v3 client for the watch-party poller. Mirrors the broadcast server's
// ap.ts/model.ts in plain JS so the serverless bundle has no TypeScript or JSON-import needs.

const BASE = "https://api.ap.org/v3";

export function cfg() {
  const key = process.env.AP_API_KEY;
  if (!key) throw new Error("AP_API_KEY is not set");
  return {
    key,
    electionDate: process.env.AP_ELECTION_DATE ?? "2026-11-03",
    resultsType: process.env.AP_RESULTS_TYPE ?? "t",
  };
}

export async function fetchAp(path, params) {
  const { key } = cfg();
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("format", "json");
  const res = await fetch(u, { headers: { "x-api-key": key, "Accept-Encoding": "gzip", Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`AP ${res.status} for ${path}`);
  return res.json();
}

export async function fetchRaces(level, extra = {}) {
  const { electionDate, resultsType } = cfg();
  return fetchAp(`/elections/${electionDate}`, { officeID: "S,H", level, resultsType, ...extra });
}

const MAJOR = new Set(["Dem", "GOP"]);
const PLACEHOLDER = new Set(["Total Write-ins", "Other", "Write-ins", "Blank", "Scattering"]);
const AT_LARGE = new Set(["AK", "DE", "ND", "SD", "VT", "WY"]);

export function raceLabel(state, office, seatNum, seatName) {
  if (office === "S") return `${state}-SEN`;
  if (AT_LARGE.has(state) || /at large/i.test(seatName ?? "")) return `${state}-AL`;
  return `${state}-${seatNum ?? "?"}`;
}

export function isIndependent(c) {
  return !MAJOR.has(c.party) && !PLACEHOLDER.has(c.last);
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
  if (!ru || ru.reportingunitLevel === 0 || (r.officeID !== "S" && r.officeID !== "H")) return null;
  const candidates = unitCandidates(ru);
  const winner = candidates.find((c) => c.winner);
  return {
    id: r.raceID, state: ru.statePostal, stateName: ru.stateName, office: r.officeID,
    seat: r.seatName ?? "", label: raceLabel(ru.statePostal, r.officeID, r.seatNum, r.seatName),
    callStatus: r.raceCallStatus ?? "", called: !!winner || r.raceCallStatus === "Called",
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
