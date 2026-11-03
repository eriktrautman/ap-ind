// Makes the campaign-supplied headshots the preferred photo for each candidate in config/photos-campaign.json.
//   node --env-file=.env scripts/import-campaign-photos.mjs <dir of prepared <candidateID>.jpg files>   uploads, then applies
//   node scripts/import-campaign-photos.mjs                                                             applies only (after build-photo-index.py)
// Files go to photos/<prefix>/campaign-<id>.jpg, a new name, so the photo a candidate had before stays in the store. The poller reads
// config/photos.json through jsDelivr, so the feed picks this up after a purge of that URL and the next poll.
import { put } from "@vercel/blob";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(ROOT, "config", "photos.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const { photos } = JSON.parse(readFileSync(join(ROOT, "config", "photos-campaign.json"), "utf8"));
const dir = process.argv[2];
const url = (id) => `${manifest.cdnBase}campaign-${id}.jpg`;
if (dir) {
  const ids = Object.keys(photos); let n = 0;
  const worker = async () => { for (let id; (id = ids.shift()); ) { await put(`photos/${manifest.cdnPrefix}/campaign-${id}.jpg`, readFileSync(join(dir, `${id}.jpg`)), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg", cacheControlMaxAge: 60 * 60 * 24 * 30 }); n++; } };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`uploaded ${n}`);
}
for (const [id, p] of Object.entries(photos)) {
  manifest.photos[id] = { ...(manifest.photos[id] ?? {}), name: p.name, race: p.race, party: p.party, featured: manifest.photos[id]?.featured ?? false, source: "campaign", confidence: "verified", url: null, page: null, license: "Campaign-supplied", credit: "Campaign", note: null, file: null, size: undefined, remote: url(id), cdn: url(id) };
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + (readFileSync(MANIFEST, "utf8").endsWith("\n") ? "\n" : ""));
console.log(`applied ${Object.keys(photos).length} of ${Object.keys(manifest.photos).length} photos`);
