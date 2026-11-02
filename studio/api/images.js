// The image library: static images that go into playlists and onto live screens like any chart. GET is public and uncached.
// POST adds one (publisher or producer): the browser has already decoded and re-encoded the file, which caps its size and strips its
// metadata, and sends it here as base64 with a small thumbnail. PATCH changes the name or credit, or (a producer) marks it deprecated. DELETE needs a producer, refuses
// an image a live screen is showing, and asks first when playlists use it.
// Files are written once under a random name and never overwritten, so nothing on air can change underneath a playlist.
import { randomBytes } from "node:crypto";
import { requirePublisher, requireProducer, readBody } from "../lib/auth.js";
import { readFresh, writeFresh, writeBinary, deleteFile, readProducer } from "../lib/store.js";
import { normalizeLibrary, normalizePlaylists, defaultPlaylists, seedPlaylists, IMAGE_CHART, IMAGE_LIMITS, imageNameOk } from "../lib/control.js";

const LIB = "images.json";
export const currentLibrary = async () => normalizeLibrary((await readFresh(LIB)).state);
const currentPlaylists = async () => { const { state } = await readFresh("playlists.json"); return state ? seedPlaylists(normalizePlaylists(state)) : defaultPlaylists(); };

/** What the bytes actually are, whatever the browser called them: jpg, png or webp, else null. SVG and anything else stop here. */
export function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}
const decode = (s) => (typeof s === "string" ? Buffer.from(s, "base64") : Buffer.alloc(0));
const text = (s, max) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const usedIn = (doc, file) => doc.users.flatMap((u) => u.playlists.filter((p) => p.items.some((it) => it.chart === IMAGE_CHART && it.params?.image === file)).map((p) => `${u.name || u.id}: ${p.name || p.id}`));

async function save(lib, who) {
  const doc = { ...lib, updatedAt: new Date().toISOString(), updatedBy: who.name };
  await writeFresh(LIB, doc);
  return doc;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") { res.status(200).json(await currentLibrary()); return; }
    if (req.method === "POST") {
      const who = await requirePublisher(req, res); if (!who) return;
      const b = readBody(req);
      const name = text(b.name, IMAGE_LIMITS.name), credit = text(b.credit, IMAGE_LIMITS.credit);
      if (!name) { res.status(400).json({ error: "an image needs a name" }); return; }
      const main = decode(b.file), thumb = decode(b.thumb), kind = sniff(main), tkind = sniff(thumb);
      if (!kind || !tkind) { res.status(400).json({ error: "only JPEG, PNG and WebP images can be uploaded" }); return; }
      if (main.length > IMAGE_LIMITS.bytes || thumb.length > IMAGE_LIMITS.thumbBytes) { res.status(413).json({ error: "that image is too large to upload" }); return; }
      const lib = await currentLibrary();
      if (lib.images.length >= IMAGE_LIMITS.count) { res.status(409).json({ error: `the library is full (${IMAGE_LIMITS.count} images): delete one first` }); return; }
      const id = randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
      const entry = { file: `${id}.${kind.ext}`, thumb: `${id}-t.${tkind.ext}`, name, credit, w: Number(b.w) || 0, h: Number(b.h) || 0, bytes: main.length, alpha: b.alpha === true, uploadedBy: who.name, uploadedAt: new Date().toISOString() };
      await writeBinary(`images/${entry.file}`, main, kind.type);
      await writeBinary(`images/${entry.thumb}`, thumb, tkind.type);
      const doc = await save(normalizeLibrary({ ...lib, images: [entry, ...lib.images] }), who);
      res.status(200).json({ image: doc.images[0], library: doc });
      return;
    }
    if (req.method === "PATCH") {
      const b = readBody(req);
      const who = await (typeof b.deprecated === "boolean" ? requireProducer : requirePublisher)(req, res); if (!who) return;
      const lib = await currentLibrary(); const im = lib.images.find((x) => x.file === b.file);
      if (!im) { res.status(404).json({ error: "that image is not in the library" }); return; }
      if (typeof b.deprecated === "boolean") { im.deprecated = b.deprecated; res.status(200).json({ library: await save(lib, who) }); return; }
      const name = text(b.name, IMAGE_LIMITS.name), credit = text(b.credit, IMAGE_LIMITS.credit);
      if (!name) { res.status(400).json({ error: "an image needs a name" }); return; }
      Object.assign(im, { name, credit });
      res.status(200).json({ library: await save(lib, who) });
      return;
    }
    if (req.method === "DELETE") {
      const who = await requireProducer(req, res); if (!who) return;
      const b = readBody(req);
      if (!imageNameOk(b.file)) { res.status(400).json({ error: "that is not an image file" }); return; }
      const lib = await currentLibrary(); const im = lib.images.find((x) => x.file === b.file);
      if (!im) { res.status(404).json({ error: "that image is not in the library" }); return; }
      const { state } = await readProducer();
      const onAir = ["screenA", "screenB"].filter((k) => state?.[k]?.chart === IMAGE_CHART && state[k].params?.image === b.file);
      if (onAir.length) { res.status(409).json({ error: `Live Screen ${onAir[0] === "screenA" ? "One" : "Two"} is showing this image. Publish something else there first.`, onAir: true }); return; }
      const plays = await currentPlaylists();
      const used = usedIn(plays, b.file);
      if (used.length && b.force !== true) { res.status(409).json({ error: "playlists use this image", usedIn: used }); return; }
      if (used.length) {
        for (const u of plays.users) for (const p of u.playlists) p.items = p.items.filter((it) => !(it.chart === IMAGE_CHART && it.params?.image === b.file));
        await writeFresh("playlists.json", { ...plays, generalSeeded: true, updatedAt: new Date().toISOString(), updatedBy: who.name });
      }
      const doc = await save({ ...lib, images: lib.images.filter((x) => x.file !== b.file) }, who);
      await deleteFile(`images/${im.file}`); await deleteFile(`images/${im.thumb}`);
      res.status(200).json({ library: doc });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
