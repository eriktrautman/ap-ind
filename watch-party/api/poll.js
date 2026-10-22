// Vercel function: one poll cycle. Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET)
// or manually with ?secret=. Same code as the local runner.
import { pollOnce } from "../lib/poll.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization ?? "";
  const q = new URL(req.url, "http://x").searchParams.get("secret");
  if (secret && auth !== `Bearer ${secret}` && q !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const status = await pollOnce();
    res.status(200).json(status);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
