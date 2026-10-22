// AP Elections API v3 client. The key travels in the x-api-key header, so request URLs
// (including AP's nextrequest URLs) contain no secret and are safe to log and store.

import { config } from "./config.ts";

export interface ApCandidate {
  candidateID: string;
  polID: string;
  first?: string;
  middle?: string;
  last: string;
  suffix?: string;
  party: string;
  incumbent?: boolean;
  voteCount: number;
  winner?: string; // "X" when AP has called the race for this candidate
  winnerDateTime?: string;
  ballotOrder?: number;
  rankedChoiceVoting?: { eliminated: boolean; votes: number }[];
}

export interface ApReportingUnit {
  statePostal: string;
  stateName: string;
  reportingunitID?: string;
  reportingunitName?: string;
  fipsCode?: string;
  reportingunitLevel: number; // 0 national, 1 state, 2 county
  level: string;
  lastUpdated: string;
  precinctsReporting: number;
  precinctsTotal: number;
  precinctsReportingPct: number;
  eevp?: number; // expected vote percentage
  pollClosingTime?: string;
  candidates: ApCandidate[];
}

export interface ApRace {
  raceID: string;
  stateID: string;
  officeID: string; // "S" | "H" for this project
  officeName: string;
  seatName?: string;
  seatNum?: string;
  raceCallStatus?: string;
  tabulationStatus?: string;
  currentParty?: string;
  flippedSeat?: boolean;
  keyRace?: boolean;
  national?: boolean;
  rankedChoice?: boolean;
  uncontested?: boolean;
  eevp?: number;
  test?: boolean;
  reportingUnits: ApReportingUnit[];
}

export interface ApResponse {
  apiVersion: string;
  electionDate: string;
  timestamp: string;
  races: ApRace[];
  nextrequest?: string;
}

export function initialUrl(): string {
  const u = new URL(`https://api.ap.org/v3/elections/${config.electionDate}`);
  u.searchParams.set("officeID", "S,H");
  u.searchParams.set("level", "state");
  u.searchParams.set("resultsType", config.resultsType);
  u.searchParams.set("format", "json");
  return u.toString();
}

export class ApHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`AP responded ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Fetch one page of results. Returns the parsed body and the raw text (kept for replay). */
export async function fetchAp(url: string): Promise<{ data: ApResponse; raw: string }> {
  const res = await fetch(url, {
    headers: { "x-api-key": config.apKey, "Accept-Encoding": "gzip", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new ApHttpError(res.status, raw.slice(0, 300));
  return { data: JSON.parse(raw) as ApResponse, raw };
}
