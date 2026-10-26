// Producer state (what the ticker crawls). GET is public and uncached so the on-air ticker
// sees a publish within one poll of the page (5 s). PUT needs the studio cookie.
import { requireStudio, readBody } from "../lib/auth.js";
import { readJson, writeJson, defaultProducer } from "../lib/store.js";

const MAX_PINS = 60;
const MAX_MANUAL = 20;
const MAX_TEXT = 240;

function clean(body) {
  const pins = Array.isArray(body.pinnedRaceIds) ? body.pinnedRaceIds : [];
  const manual = Array.isArray(body.manualItems) ? body.manualItems : [];
  return {
    pinnedRaceIds: [...new Set(pins.filter((s) => typeof s === "string" && /^[0-9]{1,12}$/.test(s)))].slice(0, MAX_PINS),
    manualItems: manual
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ id: String(m.id ?? Date.now()).slice(0, 40), text: m.text.trim().slice(0, MAX_TEXT), createdAt: m.createdAt ?? new Date().toISOString() }))
      .slice(0, MAX_MANUAL),
    idleText: typeof body.idleText === "string" ? body.idleText.trim().slice(0, MAX_TEXT) : "",
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try {
      res.status(200).json((await readJson("producer.json")) ?? defaultProducer);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
    return;
  }
  if (req.method === "PUT") {
    if (!requireStudio(req, res)) return;
    try {
      const state = clean(readBody(req));
      await writeJson("producer.json", state);
      res.status(200).json(state);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
