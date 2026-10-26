// Fetch the last result for each featured seat and the 2024 national Senate/House totals from
// AP, once, and commit them as config/baseline-federal.json (copied to public/g for the pages).
//   node --env-file=studio/.env scripts/fetch-baseline-federal.mjs
// Senate seats were last contested in 2020 (class 2), House seats in 2024; Nebraska uses the 2024
// race for the state's other seat because the same independent ran in it. AP allows ten
// requests a minute; the script waits seven seconds between calls.
import { writeFileSync, readFileSync } from "node:fs";

const key = process.env.AP_API_KEY;
if (!key) throw new Error("AP_API_KEY not set");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLACEHOLDER = new Set(["Total Write-ins", "Other", "Write-ins", "Blank", "Scattering"]);
const NOT_IND = new Set(["Dem", "GOP", "NP", "Yes", "No"]);

// Current featured races → the prior contest for the same seat.
const SEATS = [
  // NE: Osborn ran for the state's other Senate seat in 2024, so that is the comparison that matters.
  { id: "28594", label: "NE-SEN", state: "NE", office: "S", date: "2024-11-05", seatNum: null, note: "other Senate seat (Fischer v Osborn)" },
  { id: "27607", label: "MT-SEN", state: "MT", office: "S", date: "2020-11-03", seatNum: null },
  { id: "13252", label: "ID-SEN", state: "ID", office: "S", date: "2020-11-03", seatNum: null },
  { id: "42003", label: "SD-SEN", state: "SD", office: "S", date: "2020-11-03", seatNum: null },
  { id: "5696",  label: "CA-6",   state: "CA", office: "H", date: "2024-11-05", seatNum: "6" },
  { id: "2015",  label: "AK-AL",  state: "AK", office: "H", date: "2024-11-05", seatNum: "1" },
  { id: "13253", label: "ID-1",   state: "ID", office: "H", date: "2024-11-05", seatNum: "1" },
];

async function ap(date, params) {
  const u = new URL(`https://api.ap.org/v3/elections/${date}`);
  for (const [k, v] of Object.entries({ ...params, resultsType: "l", format: "json" })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "x-api-key": key, "Accept-Encoding": "gzip" } });
  if (!res.ok) throw new Error(`AP ${res.status} for ${u.search}`);
  return res.json();
}
const cand = (c) => ({ id: c.candidateID, name: [c.first, c.last, c.suffix].filter(Boolean).join(" "), last: c.last, party: c.party, votes: c.voteCount ?? 0, independent: !NOT_IND.has(c.party) && !PLACEHOLDER.has(c.last), winner: c.winner === "X", incumbent: !!c.incumbent });

let out = { source: "AP Elections API, prior contest for each featured seat (Senate 2020, House 2024) and 2024 national Senate/House totals", fetched: new Date().toISOString(), national: {}, races: {} };
try { out = { ...JSON.parse(readFileSync(new URL("../config/baseline-federal.json", import.meta.url), "utf8")), fetched: out.fetched }; } catch {}

// 1. National 2024 totals by party for Senate and House (state-level units, one request).
{
  const d = await ap("2024-11-05", { officeID: "S,H", level: "state" });
  const nat = { S: { dem: 0, gop: 0, other: 0, total: 0, races: 0 }, H: { dem: 0, gop: 0, other: 0, total: 0, races: 0 } };
  for (const r of d.races) {
    const ru = r.reportingUnits.find((u) => u.reportingunitLevel === 1); if (!ru || !nat[r.officeID]) continue;
    const n = nat[r.officeID]; n.races++;
    for (const c of ru.candidates) {
      if (PLACEHOLDER.has(c.last)) continue;
      const v = c.voteCount ?? 0; n.total += v;
      if (c.party === "Dem") n.dem += v; else if (c.party === "GOP") n.gop += v; else n.other += v;
    }
  }
  for (const k of ["S", "H"]) { const n = nat[k]; n.demPct = +(n.dem / n.total * 100).toFixed(2); n.gopPct = +(n.gop / n.total * 100).toFixed(2); n.otherPct = +(n.other / n.total * 100).toFixed(2); }
  out.national["2024"] = nat;
  console.log("national 2024:", JSON.stringify(nat));
}

// 2. Prior contest for each featured seat, with county units.
for (const seat of SEATS) {
  await sleep(7000);
  const d = await ap(seat.date, { officeID: seat.office, statePostal: seat.state, level: "ru" });
  const races = d.races.filter((r) => r.officeID === seat.office && (seat.office === "S" || String(r.seatNum) === seat.seatNum));
  // A state can have two Senate races in a year (special election); take the regular one.
  const race = races.find((r) => !/special/i.test(r.raceType ?? "")) ?? races[0];
  if (!race) { console.log(`${seat.label}: no prior race found`); continue; }
  const st = race.reportingUnits.find((u) => u.reportingunitLevel === 1);
  const candidates = st.candidates.filter((c) => !PLACEHOLDER.has(c.last)).map(cand).sort((a, b) => b.votes - a.votes);
  const total = candidates.reduce((s, c) => s + c.votes, 0);
  for (const c of candidates) c.pct = +(c.votes / total * 100).toFixed(1);
  const units = {};
  for (const u of race.reportingUnits.filter((u) => u.reportingunitLevel === 2)) {
    const votes = Object.fromEntries(u.candidates.filter((c) => !PLACEHOLDER.has(c.last)).map((c) => [c.candidateID, c.voteCount ?? 0]));
    units[u.fipsCode ?? u.reportingunitName] = { name: (u.reportingunitName ?? "").replace(/ County$/, ""), total: Object.values(votes).reduce((s, v) => s + v, 0), votes };
  }
  out.races[seat.id] = { label: seat.label, state: seat.state, office: seat.office, date: seat.date, note: seat.note ?? null, raceId: race.raceID, raceType: race.raceType, seatName: race.seatName, candidates, total, units };
  console.log(`${seat.label}: ${seat.date} ${race.raceType} · ${candidates.slice(0, 3).map((c) => `${c.last} (${c.party}) ${c.pct}%`).join(", ")} · ${Object.keys(units).length} units`);
}

const json = JSON.stringify(out);
writeFileSync(new URL("../config/baseline-federal.json", import.meta.url), json);
writeFileSync(new URL("../public/g/baseline-federal.json", import.meta.url), json);
console.log(`wrote config/baseline-federal.json (${(json.length / 1024).toFixed(0)} KB)`);
