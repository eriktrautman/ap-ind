// Vercel function: one poll cycle. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET),
// manually with ?secret=, or by a signed-in studio user (POST). ?fresh=1 drops the in-memory
// curated/photo caches first. Same code as the local runner.
import { pollOnce } from "../lib/poll.js";
import { isCron, authUser, PRODUCER_ONLY } from "../lib/auth.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!isCron(req)) {   // producer only: the rehearsal cookie cannot poll
    const a = await authUser(req);
    if (a?.role !== "producer") { res.status(a ? 403 : 401).json({ error: a ? PRODUCER_ONLY : "unauthorized" }); return; }
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
