// Diff two snapshots of a race and emit audience-facing events. The ticker and the
// control panel's event log are built from these.

import type { Race, Candidate } from "./model.ts";

export type EventType =
  | "CALL" // AP called the race
  | "LEAD_CHANGE" // leader changed with meaningful votes in
  | "FIRST_RESULTS" // first votes reported
  | "THRESHOLD" // precincts reporting crossed 10/50/90%
  | "FEATURED_MOVE" // a featured candidate crossed a share threshold or took the lead
  | "MANUAL"; // typed by a producer

export interface ElectionEvent {
  id?: number;
  ts: string;
  type: EventType;
  raceId: string | null;
  priority: number; // 1 = interrupt the ticker, 2 = splice in, 3 = log only
  text: string;
}

const PRECINCT_STEPS = [10, 50, 90];
const FEATURED_STEPS = [10, 20, 30, 40, 50];
const MIN_VOTES_FOR_LEAD = 1000;

function partyTag(c: Candidate): string {
  return c.party === "Dem" ? "D" : c.party === "GOP" ? "R" : c.party === "Ind" ? "I" : c.party;
}

export function candidateShort(c: Candidate): string {
  return `${c.last} (${partyTag(c)})`;
}

function crossed(steps: number[], before: number, after: number): number | null {
  for (const s of steps) if (before < s && after >= s) return s;
  return null;
}

export function diffRace(prev: Race | null, next: Race): ElectionEvent[] {
  const out: ElectionEvent[] = [];
  const ts = new Date().toISOString();
  const leader = next.candidates[0];
  const runnerUp = next.candidates[1];
  const prevLeader = prev?.candidates[0];

  if (next.called && !(prev?.called)) {
    const w = next.candidates.find((c) => c.winner) ?? leader;
    out.push({
      ts, type: "CALL", raceId: next.id, priority: 1,
      text: `AP CALL · ${next.label} · ${candidateShort(w)} wins${next.flipped ? " · FLIP" : ""}`,
    });
  }

  if ((prev?.totalVotes ?? 0) === 0 && next.totalVotes > 0) {
    out.push({ ts, type: "FIRST_RESULTS", raceId: next.id, priority: 3, text: `First results in · ${next.label}` });
  }

  if (
    prev && prevLeader && leader && prevLeader.id !== leader.id &&
    next.totalVotes >= MIN_VOTES_FOR_LEAD && !next.called
  ) {
    out.push({
      ts, type: "LEAD_CHANGE", raceId: next.id, priority: leader.featured ? 1 : 2,
      text: `LEAD CHANGE · ${next.label} · ${candidateShort(leader)} ${leader.pct}% now leads ${candidateShort(runnerUp)} ${runnerUp?.pct ?? 0}%`,
    });
  }

  const step = crossed(PRECINCT_STEPS, prev?.precinctsPct ?? 0, next.precinctsPct);
  if (step !== null && !next.called && leader) {
    out.push({
      ts, type: "THRESHOLD", raceId: next.id, priority: 3,
      text: `${next.label} · ${step}% in · ${candidateShort(leader)} ${leader.pct}%`,
    });
  }

  for (const c of next.candidates.filter((c) => c.featured)) {
    const before = prev?.candidates.find((p) => p.id === c.id)?.pct ?? 0;
    const s = crossed(FEATURED_STEPS, before, c.pct);
    if (s !== null && next.totalVotes >= MIN_VOTES_FOR_LEAD) {
      out.push({
        ts, type: "FEATURED_MOVE", raceId: next.id, priority: s >= 30 ? 2 : 3,
        text: `${next.label} · ${candidateShort(c)} passes ${s}% (${next.precinctsPct}% in)`,
      });
    }
  }

  return out;
}
