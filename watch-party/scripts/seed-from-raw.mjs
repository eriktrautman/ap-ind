// Seed Blob from a raw AP response stored by the broadcast server (data/ap-ind.sqlite),
// so the site has data to show when AP is unreachable. Usage:
//   node --env-file=.env.blob scripts/seed-from-raw.mjs [raw_response_id]
// Prints the Blob base URL for vercel.json's /data rewrite.
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { put } from "@vercel/blob";
import { normalizeRace } from "../lib/ap.js";

const db = new DatabaseSync(new URL("../../data/ap-ind.sqlite", import.meta.url).pathname);
const id = Number(process.argv[2] ?? 1);
const row = db.prepare("SELECT fetched_at, body_gz FROM raw_responses WHERE id = ? AND status = 200").get(id);
if (!row) throw new Error(`no stored response with id ${id}`);
const data = JSON.parse(gunzipSync(row.body_gz).toString("utf8"));
const races = data.races.map(normalizeRace).filter(Boolean);
for (const r of races) r.hasIndependent = r.candidates.some((c) => c.independent);
let curated = new Map();
try {
  const d = await (await fetch("https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/config/candidates.json")).json();
  curated = new Map(d.candidates.map((c) => [c.id, c]));
} catch {}
for (const r of races) {
  r.featured = [...curated.values()].some((c) => c.raceId === r.id && c.featured);
  for (const c of r.candidates) {
    const k = curated.get(c.id);
    c.photo = k?.photo?.file ? "https://cdn.jsdelivr.net/gh/eriktrautman/ap-ind@main/public/photos/" + k.photo.file : k?.photo?.remote ?? null;
  }
}
const generated = new Date().toISOString();
const opts = { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60, allowOverwrite: true };
const idx = await put("index.json", JSON.stringify({ generated, resultsType: "t", apTimestamp: data.timestamp, seededFrom: `raw response ${id} fetched ${row.fetched_at}`, races }), opts);
await put("status.json", JSON.stringify({ generated, resultsType: "t", ok: true, errors: [], lastApSuccess: row.fetched_at, apTimestamp: data.timestamp, raceCount: races.length, called: races.filter((r) => r.called).length, note: "seeded from a stored AP response; live polling paused" }), opts);
console.log(`seeded ${races.length} races from response ${id} (${row.fetched_at}); AP timestamp ${data.timestamp}`);
console.log("BLOB_BASE=" + idx.url.replace(/\/index\.json$/, ""));
