// JSON files the poller writes and the pages read. Two backends, picked by the environment:
//   Vercel Blob (default)   BLOB_READ_WRITE_TOKEN set; pages read through the /data rewrite,
//                           functions read here with a cache-busting query so they see the latest write
//   local files             STORE_DIR set (e.g. ./data): everything stays on this machine; the
//                           local runner (scripts/serve.mjs) serves /data/* from that directory
import { put } from "@vercel/blob";
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
