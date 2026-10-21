// Internal model and AP -> model normalization. Everything downstream (events, ticker, graphics)
// reads this shape, so an AP version change is contained to ap.ts and this file.

import type { ApRace, ApCandidate } from "./ap.ts";
import featuredList from "../config/featured.json" with { type: "json" };

export interface Candidate {
  id: string;
  name: string; // "Angus King"
  last: string;
  party: string; // AP party code: Dem, GOP, Ind, Lib, Grn, NPA, Una, Oth ...
  votes: number;
  pct: number; // 0-100, share of votes in this race
  incumbent: boolean;
  winner: boolean;
  featured: boolean; // independent / third-party candidate we follow
}

export interface Race {
  id: string;
  state: string; // postal
  stateName: string;
  office: "S" | "H";
  seat: string; // "Class II" or "District 1"
  label: string; // "ME-SEN", "AK-AL", "NY-12"
  callStatus: string; // AP raceCallStatus, e.g. "Called", "Too Early to Call"
  called: boolean;
  calledAt: string | null;
  precinctsPct: number;
  eevp: number; // expected vote pct reporting
  totalVotes: number;
  lastUpdated: string;
  rankedChoice: boolean;
  uncontested: boolean;
  flipped: boolean;
  currentParty: string | null;
  candidates: Candidate[]; // sorted by votes desc
}

const MAJOR = new Set(["Dem", "GOP"]);
// Placeholder rows AP includes that are not real candidates.
const NOT_A_PERSON = new Set(["Total Write-ins", "Other", "Write-ins", "Blank", "Scattering"]);
const FEATURED_IDS = new Set<string>(featuredList.candidateIDs);

export function isFeatured(c: ApCandidate): boolean {
  if (FEATURED_IDS.has(c.candidateID)) return true;
  if (NOT_A_PERSON.has(c.last)) return false;
  return !MAJOR.has(c.party);
}

function fullName(c: ApCandidate): string {
  return [c.first, c.last, c.suffix].filter(Boolean).join(" ");
}

export function raceLabel(state: string, office: "S" | "H", seatNum?: string, seatName?: string): string {
  if (office === "S") return `${state}-SEN`;
  if (seatName?.toLowerCase().includes("at large")) return `${state}-AL`;
  return `${state}-${seatNum ?? "?"}`;
}

/** Normalize one AP race using its state-level reporting unit. Returns null for national aggregate rows. */
export function normalizeRace(r: ApRace): Race | null {
  const ru = r.reportingUnits.find((u) => u.reportingunitLevel === 1) ?? r.reportingUnits[0];
  if (!ru || ru.reportingunitLevel === 0) return null;
  if (r.officeID !== "S" && r.officeID !== "H") return null;

  const total = ru.candidates.reduce((s, c) => s + (c.voteCount ?? 0), 0);
  const candidates: Candidate[] = ru.candidates
    .map((c) => ({
      id: c.candidateID,
      name: fullName(c),
      last: c.last,
      party: c.party,
      votes: c.voteCount ?? 0,
      pct: total ? Math.round(((c.voteCount ?? 0) / total) * 1000) / 10 : 0,
      incumbent: !!c.incumbent,
      winner: c.winner === "X",
      featured: isFeatured(c),
    }))
    .sort((a, b) => b.votes - a.votes);

  const winner = ru.candidates.find((c) => c.winner === "X");
  return {
    id: r.raceID,
    state: ru.statePostal,
    stateName: ru.stateName,
    office: r.officeID,
    seat: r.seatName ?? "",
    label: raceLabel(ru.statePostal, r.officeID, r.seatNum, r.seatName),
    callStatus: r.raceCallStatus ?? "",
    called: !!winner || r.raceCallStatus === "Called",
    calledAt: winner?.winnerDateTime ?? null,
    precinctsPct: ru.precinctsReportingPct ?? 0,
    eevp: ru.eevp ?? r.eevp ?? 0,
    totalVotes: total,
    lastUpdated: ru.lastUpdated,
    rankedChoice: !!r.rankedChoice,
    uncontested: !!r.uncontested,
    flipped: !!r.flippedSeat,
    currentParty: r.currentParty ?? null,
    candidates,
  };
}
