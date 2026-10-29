// Playlists: one person's run of charts for a segment, shared with everyone in the Studio. GET is public and uncached.
// PUT takes the whole document ({users}) from a publisher's or producer's cookie; adding, renaming or removing people or
// playlists needs a producer. Stored as playlists.json beside the published state, never read by an output.
import { requirePublisher, readBody } from "../lib/auth.js";
import { readJson, writeJson } from "../lib/store.js";
import { normalizePlaylists, defaultPlaylists } from "../lib/control.js";

export const PRODUCER_SHAPE = "producer only: adding, renaming or removing people and playlists needs a producer's password; a publisher changes what is in them";
const shape = (d) => JSON.stringify(d.users.map((u) => [u.id, u.name, u.playlists.map((p) => [p.id, p.name])]));

export async function currentPlaylists() {
  const stored = await readJson("playlists.json");
  return stored ? normalizePlaylists(stored) : defaultPlaylists();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try { res.status(200).json(await currentPlaylists()); } catch (e) { res.status(502).json({ error: e.message }); }
    return;
  }
  if (req.method === "PUT") {
    const who = await requirePublisher(req, res);
    if (!who) return;
    try {
      const body = readBody(req);
      const prev = await currentPlaylists();
      const next = normalizePlaylists({ users: body?.users });
      if (who.role !== "producer" && shape(prev) !== shape(next)) { res.status(403).json({ error: PRODUCER_SHAPE }); return; }
      const doc = { ...next, updatedAt: new Date().toISOString(), updatedBy: who.name };
      await writeJson("playlists.json", doc);
      res.status(200).json(doc);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
