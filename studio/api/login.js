// Studio sign-in. GET → { authed }, POST { password } → sets the cookie, DELETE → clears it.
import { checkPassword, issueCookie, clearCookie, isAuthed, readBody } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    res.status(200).json({ authed: isAuthed(req), configured: !!process.env.STUDIO_PASSWORD });
    return;
  }
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    res.status(200).json({ authed: false });
    return;
  }
  if (req.method === "POST") {
    if (!process.env.STUDIO_PASSWORD) {
      res.status(500).json({ error: "STUDIO_PASSWORD is not set on the server" });
      return;
    }
    // A small fixed delay blunts online guessing without any state to keep.
    await new Promise((r) => setTimeout(r, 400));
    if (!checkPassword(readBody(req).password)) {
      res.status(403).json({ error: "wrong password" });
      return;
    }
    res.setHeader("Set-Cookie", issueCookie(req));
    res.status(200).json({ authed: true });
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
