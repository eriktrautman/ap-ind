// Vercel function: one poll cycle. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET),
// manually with ?secret=, or by a signed-in studio user (POST). ?fresh=1 drops the in-memory
// curated/photo caches first. Same code as the local runner.
import { pollOnce } from "../lib/poll.js";
import { isCron, isAuthed } from "../lib/auth.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!isCron(req) && !(await isAuthed(req))) {
    res.status(401).json({ error: "unauthorized" });
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
