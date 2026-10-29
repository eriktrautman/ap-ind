// The published state as its readers see it: /data/producer.json, which the live ticker, the live screens and every
// graphic re-read every 5 s with the same ?t=<5 s bucket>, so the CDN answers all of them from one copy per bucket and a
// flood of readers costs one invocation per bucket per region. Read through lib/store.js readProducer(): the regional
// cache the moment after a publish, the blob otherwise. x-producer-source says which, for checking a deployment.
import { readProducer, defaultProducer } from "../lib/store.js";
import { normalize } from "../lib/control.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.status(405).json({ error: "method not allowed" }); return; }
  try {
    const { state, source } = await readProducer();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10");
    res.setHeader("X-Producer-Source", source);
    res.status(200).json(state ? normalize(state) : defaultProducer);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: e.message });
  }
}
