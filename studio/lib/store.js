// JSON files the poller writes and the pages read. Two backends, picked by the environment:
//   Vercel Blob (default)   BLOB_READ_WRITE_TOKEN set; pages read through the /data rewrite,
//                           functions read the blob directly (the Blob CDN still keeps an overwrite for up to 60 s;
//                           the published state has a fresh path of its own below)
//   local files             STORE_DIR set (e.g. ./data): everything stays on this machine; the
//                           local runner (scripts/serve.mjs) serves /data/* from that directory
import { put } from "@vercel/blob";
import { getCache } from "@vercel/functions";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DEFAULTS, normalize } from "./control.js";

export const BLOB_BASE = process.env.BLOB_BASE ?? "https://lhxyw7zt9v9qfbh3.public.blob.vercel-storage.com";
export const isLocalStore = () => !!process.env.STORE_DIR;
export const localPath = (path) => join(resolve(process.env.STORE_DIR ?? "./data"), path);

export async function writeJson(path, data) {
  const body = JSON.stringify(data);
  if (isLocalStore()) {
    const p = localPath(path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    return { path, url: p, bytes: body.length };
  }
  const res = await put(path, body, {
    access: "public", addRandomSuffix: false, contentType: "application/json",
    cacheControlMaxAge: 60, allowOverwrite: true,
  });
  return { path, url: res.url, bytes: body.length };
}

/** Latest copy of a file, or null if it has never been written. */
export async function readJson(path) {
  if (isLocalStore()) {
    try { return JSON.parse(await readFile(localPath(path), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  const res = await fetch(`${BLOB_BASE}/${path}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const defaultSettings = { resultsType: null, pollEnabled: true };
export const defaultProducer = normalize(DEFAULTS);

// The published state (producer.json) is the one file whose readers must see a write within seconds: the live ticker and
// the live screens re-read it every 5 s. The Blob CDN keeps an overwritten blob for up to 60 s and ignores any query
// string, so a publish read from the blob alone reaches air up to a minute late. A publish therefore also goes into the
// Vercel Runtime Cache (regional, shared by every function invocation in the region, kept across deployments), and every
// read takes the newer of the two copies: the cache the moment after a publish, the blob when the cache has nothing.
// With a local store there is no CDN and the file is the truth.
const PRODUCER_KEY = "producer.json";
const cache = () => { try { return getCache({ namespace: "ap-ind" }); } catch { return null; } };
const stampOf = (s) => (s && typeof s.updatedAt === "string" ? Date.parse(s.updatedAt) || 0 : 0);
/** The latest published state and where it came from: {state, source: "cache"|"blob"|"file"|"default"}. state is null if never published. */
export async function readProducer() {
  if (isLocalStore()) { const s = await readJson(PRODUCER_KEY); return { state: s, source: s ? "file" : "default" }; }
  const [cached, stored] = await Promise.all([
    cache()?.get(PRODUCER_KEY).catch(() => null) ?? null,
    readJson(PRODUCER_KEY),
  ]);
  if (cached && stampOf(cached) >= stampOf(stored)) return { state: cached, source: "cache" };
  return { state: stored, source: stored ? "blob" : "default" };
}
/** Write the published state: the blob (durable) and the regional cache (fresh at once). */
export async function writeProducer(state) {
  const out = await writeJson(PRODUCER_KEY, state);
  if (!isLocalStore()) await cache()?.set(PRODUCER_KEY, state, { ttl: 7 * 24 * 3600, name: "producer" }).catch(() => {});
  return out;
}
