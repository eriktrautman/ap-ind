// Studio sign-in. GET → who this browser is (and, when signed in, everyone on the project with their role), POST { password } → sets the cookie, DELETE → clears it.
// The answer carries `name` ("Erik Trautman", "Rehearsal"), `role` ("producer" | "publisher" | "readonly" | "rehearsal") and `kind` (the account key);
// `testLogin` is true for the rehearsal password, which the Studio flags.
import { matchPassword, rehearsalAllowed, REHEARSAL_OFF, issueCookie, clearCookie, authUser, accounts, producersConfigured, readBody } from "../lib/auth.js";

const who = (a) => ({ authed: !!a, kind: a ? a.key : null, name: a ? a.name : null, role: a ? a.role : null, testLogin: a?.role === "rehearsal" });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const all = accounts();
    const me = await authUser(req);
    res.status(200).json({
      ...who(me), configured: all.length > 0, testConfigured: all.some((a) => a.role === "rehearsal"), rehearsalAllowed: await rehearsalAllowed(),
      // Who is on the project and with what rights (names and roles only), for the Studio's View User Permissions. Signed-in browsers only.
      ...(me ? { accounts: all.map((a) => ({ name: a.name, role: a.role })) } : {}),
    });
    return;
  }
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    res.status(200).json(who(null));
    return;
  }
  if (req.method === "POST") {
    if (!producersConfigured()) {
      res.status(500).json({ error: "no producer password is set on the server: add STUDIO_PASSWORD_PRODUCER_<FIRST>_<LAST> to the project and redeploy" });
      return;
    }
    // A small fixed delay blunts online guessing without any state to keep (the firewall rate-limits the rest).
    await new Promise((r) => setTimeout(r, 400));
    const a = matchPassword(readBody(req).password);
    if (!a) {
      res.status(403).json({ error: "wrong password" });
      return;
    }
    if (a.role === "rehearsal" && !(await rehearsalAllowed())) {
      res.status(403).json({ error: REHEARSAL_OFF });
      return;
    }
    res.setHeader("Set-Cookie", issueCookie(req, a));
    res.status(200).json(who(a));
    return;
  }
  res.status(405).json({ error: "method not allowed" });
}
