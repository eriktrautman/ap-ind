// Producer state: the Global source (what air uses). GET is public and uncached so the on-air
// ticker and every graphic see a publish within one poll. PUT needs the studio cookie.
//
// The body may carry any subset of the fields in lib/control.js; fields it leaves out keep
// their stored value, so an older panel that sends only the ticker fields cannot wipe the
// featured races or chart lists. Every field is validated and capped by normalize().
import { requireProducer, readBody } from "../lib/auth.js";
import { readJson, writeJson, defaultProducer } from "../lib/store.js";
import { normalize, DEFAULTS } from "../lib/control.js";

const FIELDS = Object.keys(DEFAULTS).filter((k) => k !== "updatedAt");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try {
      const stored = await readJson("producer.json");
      res.status(200).json(stored ? normalize(stored) : defaultProducer);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
    return;
  }
  if (req.method === "PUT") {
    if (!(await requireProducer(req, res))) return;
    try {
      const body = readBody(req);
      const prev = normalize((await readJson("producer.json")) ?? DEFAULTS);
      const merged = { ...prev };
      for (const k of FIELDS) if (k in body) merged[k] = body[k];
      const state = normalize({ ...merged, updatedAt: new Date().toISOString() });
      await writeJson("producer.json", state);
      res.status(200).json(state);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
