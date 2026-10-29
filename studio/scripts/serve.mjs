// The whole app on one laptop: the same code Vercel runs, in one Node process.
//   - static files from dist/ (cleanUrls, /data/* from the store, producer.json from production when connected, no-store for /studio and /ticker)
//   - the four API functions from api/, mounted with a small req/res shim, plus /api/runtime, /api/promote, /api/demote (laptop only)
//   - where this machine's data comes from, by mode (see below)
//
//   npm start                  build, then serve on http://localhost:3000
//   node scripts/serve.mjs --port 4000 [--poll | --no-poll | --no-mirror]
//
// Production (the Live Ticker the Studio publishes to and pulls from) is chosen by GLOBAL in .env, and the
// mode follows from it. A laptop never polls AP while the deployment is production: the AP key allows ten requests a
// minute and one polling run uses six or seven, so two pollers on the key get both refused.
//   GLOBAL=https://electionproducer.com  the deployment is production and this laptop is its STANDBY. Mode "mirror":
//                                       every 30 s the deployment's data files (results, status, the published ticker,
//                                       settings) are copied into this machine's own files, so it is warm the moment it
//                                       is needed and uses no AP requests. Pull needs nothing more; publish needs
//                                       GLOBAL_PASSWORD (your own password on the deployment). --no-mirror serves without
//                                       copying; --poll polls AP from here anyway (only with a key of its own).
//   GLOBAL=self                         this machine IS production. Mode "poll": it polls AP every POLL_SECONDS (default 60)
//                                       into its own files and its outputs read them. --no-poll serves what the files hold.
// Promote (a producer button in the Studio, or POST /api/promote) turns a standby into production without a
// restart: mirroring stops, polling starts, the outputs switch to this machine's copy, and the Studio shows the
// address on the local network to point the switcher at. Demote reverses it.
// Needs AP_API_KEY and one STUDIO_PASSWORD_PRODUCER_*. A connected laptop keeps its files in STORE_DIR (./data when
// unset) and never writes the deployment's Blob store from here; BLOB_READ_WRITE_TOKEN belongs on a laptop only for
// `npm run poll`, the stand-in for a dead cron while the deployment's pages are up.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { networkInterfaces } from "node:os";
import { isLocalStore, localPath, readJson, writeJson, BLOB_BASE } from "../lib/store.js";
import { pollOnce } from "../lib/poll.js";
import { normalize } from "../lib/control.js";
import { requireProducer } from "../lib/auth.js";
import { studioGate } from "../proxy.js";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt("--port", process.env.PORT ?? 3000));
const NO_POLL = args.includes("--no-poll");
const FORCE_POLL = args.includes("--poll");
const NO_MIRROR = args.includes("--no-mirror");
const POLL_MS = Number(process.env.POLL_SECONDS ?? 60) * 1000;
const MIRROR_MS = Number(process.env.MIRROR_SECONDS ?? 30) * 1000;
const DIST = new URL("../dist/", import.meta.url).pathname;
const DEPLOYMENT = "https://electionproducer.com";
const GLOBAL = (process.env.GLOBAL ?? DEPLOYMENT).trim();
let CONNECTED = GLOBAL !== "self" && /^https?:\/\//.test(GLOBAL);   // false once promoted
const STANDBY = CONNECTED;                                           // started as the deployment's standby
const GLOBAL_PASSWORD = process.env.GLOBAL_PASSWORD ?? "";
// A connected laptop keeps its own files. It mirrors production into them and must never write production's store
// from here, whatever tokens .env happens to hold.
if (CONNECTED && !process.env.STORE_DIR) process.env.STORE_DIR = "./data";
if (CONNECTED && process.env.BLOB_READ_WRITE_TOKEN) console.log("note: BLOB_READ_WRITE_TOKEN is set but unused here; this laptop keeps its own files and never writes production's store (npm run poll is the one command that does)");

