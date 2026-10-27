// Studio login: a shared password and a signed, expiring cookie. Two passwords are accepted,
// each from its own env var, and the cookie records which one signed in:
//   STUDIO_PASSWORD        the real one, for the night
//   STUDIO_TEST_PASSWORD   an easy one for rehearsals; the control room flags it, and removing the
//                          variable (then redeploying) signs every test session out at once
// No sessions to store: the cookie is "<expiry>.<kind>.<hmac>" and verifies statelessly, keyed by
// the password it was issued for, so changing a password signs out everyone who used it.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const COOKIE = "studio";
const TTL_MS = 12 * 60 * 60 * 1000;
export const KINDS = { prod: "STUDIO_PASSWORD", test: "STUDIO_TEST_PASSWORD" };

const password = (kind) => process.env[KINDS[kind]] ?? "";
export const configured = () => Object.keys(KINDS).filter((k) => password(k).length > 0);

function secret(kind) {
  const pw = password(kind);
  if (!pw) throw new Error(`${KINDS[kind]} is not set`);
  return createHash("sha256").update(`studio-cookie:${kind}:${pw}`).digest();
}

function sig(kind, exp) {
  return createHmac("sha256", secret(kind)).update(`${kind}.${exp}`).digest("base64url");
}

const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Which configured password `given` matches: "prod", "test", or null. */
export function checkPassword(given) {
  const g = String(given ?? "");
  for (const kind of configured()) if (same(g, password(kind))) return kind;
  return null;
}

export function issueCookie(req, kind) {
  const exp = Date.now() + TTL_MS;
  const secure = (req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
  return `${COOKIE}=${exp}.${kind}.${sig(kind, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The kind of password this request signed in with ("prod" | "test"), or false. */
export function authKind(req) {
  try {
    const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [exp, kind, s] = raw.slice(COOKIE.length + 1).split(".");
    if (!exp || !s || !(kind in KINDS) || Number(exp) < Date.now()) return false;
    return same(s, sig(kind, Number(exp))) ? kind : false;
  } catch {
    return false;
  }
}

export function isAuthed(req) {
  return authKind(req) !== false;
}

/** Vercel Cron sends Authorization: Bearer CRON_SECRET; ?secret= is for curl. */
export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization ?? "";
  const q = new URL(req.url, "http://x").searchParams.get("secret");
  return auth === `Bearer ${secret}` || q === secret;
}

/** 401 and false unless the request carries a valid studio cookie. */
export function requireStudio(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: "not signed in" });
  return false;
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
