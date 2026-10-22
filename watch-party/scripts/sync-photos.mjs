// Download the photo set from the CDN into ../public/photos/ on this machine (for the broadcast
// server, which serves photos locally so air does not depend on the CDN). No credentials needed.
//   node scripts/sync-photos.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "config", "photos.json"), "utf8"));
const jobs = Object.entries(manifest.photos).filter(([, e]) => e.cdn && e.file);
let done = 0, skipped = 0, failed = 0;
async function worker() {
  while (jobs.length) {
    const [, e] = jobs.shift();
    const local = join(ROOT, "public", e.file);
    if (existsSync(local)) { skipped++; continue; }
    try {
      const res = await fetch(e.cdn);
      if (!res.ok) throw new Error(String(res.status));
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, Buffer.from(await res.arrayBuffer()));
      done++;
    } catch (err) { failed++; console.error(`  ${e.file}: ${err.message}`); }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`downloaded ${done}, already present ${skipped}, failed ${failed}`);
