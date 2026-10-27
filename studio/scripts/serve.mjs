// The whole app on one laptop: the same code Vercel runs, in one Node process.
//   - static files from dist/ (cleanUrls, /data/* from the store, no-store for /studio and /ticker)
//   - the four API functions from api/, mounted with a small req/res shim
//   - the poller loop in place of Vercel Cron (every POLL_SECONDS, default 60; --no-poll to skip)
//
//   npm start                  build, then serve on http://localhost:3000
//   node scripts/serve.mjs --port 4000 --no-poll
//
// Needs a .env in studio/ with AP_API_KEY and STUDIO_PASSWORD, plus either
//   BLOB_READ_WRITE_TOKEN   to share the deployment's Blob store (what production uses), or
//   STORE_DIR=./data        to keep every JSON file on local disk instead (no Vercel at all).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { isLocalStore, localPath, BLOB_BASE } from "../lib/store.js";
import { pollOnce } from "../lib/poll.js";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt("--port", process.env.PORT ?? 3000));
const NO_POLL = args.includes("--no-poll");
const POLL_MS = Number(process.env.POLL_SECONDS ?? 60) * 1000;
const DIST = new URL("../dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

const handlers = {};
for (const name of ["login", "poll", "producer", "settings"]) handlers[name] = (await import(`../api/${name}.js`)).default;

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }
async function resolve(pathname) {
  const base = join(DIST, decodeURIComponent(pathname));
  if (pathname.endsWith("/")) return file(join(base, "index.html"));
  return (await file(base)) ?? (await file(base + ".html")) ?? (await file(join(base, "index.html")));
}
function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
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
}).listen(PORT, () => {
  console.log(`ap-ind: http://localhost:${PORT}  control room /studio · ticker /ticker · graphics /g/ · store: ${isLocalStore() ? `local files (${localPath("")})` : "Vercel Blob (shared with the deployment)"}`);
  if (NO_POLL) { console.log("poller: off (--no-poll); data comes from whatever last wrote the store"); return; }
  const tick = async () => { try { await pollOnce({ log: console.log }); } catch (e) { console.error(`[poll] failed: ${e.message}`); } };
  tick(); setInterval(tick, POLL_MS);
  console.log(`poller: every ${POLL_MS / 1000} s (the cron's job, done here)`);
});
