// Sample snapshot for demo mode (?demo=1). Numbers are from AP's test feed on Oct 21 2026
// (a simulated, finished election) and are NOT real results. Shape matches /api/snapshot.
export const SAMPLE = {
  type: "snapshot",
  status: {
    running: true, intervalMs: 20000, lastAttempt: null, lastSuccess: null, lastError: null,
    consecutiveErrors: 0, raceCount: 470, lastChangedCount: 0, apTimestamp: null, resultsType: "t",
  },
  races: [
    {
      id: "28594", state: "NE", stateName: "Nebraska", office: "S", seat: "Class II", label: "NE-SEN",
      callStatus: "Called", called: true, calledAt: "2026-11-04T05:42:13.000Z", precinctsPct: 98.9, eevp: 99,
      totalVotes: 686556, lastUpdated: "2026-11-04T06:31:27.000Z", rankedChoice: false, uncontested: false,
      flipped: false, currentParty: "GOP",
      candidates: [
        { id: "51566", name: "Pete Ricketts", last: "Ricketts", party: "GOP", votes: 329507, pct: 48.0, incumbent: true, winner: true, featured: false },
        { id: "168007", name: "Dan Osborn", last: "Osborn", party: "NP", votes: 315518, pct: 46.0, incumbent: false, winner: false, featured: true },
        { id: "179197", name: "Chuck Conboy", last: "Conboy", party: "AFi", votes: 18775, pct: 2.7, incumbent: false, winner: false, featured: true },
        { id: "129622", name: "Robin Richards", last: "Richards", party: "NWk", votes: 14692, pct: 2.1, incumbent: false, winner: false, featured: true },
        { id: "175130", name: "Mike Marvin", last: "Marvin", party: "LMN", votes: 8064, pct: 1.2, incumbent: false, winner: false, featured: true },
      ],
    },
    {
      id: "27607", state: "MT", stateName: "Montana", office: "S", seat: "Class II", label: "MT-SEN",
      callStatus: "Called", called: true, calledAt: "2026-11-04T06:05:00.000Z", precinctsPct: 97.2, eevp: 98,
      totalVotes: 598400, lastUpdated: "2026-11-04T06:30:00.000Z", rankedChoice: false, uncontested: false,
      flipped: false, currentParty: "GOP",
      candidates: [
        { id: "171710", name: "Kurt Alme", last: "Alme", party: "GOP", votes: 299200, pct: 50.0, incumbent: false, winner: true, featured: false },
        { id: "177955", name: "Seth Bodnar", last: "Bodnar", party: "Ind", votes: 205850, pct: 34.4, incumbent: false, winner: false, featured: true },
        { id: "171696", name: "Alani Bankhead", last: "Bankhead", party: "Dem", votes: 92154, pct: 15.4, incumbent: false, winner: false, featured: false },
        { id: "70324", name: "Kyle Austin", last: "Austin", party: "Lib", votes: 1196, pct: 0.2, incumbent: false, winner: false, featured: true },
      ],
    },
    {
      id: "13252", state: "ID", stateName: "Idaho", office: "S", seat: "Class II", label: "ID-SEN",
      callStatus: "Called", called: true, calledAt: "2026-11-04T05:10:00.000Z", precinctsPct: 99.1, eevp: 99,
      totalVotes: 612000, lastUpdated: "2026-11-04T06:20:00.000Z", rankedChoice: false, uncontested: false,
      flipped: false, currentParty: "GOP",
      candidates: [
        { id: "15344", name: "Jim Risch", last: "Risch", party: "GOP", votes: 379440, pct: 62.0, incumbent: true, winner: true, featured: false },
        { id: "162421", name: "Todd Achilles", last: "Achilles", party: "Ind", votes: 195840, pct: 32.0, incumbent: false, winner: false, featured: true },
        { id: "67326", name: "Natalie Fleming", last: "Fleming", party: "Ind", votes: 24480, pct: 4.0, incumbent: false, winner: false, featured: true },
        { id: "167082", name: "Matt Loesby", last: "Loesby", party: "Lib", votes: 12240, pct: 2.0, incumbent: false, winner: false, featured: true },
      ],
    },
    {
      id: "42003", state: "SD", stateName: "South Dakota", office: "S", seat: "Class II", label: "SD-SEN",
      callStatus: "Called", called: true, calledAt: "2026-11-04T04:55:00.000Z", precinctsPct: 100, eevp: 99,
      totalVotes: 352000, lastUpdated: "2026-11-04T06:00:00.000Z", rankedChoice: false, uncontested: false,
      flipped: false, currentParty: "GOP",
      candidates: [
        { id: "580", name: "Mike Rounds", last: "Rounds", party: "GOP", votes: 204160, pct: 58.0, incumbent: true, winner: true, featured: false },
        { id: "70405", name: "Brian Bengs", last: "Bengs", party: "Ind", votes: 147840, pct: 42.0, incumbent: false, winner: false, featured: true },
      ],
    },
    {
      id: "20643", state: "ME", stateName: "Maine", office: "S", seat: "Class II", label: "ME-SEN",
      callStatus: "Called", called: true, calledAt: "2026-11-04T03:40:00.000Z", precinctsPct: 96.5, eevp: 97,
      totalVotes: 701200, lastUpdated: "2026-11-04T06:10:00.000Z", rankedChoice: true, uncontested: false,
      flipped: true, currentParty: "GOP",
      candidates: [
        { id: "900001", name: "Troy Jackson", last: "Jackson", party: "Dem", votes: 329564, pct: 47.0, incumbent: false, winner: true, featured: false },
        { id: "900002", name: "Susan Collins", last: "Collins", party: "GOP", votes: 245420, pct: 35.0, incumbent: true, winner: false, featured: false },
        { id: "900003", name: "Oswald (write-in)", last: "Oswald (write-in)", party: "Ind", votes: 42072, pct: 6.0, incumbent: false, winner: false, featured: true },
      ],
    },
  ],
  events: [],
  ticker: [
    { key: "race:13252", kind: "race", text: "ID-SEN · Risch (R) 62% · Achilles (I) 32% · Fleming (I) 4% · AP CALL: Risch (R)", emphasis: false },
    { key: "race:20643", kind: "race", text: "ME-SEN · Jackson (D) 47% · Collins (R) 35% · Oswald (I) 6% · AP CALL: Jackson (D)", emphasis: false },
    { key: "event:1", kind: "event", text: "AP CALL · ME-SEN · Jackson (D) wins · FLIP", emphasis: true },
    { key: "race:27607", kind: "race", text: "MT-SEN · Alme (R) 50% · Bodnar (I) 34.4% · Bankhead (D) 15.4% · AP CALL: Alme (R)", emphasis: false },
    { key: "race:28594", kind: "race", text: "NE-SEN · Ricketts (R) 48% · Osborn (I) 46% · Conboy (AFi) 2.7% · 94% in", emphasis: false },
    { key: "event:2", kind: "event", text: "LEAD CHANGE · NE-SEN · Ricketts (R) 48.0% now leads Osborn (I) 46.0%", emphasis: true },
    { key: "race:42003", kind: "race", text: "SD-SEN · Rounds (R) 58% · Bengs (I) 42% · AP CALL: Rounds (R)", emphasis: false },
    { key: "manual:1", kind: "manual", text: "Coming up: Dan Osborn joins us live from Omaha", emphasis: true },
    { key: "event:3", kind: "event", text: "AP CALL · ID-1 · Zabel (I) defeats Fulcher (R) · FLIP", emphasis: true },
  ],
  producer: { pinnedRaceIds: [], manualItems: [], eventWindowMinutes: 10 },
};
