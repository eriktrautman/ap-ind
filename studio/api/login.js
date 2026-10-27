// Studio sign-in. GET → { authed, kind, testLogin }, POST { password } → sets the cookie, DELETE → clears it.
// `kind` is "prod" or "test" by which password signed in; the control room flags a test sign-in.
import { matchPassword, rehearsalAllowed, REHEARSAL_OFF, issueCookie, clearCookie, authKind, configured, readBody } from "../lib/auth.js";

const whoami = async (req) => { const kind = await authKind(req); return { authed: kind !== false, kind: kind || null, testLogin: kind === "test" }; };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    res.status(200).json({ ...(await whoami(req)), configured: configured().length > 0, testConfigured: configured().includes("test"), rehearsalAllowed: await rehearsalAllowed() });
    return;
  }
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    res.status(200).json({ authed: false, kind: null, testLogin: false });
    return;
  }
  if (req.method === "POST") {
    if (!configured().length) {
      res.status(500).json({ error: "STUDIO_PASSWORD is not set on the server" });
      return;
    }
    // A small fixed delay blunts online guessing without any state to keep.
    await new Promise((r) => setTimeout(r, 400));
    const kind = matchPassword(readBody(req).password);
    if (!kind) {
      res.status(403).json({ error: "wrong password" });
      return;
    }
    if (kind === "test" && !(await rehearsalAllowed())) {
      res.status(403).json({ error: REHEARSAL_OFF });
      return;
    }
    res.setHeader("Set-Cookie", issueCookie(req, kind));
    res.status(200).json({ authed: true, kind, testLogin: kind === "test" });
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
