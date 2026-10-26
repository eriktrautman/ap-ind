// JSON files in Vercel Blob. The poller writes; pages read through the /data rewrite;
// functions read here with a cache-busting query so they always see the latest write.
import { put } from "@vercel/blob";

export const BLOB_BASE = "https://lhxyw7zt9v9qfbh3.public.blob.vercel-storage.com";

export async function writeJson(path, data) {
  const body = JSON.stringify(data);
  const res = await put(path, body, {
    access: "public", addRandomSuffix: false, contentType: "application/json",
    cacheControlMaxAge: 60, allowOverwrite: true,
  });
  return { path, url: res.url, bytes: body.length };
}

/** Latest copy of a file, or null if it has never been written. */
export async function readJson(path) {
  const res = await fetch(`${BLOB_BASE}/${path}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const defaultSettings = { resultsType: null, pollEnabled: true };
export const defaultProducer = { pinnedRaceIds: [], manualItems: [], idleText: "", updatedAt: null };
