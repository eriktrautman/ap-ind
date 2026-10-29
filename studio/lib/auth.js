// Studio login: per-person passwords and a signed, expiring cookie. Accounts come from the environment,
// read at call time, so adding or removing one is an env change plus a redeploy, no code:
//   STUDIO_PASSWORD_<NAME>   one producer per person: STUDIO_PASSWORD_ERIK signs in as "Erik" (MARY_ANN → "Mary Ann").
//                            Full rights: publish, poll, Test/Live, pause. Delete the variable to revoke that person;
//                            every cookie it issued stops verifying and nobody else is signed out.
//   STUDIO_TEST_PASSWORD     the rehearsal password ("Rehearsal"): can look, cannot change anything published. It
//                            works only while the poller is on AP's test results: the moment results are switched to
//                            Live, sign-ins with it are refused and every cookie it issued stops verifying.
//   STUDIO_PASSWORD          the old unnamed producer password, still accepted (as "Producer") so a project that has
//                            not been moved to named passwords keeps working. Retire it once each person has their own.
// No sessions to store: the cookie is "<expiry>.<key>.<hmac>" and verifies statelessly, keyed by the password it was
// issued for, so changing one person's password signs out that person and nobody else. Every publish is stamped with
// the signer's name (producer.json updatedBy), which is the whole of the audit trail and what the conflict warning shows.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { readJson } from "./store.js";

const COOKIE = "studio";
const TTL_MS = 12 * 60 * 60 * 1000;
const NAMED = /^STUDIO_PASSWORD_([A-Z0-9_]+)$/;
const titleCase = (s) => s.toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Every account with a non-empty password, from the environment right now: {key, env, name, role}. role: producer | rehearsal. */
export function accounts() {
  const out = [];
  for (const [env, value] of Object.entries(process.env)) {
    const m = NAMED.exec(env);
    if (m && value) out.push({ key: m[1].toLowerCase(), env, name: titleCase(m[1]), role: "producer" });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  if (process.env.STUDIO_PASSWORD) out.push({ key: "prod", env: "STUDIO_PASSWORD", name: "Producer", role: "producer" });
  if (process.env.STUDIO_TEST_PASSWORD) out.push({ key: "test", env: "STUDIO_TEST_PASSWORD", name: "Rehearsal", role: "rehearsal" });
  return out;
}
export const account = (key) => accounts().find((a) => a.key === key) ?? null;
export const configured = () => accounts().map((a) => a.key);
export const producersConfigured = () => accounts().some((a) => a.role === "producer");

function secret(a) {
  return createHash("sha256").update(`studio-cookie:${a.key}:${process.env[a.env]}`).digest();
}
function sig(a, exp) {
  return createHmac("sha256", secret(a)).update(`${a.key}.${exp}`).digest("base64url");
}
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The account whose password `given` is, or null. Does not apply the Live rule. */
export function matchPassword(given) {
  const g = String(given ?? "");
  for (const a of accounts()) if (same(g, process.env[a.env])) return a;
  return null;
}

/** The rehearsal password is allowed only while the poller is on test results (settings.json, else AP_RESULTS_TYPE). */
export async function rehearsalAllowed() {
  let type = null;
  try { type = (await readJson("settings.json"))?.resultsType ?? null; } catch {}
  return (type ?? process.env.AP_RESULTS_TYPE ?? "t") !== "l";
}
export const REHEARSAL_OFF = "That is the rehearsal password, and results are now Live, so it is switched off. Sign in with your own password.";

export function issueCookie(req, a) {
  const exp = Date.now() + TTL_MS;
  const secure = (req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
  return `${COOKIE}=${exp}.${a.key}.${sig(a, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The account this request is signed in as ({key, name, role, env}), or false. A rehearsal cookie is false while results are Live. */
export async function authUser(req) {
  let a;
  try {
    const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return false;
    const [exp, key, s] = raw.slice(COOKIE.length + 1).split(".");
    if (!exp || !key || !s || Number(exp) < Date.now()) return false;
    a = account(key);
    if (!a || !same(s, sig(a, Number(exp)))) return false;
  } catch {
    return false;
  }
  if (a.role === "rehearsal" && !(await rehearsalAllowed())) return false;
  return a;
}
/** The signed-in account's key ("erik", "test", …) or false. Kept for callers that only need a yes/no with a label. */
export async function authKind(req) {
  const a = await authUser(req);
  return a ? a.key : false;
}
export async function isAuthed(req) {
  return (await authUser(req)) !== false;
}
/** The request carries a producer's cookie. */
export async function isProducer(req) {
  return (await authUser(req))?.role === "producer";
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
export const PRODUCER_ONLY = "producer only: this needs your own password, not the rehearsal one";
/** Producer-only actions (publish, poll, settings): returns the account, or sends 401/403 and returns false. */
export async function requireProducer(req, res) {
  const a = await authUser(req);
  if (a && a.role === "producer") return a;
  if (!a) { res.status(401).json({ error: "not signed in" }); return false; }
  res.status(403).json({ error: PRODUCER_ONLY });
  return false;
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
