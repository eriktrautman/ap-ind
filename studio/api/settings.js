// Poller settings the studio can change without a redeploy: results type (t = AP test data,
// l = live) and a pause switch. The poller reads this file at the start of every run.
import { requireProducer, readBody } from "../lib/auth.js";
import { readJson, writeJson, defaultSettings } from "../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try {
      res.status(200).json({ ...defaultSettings, ...((await readJson("settings.json")) ?? {}), envResultsType: process.env.AP_RESULTS_TYPE ?? "t" });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
    return;
  }
  if (req.method === "PUT") {
    if (!(await requireProducer(req, res))) return;
    const b = readBody(req);
    const next = {
      resultsType: b.resultsType === "l" || b.resultsType === "t" ? b.resultsType : null,
      pollEnabled: b.pollEnabled !== false,
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeJson("settings.json", next);
      res.status(200).json(next);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
