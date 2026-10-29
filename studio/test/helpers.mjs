// Shared by the smoke test: the base URL to test (SMOKE_URL, or a local server started here on a free port with
// its own files and known passwords) and small fetch helpers. The local server is the same scripts/serve.mjs a
// laptop runs, in production mode (GLOBAL=self) without polling, serving dist/ (so `npm run build` comes first).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, normalize } from "../lib/control.js";

export const STUDIO = "/studio";
export const PASSWORDS = { producer: "producer-pw-for-tests", publisher: "publisher-pw-for-tests", readonly: "readonly-pw-for-tests", rehearsal: "rehearsal-pw-for-tests" };

/** Two races, enough for a ticker and a chart address. The AP ids are made up; the shape is the poller's. */
export const INDEX = {
  resultsType: "t", generatedAt: new Date().toISOString(),
  races: [
    { id: "90001", label: "NE-SEN", state: "NE", office: "S", officeName: "U.S. Senate", kind: "federal", featured: true, called: false, totalVotes: 1000, precinctsPct: 40, eevp: 40,
      candidates: [{ name: "Dan Osborn", last: "Osborn", party: "Ind", independent: true, pct: 51.0, votes: 510 }, { name: "Pete Ricketts", last: "Ricketts", party: "GOP", pct: 49.0, votes: 490 }] },
    { id: "90002", label: "MT-SEN", state: "MT", office: "S", officeName: "U.S. Senate", kind: "federal", featured: false, called: true, totalVotes: 2000, precinctsPct: 100, eevp: 100,
      candidates: [{ name: "A Winner", last: "Winner", party: "Dem", pct: 60.0, votes: 1200, winner: true }, { name: "B Loser", last: "Loser", party: "GOP", pct: 40.0, votes: 800 }] },
  ],
};

/** { base, local, stop } : SMOKE_URL as given, or a server of our own. */
export async function server() {
  if (process.env.SMOKE_URL) return { base: process.env.SMOKE_URL.replace(/\/$/, ""), local: false, password: process.env.SMOKE_PASSWORD || null, stop() {} };
  const dir = mkdtempSync(join(tmpdir(), "ep-test-"));
  const store = join(dir, "store"); mkdirSync(store);
  writeFileSync(join(store, "index.json"), JSON.stringify(INDEX));
  writeFileSync(join(store, "producer.json"), JSON.stringify(normalize(DEFAULTS)));   // present, so the server does not seed it from the deployment
  writeFileSync(join(store, "status.json"), JSON.stringify({ lastApSuccess: new Date().toISOString(), lastRun: new Date().toISOString(), resultsType: "t", ok: true }));
  const port = 4300 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env, GLOBAL: "self", STORE_DIR: store, AP_API_KEY: "unused-in-tests", AP_RESULTS_TYPE: "t",
    STUDIO_PASSWORD_PRODUCER_TEST_PRODUCER: PASSWORDS.producer, STUDIO_PASSWORD_PUBLISHER_TEST_PUBLISHER: PASSWORDS.publisher,
    STUDIO_PASSWORD_READONLY_TEST_READER: PASSWORDS.readonly, STUDIO_TEST_PASSWORD: PASSWORDS.rehearsal,
  };
  delete env.STUDIO_PASSWORD; delete env.GLOBAL_PASSWORD; delete env.BLOB_READ_WRITE_TOKEN;
  const child = spawn(process.execPath, [new URL("../scripts/serve.mjs", import.meta.url).pathname, "--no-poll", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${log}`);
    try { if ((await fetch(`${base}/api/login`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, local: true, password: PASSWORDS.producer, stop() { child.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

/** fetch that never follows redirects and returns { status, location, text, json }. */
export async function get(url, opts = {}) {
  const res = await fetch(url, { redirect: "manual", cache: "no-store", ...opts });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.get("set-cookie"), type: res.headers.get("content-type") ?? "", text, json };
}
export const post = (url, body, headers = {}) => get(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
export const put = (url, body, headers = {}) => get(url, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Sign in and return the Cookie header value, or null when it fails. */
export async function signIn(base, password) {
  const r = await post(`${base}/api/login`, { password });
  return r.status === 200 && r.setCookie ? r.setCookie.split(";")[0] : null;
}
