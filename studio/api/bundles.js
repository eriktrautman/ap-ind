// Bundles: the shared library of named packages of races and text for the ticker's crawl, one document for everyone in the
// Studio. GET is public and uncached. PUT takes the whole document ({bundles}) from a publisher's or producer's cookie.
// Stored as bundles.json beside the published state and read by no output: Publish copies the bundles a crawl uses into
// producer.json, so editing the library never touches the live ticker.
import { requirePublisher, readBody } from "../lib/auth.js";
import { readFresh, writeFresh } from "../lib/store.js";
import { normalizeBundleLibrary, defaultBundleLibrary } from "../lib/control.js";

export async function currentBundles() {
  const { state: stored } = await readFresh("bundles.json");
  return stored ? normalizeBundleLibrary(stored) : defaultBundleLibrary();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try { res.status(200).json(await currentBundles()); } catch (e) { res.status(502).json({ error: e.message }); }
    return;
  }
  if (req.method === "PUT") {
    const who = await requirePublisher(req, res);
    if (!who) return;
    try {
      const body = readBody(req);
      if (!Array.isArray(body?.bundles)) { res.status(400).json({ error: "bundles must be a list" }); return; }
      const doc = { ...normalizeBundleLibrary({ bundles: body.bundles }), updatedAt: new Date().toISOString(), updatedBy: who.name };
      await writeFresh("bundles.json", doc);
      res.status(200).json(doc);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
