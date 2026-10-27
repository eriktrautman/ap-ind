// Fetch the 2024 presidential result by reporting unit (county, or Alaska house district) for
// the featured states from AP, and store it as config/baseline-2024-pres.json. One-time data.
//   node --env-file=.env scripts/fetch-baseline-2024.mjs
import { writeFileSync } from "node:fs";

const STATES = (process.argv[2] ?? "NE,MT,ID,SD,CA,AK").split(",");
const key = process.env.AP_API_KEY;
if (!key) throw new Error("AP_API_KEY not set");

const out = { source: "AP Elections API, 2024-11-05 general, officeID=P, level=ru", fetched: new Date().toISOString(), states: {} };
for (const st of STATES) {
  const u = new URL("https://api.ap.org/v3/elections/2024-11-05");
  for (const [k, v] of Object.entries({ officeID: "P", statePostal: st, level: "ru", resultsType: "l", format: "json" })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { "x-api-key": key, "Accept-Encoding": "gzip" } });
  if (!res.ok) throw new Error(`AP ${res.status} for ${st}`);
  const d = await res.json();
  const race = d.races.find((r) => r.officeID === "P");
  const units = {};
  for (const ru of race.reportingUnits) {
    if (ru.reportingunitLevel !== 2) continue;
    const total = ru.candidates.reduce((s, c) => s + (c.voteCount ?? 0), 0);
    const dem = ru.candidates.filter((c) => c.party === "Dem").reduce((s, c) => s + c.voteCount, 0);
    const gop = ru.candidates.filter((c) => c.party === "GOP").reduce((s, c) => s + c.voteCount, 0);
    units[ru.fipsCode ?? ru.reportingunitName] = { name: ru.reportingunitName.replace(/ County$/, ""), total, dem, gop, demPct: total ? +(dem / total * 100).toFixed(1) : 0, gopPct: total ? +(gop / total * 100).toFixed(1) : 0 };
  }
  const stateUnit = race.reportingUnits.find((r) => r.reportingunitLevel === 1);
  const stTotal = stateUnit.candidates.reduce((s, c) => s + c.voteCount, 0);
  out.states[st] = {
    units,
    statewide: { demPct: +(stateUnit.candidates.filter((c) => c.party === "Dem").reduce((s, c) => s + c.voteCount, 0) / stTotal * 100).toFixed(1), gopPct: +(stateUnit.candidates.filter((c) => c.party === "GOP").reduce((s, c) => s + c.voteCount, 0) / stTotal * 100).toFixed(1) },
    tickets: { dem: stateUnit.candidates.find((c) => c.party === "Dem")?.last, gop: stateUnit.candidates.find((c) => c.party === "GOP")?.last },
  };
  console.log(`${st}: ${Object.keys(units).length} units, statewide Dem ${out.states[st].statewide.demPct} / GOP ${out.states[st].statewide.gopPct}, sample key ${Object.keys(units)[0]} ${JSON.stringify(Object.values(units)[0]).slice(0, 80)}`);
}
writeFileSync(new URL("../config/baseline-2024-pres.json", import.meta.url), JSON.stringify(out));
