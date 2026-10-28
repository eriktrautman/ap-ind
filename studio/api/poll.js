// Vercel function: one poll cycle. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET),
// manually with ?secret=, or by a signed-in studio user (POST). ?fresh=1 drops the in-memory
// curated/photo caches first. Same code as the local runner.
import { pollOnce } from "../lib/poll.js";
import { isCron, authKind } from "../lib/auth.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const kind = isCron(req) ? "prod" : await authKind(req);
  if (kind !== "prod") {   // producer only: the rehearsal cookie cannot poll
    res.status(kind === false ? 401 : 403).json({ error: kind === false ? "unauthorized" : "producer only: this needs the real password, not the rehearsal one" });
    return;
  }
  const fresh = new URL(req.url, "http://x").searchParams.get("fresh") === "1";
  try {
    const status = await pollOnce({ fresh });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(status);
  } catch (e) {
    res.status(500).json({ ok: false, errors: [e.message] });
  }
}
