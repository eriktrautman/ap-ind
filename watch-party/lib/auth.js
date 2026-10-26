// Studio login: one shared password (STUDIO_PASSWORD) and a signed, expiring cookie.
// No sessions to store: the cookie is "<expiry>.<hmac>" and verifies statelessly.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const COOKIE = "studio";
const TTL_MS = 12 * 60 * 60 * 1000;

function secret() {
  const pw = process.env.STUDIO_PASSWORD;
  if (!pw) throw new Error("STUDIO_PASSWORD is not set");
  return createHash("sha256").update(`studio-cookie:${pw}`).digest();
}

function sig(exp) {
  return createHmac("sha256", secret()).update(String(exp)).digest("base64url");
}

export function checkPassword(given) {
  const pw = process.env.STUDIO_PASSWORD ?? "";
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(pw);
  return pw.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function issueCookie(req) {
  const exp = Date.now() + TTL_MS;
  const secure = (req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
  return `${COOKIE}=${exp}.${sig(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isAuthed(req) {
  try {
    const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [exp, s] = raw.slice(COOKIE.length + 1).split(".");
    if (!exp || !s || Number(exp) < Date.now()) return false;
    const a = Buffer.from(s), b = Buffer.from(sig(Number(exp)));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
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
