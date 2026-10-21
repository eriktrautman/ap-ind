// Builds the ticker queue: producer-pinned races in order, with recent high-priority
// events and manual items spliced in. The ticker page just renders what it is given.

import type { Race } from "./model.ts";
import type { ElectionEvent } from "./events.ts";
import { candidateShort } from "./events.ts";
import type { Store } from "./store.ts";

export interface TickerItem {
  key: string;
  kind: "race" | "event" | "manual";
  text: string;
  emphasis: boolean; // calls and featured-candidate news
}

export interface ProducerState {
  pinnedRaceIds: string[];
  manualItems: { id: string; text: string; createdAt: string }[];
  eventWindowMinutes: number; // how long an auto event stays in rotation
}

export const defaultProducerState: ProducerState = { pinnedRaceIds: [], manualItems: [], eventWindowMinutes: 10 };

export function raceTickerText(r: Race): string {
  const top = r.candidates.slice(0, 3);
  if (r.totalVotes === 0) return `${r.label} · polls ${r.precinctsPct > 0 ? "closed" : "open"} · no results yet`;
  const cands = top.map((c) => `${candidateShort(c)} ${c.pct}%`).join(" · ");
  const status = r.called ? `AP CALL: ${candidateShort(r.candidates.find((c) => c.winner) ?? r.candidates[0])}` : `${Math.round(r.eevp || r.precinctsPct)}% in`;
  return `${r.label} · ${cands} · ${status}`;
}

/** Default pins when a producer has chosen nothing: Senate races where a featured candidate has a real share. */
export function defaultPins(races: Race[]): string[] {
  return races
    .filter((r) => r.office === "S" && r.candidates.some((c) => c.featured && c.pct >= 5))
    .sort((a, b) => a.state.localeCompare(b.state))
    .map((r) => r.id);
}

export function buildTicker(store: Store): TickerItem[] {
  const state = store.getJson<ProducerState>("producer", defaultProducerState);
  const races = store.allRaces();
  const byId = new Map(races.map((r) => [r.id, r]));
  const pins = state.pinnedRaceIds.length ? state.pinnedRaceIds : defaultPins(races);

  const raceItems: TickerItem[] = pins
    .map((id) => byId.get(id))
    .filter((r): r is Race => !!r)
    .map((r) => ({ key: `race:${r.id}`, kind: "race", text: raceTickerText(r), emphasis: r.called }));

  const cutoff = Date.now() - state.eventWindowMinutes * 60_000;
  const eventItems: TickerItem[] = store
    .recentEvents(100)
    .filter((e: ElectionEvent) => e.priority <= 2 && Date.parse(e.ts) >= cutoff)
    .map((e) => ({ key: `event:${e.id}`, kind: "event", text: e.text, emphasis: e.priority === 1 }));

  const manualItems: TickerItem[] = state.manualItems.map((m) => ({
    key: `manual:${m.id}`, kind: "manual", text: m.text, emphasis: true,
  }));

  // Interleave: one event/manual item after every two race items.
  const extras = [...manualItems, ...eventItems];
  const out: TickerItem[] = [];
  let ei = 0;
  raceItems.forEach((item, i) => {
    out.push(item);
    if (i % 2 === 1 && ei < extras.length) out.push(extras[ei++]);
  });
  while (ei < extras.length) out.push(extras[ei++]);
  if (!out.length) out.push({ key: "hold", kind: "manual", text: "Election night coverage · results as they come in from AP", emphasis: false });
  return out;
}
