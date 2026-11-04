// Past general-election results for the slate's races, from data/ap-history.sqlite, committed as config/race-history.json
// (copied to /g by the build) for B17's comparison year. Run it again if the slate or the history changes:
//   node scripts/build-race-history.mjs
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const RACES = [
  { id: "28594", label: "NE-SEN", state: "NE", office: "S" },
  { id: "27607", label: "MT-SEN", state: "MT", office: "S" },
  { id: "13252", label: "ID-SEN", state: "ID", office: "S" },
  { id: "42003", label: "SD-SEN", state: "SD", office: "S" },
  { id: "5696", label: "CA-6", state: "CA", office: "H", seat: "District 6" },
  { id: "2015", label: "AK-AL", state: "AK", office: "H", seat: "District 1" },
];
const PLACEHOLDER = /^(total )?write-?ins$|^other$|^blank$|^scattering$/i;

const db = new DatabaseSync(new URL("../data/ap-history.sqlite", import.meta.url).pathname, { readOnly: true });
const rows = db.prepare(`SELECT substr(election_date, 1, 4) AS year, race_id, candidate_id, first, last, party, incumbent, vote_count
  FROM v_race_results WHERE office_id = ? AND state_postal = ? AND race_type = 'General' AND substr(election_date, 6, 2) = '11'
  AND (? IS NULL OR seat_name = ?) ORDER BY election_date, vote_count DESC`);
const out = { source: "AP Elections API final results, general elections 2012 through 2024, from data/ap-history.sqlite", races: {} };
for (const r of RACES) {
  const years = {};
  for (const c of rows.all(r.office, r.state, r.seat ?? null, r.seat ?? null)) {
    if (PLACEHOLDER.test(c.last)) continue;
    (years[c.year] ??= { total: 0, candidates: [] }).candidates.push({ id: String(c.candidate_id), name: [c.first, c.last].filter(Boolean).join(" "), last: c.last, party: c.party, votes: c.vote_count ?? 0, incumbent: !!c.incumbent });
    years[c.year].total += c.vote_count ?? 0;
  }
  out.races[r.id] = { label: r.label, years };
  console.log(r.label, Object.keys(years).join(" "));
}
writeFileSync(new URL("../config/race-history.json", import.meta.url), JSON.stringify(out));
