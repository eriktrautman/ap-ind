// Replaces the 200 px Ballotpedia thumbnails in config/photos.json with the full-size originals they were made from.
//   node scripts/upgrade-thumb-photos.mjs <work dir>                        downloads and prepares, changes nothing
//   node --env-file=.env scripts/upgrade-thumb-photos.mjs <work dir> --upload   uploads, then updates the manifest
// Uploads go to photos/<prefix>/full-<id>.jpg, a new name, so the photo a candidate had before stays in the store. An original no
// larger than its thumbnail is left alone. The poller reads config/photos.json through jsDelivr, so the feed picks this up after a
// purge of that URL and the next poll. macOS only (sips). Run it again after scripts/build-photo-index.py, which rewrites that file.
import { put } from "@vercel/blob";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "config", "photos.json");
const THUMB = "/files/thumbs/200/300/", MAX = 800;
const dir = process.argv[2], upload = process.argv.includes("--upload");
if (!dir) throw new Error("usage: upgrade-thumb-photos.mjs <work dir> [--upload]");
mkdirSync(join(dir, "raw"), { recursive: true }); mkdirSync(join(dir, "out"), { recursive: true });
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const size = async (f) => { const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f]); return [/pixelWidth: (\d+)/, /pixelHeight: (\d+)/].map((re) => Number(re.exec(stdout)?.[1] ?? 0)); };

async function prepare(id, e) {
  const out = join(dir, "out", `${id}.jpg`);
  if (!existsSync(out)) {
    const res = await fetch(e.url.replace(THUMB, "/files/"), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { why: `http ${res.status}` };
    const raw = join(dir, "raw", id);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    const [w, h] = await size(raw);
    if (!(w > 200 || h > 300)) return { why: `original only ${w}x${h}` };
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", ...(Math.max(w, h) > MAX ? ["-Z", String(MAX)] : []), raw, "--out", out]);
  }
  return { out, size: await size(out) };
}

const jobs = Object.entries(manifest.photos).filter(([, e]) => e.url?.includes(THUMB));
const ready = [], skipped = {};
let n = 0;
const worker = async () => {
  for (let job; (job = jobs.shift()); ) {
    const [id, e] = job;
    try {
      const r = await prepare(id, e);
      if (!r.out) { skipped[r.why] = (skipped[r.why] ?? 0) + 1; continue; }
      if (upload) await put(`photos/${manifest.cdnPrefix}/full-${id}.jpg`, readFileSync(r.out), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", cacheControlMaxAge: 60 * 60 * 24 * 30 });
      ready.push([id, e, r]);
    } catch (err) { skipped[String(err.message).slice(0, 60)] = (skipped[String(err.message).slice(0, 60)] ?? 0) + 1; }
    if (++n % 100 === 0) console.log(`${n}...`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`${ready.length} ready; skipped`, skipped);
const heights = ready.map(([, , r]) => Math.max(...r.size)).sort((a, b) => a - b);
console.log("longest side: min", heights[0], "median", heights[heights.length >> 1], "max", heights.at(-1));
if (upload) {
  for (const [id, e, r] of ready) { e.url = e.url.replace(THUMB, "/files/"); e.size = r.size; e.cdn = `${manifest.cdnBase}full-${id}.jpg`; }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + (readFileSync(MANIFEST, "utf8").endsWith("\n") ? "\n" : ""));
  console.log(`manifest updated: ${ready.length}`);
}
