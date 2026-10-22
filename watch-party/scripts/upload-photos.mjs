// Upload candidate photos to the Blob store and record each CDN URL in config/photos.json.
//   node --env-file=.env.blob scripts/upload-photos.mjs [--force]
// Files come from ../public/photos/{congress,bp}/<id>.jpg and ../public/photos/<id>.jpg (curated).
// Paths in the store are photos/<prefix>/<id>.jpg; the prefix is random, generated once and kept
// in the manifest, so the set is not enumerable. Already-uploaded entries are skipped unless --force.
import { put } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "config", "photos.json");
const force = process.argv.includes("--force");
const CONCURRENCY = 8;

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
manifest.cdnPrefix ??= randomBytes(9).toString("base64url");
const jobs = Object.entries(manifest.photos).filter(([, e]) => e.file && (force || !e.cdn));
console.log(`${jobs.length} photos to upload (prefix ${manifest.cdnPrefix})`);

let done = 0, failed = 0;
async function worker() {
  while (jobs.length) {
    const [id, e] = jobs.shift();
    const local = join(ROOT, "public", e.file);
    if (!existsSync(local)) { failed++; continue; }
    try {
      const res = await put(`photos/${manifest.cdnPrefix}/${id}.jpg`, readFileSync(local), {
        access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", cacheControlMaxAge: 60 * 60 * 24 * 30,
      });
      e.cdn = res.url;
      done++;
      if (done % 100 === 0) { writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1)); console.log(`  ${done} uploaded`); }
    } catch (err) {
      failed++; console.error(`  ${id}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
manifest.cdnBase = `${Object.values(manifest.photos).find((e) => e.cdn)?.cdn.split(`/photos/${manifest.cdnPrefix}/`)[0] ?? ""}/photos/${manifest.cdnPrefix}/`;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log(`uploaded ${done}, failed ${failed}; manifest updated`);
