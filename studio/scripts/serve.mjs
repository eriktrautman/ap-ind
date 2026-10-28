// The whole app on one laptop: the same code Vercel runs, in one Node process.
//   - static files from dist/ (cleanUrls, /data/* from the store, no-store for /studio and /ticker)
//   - the four API functions from api/, mounted with a small req/res shim
//   - the poller loop in place of Vercel Cron (every POLL_SECONDS, default 60; --no-poll to skip)
//
//   npm start                  build, then serve on http://localhost:3000
//   node scripts/serve.mjs --port 4000 --no-poll
//
// Production state (what the control room pushes to and pulls from) is chosen by GLOBAL in .env:
//   GLOBAL=https://ap-ind.vercel.app   the deployment is production. Pull needs nothing more; push
//                                       needs GLOBAL_PASSWORD (the deployment's studio password).
//   GLOBAL=self                         this machine is production: its own outputs read its own
//                                       store (the standby case when the deployment is down).
// Needs AP_API_KEY and STUDIO_PASSWORD, plus BLOB_READ_WRITE_TOKEN (share the deployment's Blob
// store) or STORE_DIR=./data (keep every JSON file on local disk).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { isLocalStore, localPath, readJson, writeJson, BLOB_BASE } from "../lib/store.js";
import { pollOnce } from "../lib/poll.js";
import { normalize } from "../lib/control.js";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt("--port", process.env.PORT ?? 3000));
const NO_POLL = args.includes("--no-poll");
const POLL_MS = Number(process.env.POLL_SECONDS ?? 60) * 1000;
const DIST = new URL("../dist/", import.meta.url).pathname;
const DEPLOYMENT = "https://ap-ind.vercel.app";
const GLOBAL = (process.env.GLOBAL ?? DEPLOYMENT).trim();
const CONNECTED = GLOBAL !== "self" && /^https?:\/\//.test(GLOBAL);
const GLOBAL_PASSWORD = process.env.GLOBAL_PASSWORD ?? "";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

const handlers = {};
for (const name of ["login", "poll", "producer", "settings"]) handlers[name] = (await import(`../api/${name}.js`)).default;

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
/** GET or PUT the deployment's producer state. PUT logs in with GLOBAL_PASSWORD first (once per process). */
async function upstreamProducer(method, body) {
  if (method === "PUT") {
    if (!GLOBAL_PASSWORD) throw Object.assign(new Error("push not configured: set GLOBAL_PASSWORD in studio/.env to the deployment's studio password"), { status: 403 });
    if (!upstreamCookie) await upstreamLogin();
  }
  let r = await fetch(`${GLOBAL}/api/producer`, { method, headers: { "content-type": "application/json", ...(method === "PUT" ? { cookie: upstreamCookie } : {}) }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (method === "PUT" && r.status === 401) { await upstreamLogin(); r = await fetch(`${GLOBAL}/api/producer`, { method, headers: { "content-type": "application/json", cookie: upstreamCookie }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
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
      const up = CONNECTED ? await reachable() : null;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({
        local: true, store: isLocalStore() ? "files" : "blob", polling: !NO_POLL,
        production: CONNECTED
          ? { where: "deployment", origin: GLOBAL, reachable: up, canPull: up, canPush: up && !!GLOBAL_PASSWORD, reason: !up ? `${GLOBAL} is not answering` : !GLOBAL_PASSWORD ? "push not configured: add GLOBAL_PASSWORD (the deployment's studio password) to studio/.env and restart" : null }
          : { where: "self", origin: `http://localhost:${PORT}`, reachable: true, canPull: true, canPush: true, reason: null },
      }));
      return;
    }
    if (url.pathname === "/api/producer" && CONNECTED) {
      // Production lives on the deployment: this machine's outputs and control room read it from
      // there, and a push goes there (after the local sign-in check, then the deployment's).
      if (req.method === "PUT") {
        const body = await readBody(req); shim(req, res, body);
        if (!(await (await import("../lib/auth.js")).isAuthed(req))) { res.status(401).json({ error: "not signed in" }); return; }
        try { const r = await upstreamProducer("PUT", body); res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await r.text()); }
        catch (e) { res.writeHead(e.status ?? 502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
        return;
      }
      try { const r = await upstreamProducer("GET"); res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await r.text()); }
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
    const p = await resolve(url.pathname);
    if (!p) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    const noStore = /^\/(studio|ticker|ticker-queue)/.test(url.pathname);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "cache-control": noStore ? "no-store" : "public, max-age=10" });
    res.end(await readFile(p));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end(String(e.message));
  }
}).listen(PORT, async () => {
  // Standby (GLOBAL=self) with a store that has never held a producer state: start from what the
  // deployment has, so the laptop carries the production ticker list and featured races from the first minute.
  if (!CONNECTED && isLocalStore() && !(await readJson("producer.json").catch(() => null))) {
    try {
      const r = await fetch(`${DEPLOYMENT}/api/producer`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.ok) { await writeJson("producer.json", normalize(await r.json())); console.log(`seeded producer.json from ${DEPLOYMENT} (first run)`); }
    } catch (e) { console.log(`could not seed from ${DEPLOYMENT}: ${e.message}; starting from the defaults`); }
  }
  console.log(`ap-ind: http://localhost:${PORT}  control room /studio · ticker /ticker · graphics /g/ · store: ${isLocalStore() ? `local files (${localPath("")})` : "Vercel Blob (shared with the deployment)"}`);
  console.log(CONNECTED ? `production: ${GLOBAL} (pull ready; push ${GLOBAL_PASSWORD ? "ready" : "NOT configured: set GLOBAL_PASSWORD"})` : "production: this machine (GLOBAL=self); its outputs read its own store");
  if (NO_POLL) { console.log("poller: off (--no-poll); data comes from whatever last wrote the store"); return; }
  const tick = async () => { try { await pollOnce({ log: console.log }); } catch (e) { console.error(`[poll] failed: ${e.message}`); } };
  tick(); setInterval(tick, POLL_MS);
  console.log(`poller: every ${POLL_MS / 1000} s (the cron's job, done here)`);
});
