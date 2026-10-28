// Studio login: a shared password and a signed, expiring cookie. Two passwords are accepted,
// each from its own env var, and the cookie records which one signed in:
//   STUDIO_PASSWORD        the real one, for the night
//   STUDIO_TEST_PASSWORD   an easy one for rehearsals. It works only while the poller is on AP's test
//                          results: the moment results are switched to Live, sign-ins with it are
//                          refused and every cookie it issued stops verifying. Removing the variable
//                          (then redeploying) does the same for good.
// No sessions to store: the cookie is "<expiry>.<kind>.<hmac>" and verifies statelessly, keyed by
// the password it was issued for, so changing a password signs out everyone who used it.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { readJson } from "./store.js";

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

/** Which configured password `given` matches: "prod", "test", or null. Does not apply the Live rule. */
export function matchPassword(given) {
  const g = String(given ?? "");
  for (const kind of configured()) if (same(g, password(kind))) return kind;
  return null;
}

/** The rehearsal password is allowed only while the poller is on test results (settings.json, else AP_RESULTS_TYPE). */
export async function rehearsalAllowed() {
  let type = null;
  try { type = (await readJson("settings.json"))?.resultsType ?? null; } catch {}
  return (type ?? process.env.AP_RESULTS_TYPE ?? "t") !== "l";
}
export const REHEARSAL_OFF = "That is the rehearsal password, and results are now Live, so it is switched off. Sign in with the real password.";

/** Like matchPassword, but a test match while results are Live returns null. */
export async function checkPassword(given) {
  const kind = matchPassword(given);
  return kind === "test" && !(await rehearsalAllowed()) ? null : kind;
}

export function issueCookie(req, kind) {
  const exp = Date.now() + TTL_MS;
  const secure = (req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
  return `${COOKIE}=${exp}.${kind}.${sig(kind, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The kind of password this request signed in with ("prod" | "test"), or false. A test cookie is false while results are Live. */
export async function authKind(req) {
  let kind;
  try {
    const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [exp, k, s] = raw.slice(COOKIE.length + 1).split(".");
    if (!exp || !s || !(k in KINDS) || Number(exp) < Date.now()) return false;
    if (!same(s, sig(k, Number(exp)))) return false;
    kind = k;
  } catch {
    return false;
  }
  if (kind === "test" && !(await rehearsalAllowed())) return false;
  return kind;
}

export async function isAuthed(req) {
  return (await authKind(req)) !== false;
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
export async function requireStudio(req, res) {
  if (await isAuthed(req)) return true;
  res.status(401).json({ error: "not signed in" });
  return false;
}

/** Producer-only actions (publish, poll, settings): the real password's cookie; the rehearsal cookie gets a 403. */
export async function requireProducer(req, res) {
  const kind = await authKind(req);
  if (kind === "prod") return true;
  if (kind === false) { res.status(401).json({ error: "not signed in" }); return false; }
  res.status(403).json({ error: "producer only: this needs the real password, not the rehearsal one" });
  return false;
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