// ---- mode: where this machine's data comes from ----
//   mirror   standby: copy the deployment's files every MIRROR_MS (no AP requests)
//   poll     production: poll AP into the local files
//   follow   serve whatever the files hold, copy nothing (--no-mirror, or --no-poll on a production machine)
const mode = {
  kind: CONNECTED ? (FORCE_POLL ? "poll" : NO_MIRROR ? "follow" : "mirror") : NO_POLL ? "follow" : "poll",
  promotedAt: null, pollTimer: null, mirrorTimer: null,
  mirror: { lastOk: null, lastError: null, lastTry: null, indexGenerated: null, files: 0, runs: 0 },
  poll: { lastRun: null, lastError: null },
};
const MIRROR_FILES = ["index.json", "history.json", "trend.json", "producer.json", "settings.json", "playlists.json"];
async function fetchData(p) {
  const r = await fetch(`${GLOBAL}/data/${p}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
}
/** One mirror pass: the small files every time, a state's county file only when the deployment's status says it was refreshed. */
async function mirrorOnce() {
  mode.mirror.lastTry = Date.now();
  try {
    const status = await fetchData("status.json");
    if (!status) throw new Error("the deployment has no status.json yet");
    const had = (await readJson("status.json").catch(() => null))?.countyFreshness ?? {};
    let n = 0;
    for (const f of MIRROR_FILES) { const d = await fetchData(f); if (d) { await writeJson(f, d); n++; } }
    for (const [st, at] of Object.entries(status.countyFreshness ?? {})) {
      if (had[st] === at && (await file(localPath(`state/${st}.json`)))) continue;
      const d = await fetchData(`state/${st}.json`); if (d) { await writeJson(`state/${st}.json`, d); n++; }
    }
    await writeJson("status.json", status); n++;   // last, so a half-finished pass is retried in full
    Object.assign(mode.mirror, { lastOk: Date.now(), lastError: null, files: n, indexGenerated: status.generated ?? null, runs: mode.mirror.runs + 1 });
    if (mode.mirror.runs === 1) console.log(`[mirror] first copy from ${GLOBAL}: ${n} files into ${localPath("")}`);
  } catch (e) {
    mode.mirror.lastError = e.message; console.error(`[mirror] ${e.message}`);
  }
}
function startMirror() { if (mode.mirrorTimer) return; mirrorOnce(); mode.mirrorTimer = setInterval(mirrorOnce, MIRROR_MS); }
function stopMirror() { if (mode.mirrorTimer) clearInterval(mode.mirrorTimer); mode.mirrorTimer = null; }
async function pollTick() {
  mode.poll.lastRun = Date.now();
  try { await pollOnce({ log: console.log }); mode.poll.lastError = null; } catch (e) { mode.poll.lastError = e.message; console.error(`[poll] failed: ${e.message}`); }
}
function startPolling() { if (mode.pollTimer) return; pollTick(); mode.pollTimer = setInterval(pollTick, POLL_MS); }
function stopPolling() { if (mode.pollTimer) clearInterval(mode.pollTimer); mode.pollTimer = null; }
/** Standby → production: stop copying, start polling AP, serve this machine's own files. */
function promote() {
  if (mode.kind === "poll" && !CONNECTED) return;
  stopMirror(); CONNECTED = false; mode.kind = "poll"; mode.promotedAt = new Date().toISOString(); startPolling();
  console.log(`[promote] this machine is production: polling AP, serving its own files; point the switcher at ${lanOrigin()}`);
}
/** Production (after a promote) → standby again. */
function demote() {
  if (!STANDBY || CONNECTED) return;
  stopPolling(); CONNECTED = true; mode.kind = "mirror"; mode.promotedAt = null; startMirror();
  console.log(`[demote] back to standby: mirroring ${GLOBAL}`);
}
function lan() {
  for (const [iface, addrs] of Object.entries(networkInterfaces())) for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return { iface, ip: a.address };
  return null;
}
const lanOrigin = () => { const l = lan(); return l ? `http://${l.ip}:${PORT}` : `http://localhost:${PORT}`; };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

const handlers = {};
for (const name of ["login", "poll", "producer", "settings", "playlists"]) handlers[name] = (await import(`../api/${name}.js`)).default;

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }
async function resolve(pathname) {
  if (/^\/g\/[A-Za-z]\d{1,2}\/?$/.test(pathname)) pathname = "/g/chart.html";   // /g/B5: the chart router (vercel.json has the same rewrite)
  const base = join(DIST, decodeURIComponent(pathname));
  if (pathname.endsWith("/")) return file(join(base, "index.html"));
  return (await file(base)) ?? (await file(base + ".html")) ?? (await file(join(base, "index.html")));
}
function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
}
// ---- production over the wire (connected mode) ----
let upstreamCookie = null;
async function upstreamLogin() {
  const r = await fetch(`${GLOBAL}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: GLOBAL_PASSWORD }), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(r.status === 403 ? "production rejected GLOBAL_PASSWORD" : `production login failed (${r.status})`), { status: r.status === 403 ? 403 : 502 });
  upstreamCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
}
/** GET or PUT the deployment's producer state (or its playlists). PUT logs in with GLOBAL_PASSWORD first (once per process). */
async function upstreamProducer(method, body, path = "/api/producer") {
  if (method === "PUT") {
    if (!GLOBAL_PASSWORD) throw Object.assign(new Error("publish not configured: set GLOBAL_PASSWORD in studio/.env to the deployment's studio password"), { status: 403 });
    if (!upstreamCookie) await upstreamLogin();
  }
  let r = await fetch(`${GLOBAL}${path}`, { method, headers: { "content-type": "application/json", ...(method === "PUT" ? { cookie: upstreamCookie } : {}) }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (method === "PUT" && r.status === 401) { await upstreamLogin(); r = await fetch(`${GLOBAL}${path}`, { method, headers: { "content-type": "application/json", cookie: upstreamCookie }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
  return r;
}
async function reachable() {
  try { const r = await fetch(`${GLOBAL}/api/login`, { cache: "no-store", signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
}

/** Vercel's Node request/response helpers that the handlers use. */
function shim(req, res, body) {
  try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(data)); return res; };
  res.send = (data) => { res.end(typeof data === "string" ? data : JSON.stringify(data)); return res; };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/runtime") {
      const up = STANDBY ? await reachable() : null;   // the deployment's health matters to a standby in either state
      const l = lan();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({
        local: true, store: isLocalStore() ? "files" : "blob", mode: mode.kind, polling: !!mode.pollTimer, promotedAt: mode.promotedAt,
        standby: STANDBY, canPromote: STANDBY && CONNECTED, canDemote: STANDBY && !CONNECTED,
        mirror: mode.kind === "mirror" ? { ...mode.mirror, ageMs: mode.mirror.lastOk ? Date.now() - mode.mirror.lastOk : null, every: MIRROR_MS / 1000 } : null,
        poll: mode.kind === "poll" ? { ...mode.poll, every: POLL_MS / 1000 } : null,
        lan: lanOrigin(), iface: l?.iface ?? null, ip: l?.ip ?? null,
        deployment: STANDBY ? { origin: GLOBAL, reachable: up } : null,
        production: CONNECTED
          ? { where: "deployment", origin: GLOBAL, reachable: up, canPull: up, canPush: up && !!GLOBAL_PASSWORD, reason: !up ? `${GLOBAL} is not answering` : !GLOBAL_PASSWORD ? "publish not configured: add GLOBAL_PASSWORD (your own password on the deployment) to studio/.env and restart" : null }
          : { where: "self", origin: lanOrigin(), reachable: true, canPull: true, canPush: true, reason: null },
      }));
      return;
    }
    if ((url.pathname === "/api/promote" || url.pathname === "/api/demote") && req.method === "POST") {
      shim(req, res, await readBody(req));
      if (!(await requireProducer(req, res))) return;
      if (!STANDBY) { res.status(400).json({ error: "this machine was started as production (GLOBAL=self); there is nothing to promote or demote" }); return; }
      if (url.pathname === "/api/promote") promote(); else demote();
      res.status(200).json({ ok: true, mode: mode.kind, production: CONNECTED ? "deployment" : "self", lan: lanOrigin() });
      return;
    }
    if ((url.pathname === "/api/producer" || url.pathname === "/api/playlists") && CONNECTED) {
      // Production lives on the deployment: this machine's outputs and Studio read it from
      // there, and a push goes there (after the local sign-in check, then the deployment's). Playlists likewise.
      if (req.method === "PUT") {
        const body = await readBody(req); shim(req, res, body);
        if (!(await (await import("../lib/auth.js")).isAuthed(req))) { res.status(401).json({ error: "not signed in" }); return; }
        try { const r = await upstreamProducer("PUT", body, url.pathname); res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await r.text()); }
        catch (e) { res.writeHead(e.status ?? 502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
        return;
      }
      try { const r = await upstreamProducer("GET", undefined, url.pathname); res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await r.text()); }
      catch (e) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: `production unreachable: ${e.message}` })); }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const h = handlers[url.pathname.slice(5).replace(/\/$/, "")];
      if (!h) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not found" })); return; }
      shim(req, res, await readBody(req));
      await h(req, res);
      return;
    }
    if (url.pathname.startsWith("/data/")) {
      const rel = url.pathname.slice(6);
      if (rel === "producer.json" && CONNECTED) {
        // Production's ticker parameters live on the deployment; this machine's ticker and graphics read them from there.
        try { const r = await fetch(`${GLOBAL}/data/producer.json${url.search}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }); res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(Buffer.from(await r.arrayBuffer())); }
        catch (e) { res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: `production unreachable: ${e.message}` })); }
        return;
      }
      if (isLocalStore()) {
        const p = await file(localPath(rel));
        if (!p) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await readFile(p)); return;
      }
      const r = await fetch(`${BLOB_BASE}/${rel}`, { cache: "no-store" });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    // /studio needs a Studio cookie before any of it is served (proxy.js does this on Vercel; same rule here).
    if (studioGate(url.pathname, req.headers.cookie)) { res.writeHead(302, { location: "/studio/login", "cache-control": "no-store" }); res.end(); return; }
    const p = await resolve(url.pathname);
    if (!p) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    const noStore = /^\/(studio|ticker|ticker-queue|live-screen)/.test(url.pathname);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "cache-control": noStore ? "no-store" : "public, max-age=10" });
    res.end(await readFile(p));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end(String(e.message));
  }
}).listen(PORT, async () => {
  // A machine started as production (GLOBAL=self) with files that have never held a producer state starts from what
  // the deployment has, so it carries the published ticker from the first minute. A standby gets the same from its mirror.
  if (!CONNECTED && isLocalStore() && !(await readJson("producer.json").catch(() => null))) {
    try {
      const r = await fetch(`${DEPLOYMENT}/api/producer`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.ok) { await writeJson("producer.json", normalize(await r.json())); console.log(`seeded producer.json from ${DEPLOYMENT} (first run)`); }
    } catch (e) { console.log(`could not seed from ${DEPLOYMENT}: ${e.message}; starting from the defaults`); }
  }
  console.log(`ap-ind: http://localhost:${PORT}  on this network ${lanOrigin()}  Studio /studio · ticker /ticker · graphics /g/ · files: ${isLocalStore() ? localPath("") : "Vercel Blob (shared with the deployment)"}`);
  console.log(CONNECTED ? `production: ${GLOBAL} (this laptop is its standby; pull ready; publish ${GLOBAL_PASSWORD ? "ready" : "NOT configured: set GLOBAL_PASSWORD"})` : "production: THIS MACHINE (GLOBAL=self); its outputs read its own files");
  if (mode.kind === "mirror") { startMirror(); console.log(`mirror: copying ${GLOBAL}'s data files every ${MIRROR_MS / 1000} s (no AP requests); Promote in the Studio makes this laptop production`); }
  else if (mode.kind === "poll") { startPolling(); console.log(`poller: AP every ${POLL_MS / 1000} s into this machine's files${CONNECTED ? " (--poll: make sure no other poller shares this AP key)" : ""}`); }
  else console.log(`serving only (${CONNECTED ? "--no-mirror" : "--no-poll"}): data comes from whatever the files hold`);
});
