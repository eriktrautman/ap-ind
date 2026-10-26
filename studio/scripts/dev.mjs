// Local preview of the deployment: serves dist/ the way Vercel does (cleanUrls, /data rewrite)
// and proxies /api/* to the live deployment so pages run on real Blob data without a build on
// Vercel. Read-only for the API: PUT and DELETE are refused so nothing local can publish.
//   npm run build && node scripts/dev.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const PORT = Number(process.argv[2] ?? 4174);
const DIST = new URL("../dist/", import.meta.url).pathname;
const BLOB = "https://lhxyw7zt9v9qfbh3.public.blob.vercel-storage.com";
const LIVE = process.env.LIVE_ORIGIN ?? "https://ap-ind.vercel.app";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }
async function resolve(pathname) {
  const base = join(DIST, decodeURIComponent(pathname));
  if (pathname.endsWith("/")) return file(join(base, "index.html"));
  return (await file(base)) ?? (await file(base + ".html")) ?? (await file(join(base, "index.html")));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/data/")) {
      // DEV_DATA=<dir>: a file there with the same relative path overrides the Blob copy (for testing).
      if (process.env.DEV_DATA) { const o = await file(join(process.env.DEV_DATA, url.pathname.slice(6))); if (o) { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(await readFile(o)); return; } }
      const r = await fetch(`${BLOB}${url.pathname.slice(5)}`, { cache: "no-store" });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      // DEV_AUTHED=1 renders the control room without a password (writes are still refused).
      if (url.pathname === "/api/login" && req.method === "GET" && process.env.DEV_AUTHED) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ authed: true, configured: true })); return; }
      if (req.method !== "GET") { res.writeHead(405, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "dev server is read-only; publish from the deployment" })); return; }
      const r = await fetch(`${LIVE}${url.pathname}${url.search}`, { cache: "no-store" });
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const p = await resolve(url.pathname);
    if (!p) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(p));
  } catch (e) {
    res.writeHead(502, { "content-type": "text/plain" }); res.end(String(e.message));
  }
}).listen(PORT, () => console.log(`dev: http://localhost:${PORT}  (dist/, /data -> Blob, GET /api -> ${LIVE})`));
