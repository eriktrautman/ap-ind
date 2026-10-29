// What happens when something upstream is lost. Nothing a producer published or any result already fetched may
// disappear: a poll that cannot reach AP keeps the last good files and says so; a standby laptop that cannot reach
// the deployment keeps serving its copy, and promoting it makes it production from that copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { get, post, signIn, PASSWORDS, INDEX } from "./helpers.mjs";

const DEAD = "http://127.0.0.1:9";   // discard port: nothing answers, the connection is refused at once
const seed = () => {
  const store = mkdtempSync(join(tmpdir(), "ep-failover-"));
  mkdirSync(join(store, "state"));
  writeFileSync(join(store, "index.json"), JSON.stringify(INDEX));
  writeFileSync(join(store, "status.json"), JSON.stringify({ generated: "2026-11-03T23:00:00Z", lastApSuccess: "2026-11-03T23:00:00Z", apTimestamp: "x", consecutiveFailures: 0, ok: true, resultsType: "t", countyFreshness: { NE: "2026-11-03T22:50:00Z" } }));
  writeFileSync(join(store, "state", "NE.json"), JSON.stringify({ state: "NE", races: [] }));
  writeFileSync(join(store, "producer.json"), JSON.stringify({ pinnedRaceIds: ["90001"], idleText: "Published before the outage", manualItems: [], callHighlight: true, screenA: { chart: "B14", race: "NE-SEN", state: "", params: {}, bg: "black" } }));
  writeFileSync(join(store, "settings.json"), JSON.stringify({ resultsType: "t", pollEnabled: true }));
  return store;
};
const read = (store, f) => JSON.parse(readFileSync(join(store, f), "utf8"));

test("a poll that cannot reach AP keeps every result file as it was and records the failure in the status", async () => {
  const store = seed();
  const saved = { STORE_DIR: process.env.STORE_DIR, AP_API_BASE: process.env.AP_API_BASE, AP_API_KEY: process.env.AP_API_KEY };
  Object.assign(process.env, { STORE_DIR: store, AP_API_BASE: DEAD, AP_API_KEY: "unused-in-tests" });
  try {
    const { pollOnce } = await import("../lib/poll.js");
    const status = await pollOnce({ log: () => {} });
    assert.equal(status.ok, false);
    assert.equal(status.consecutiveFailures, 1);
    assert.ok(status.lastError?.text, "the failure is described");
    assert.equal(status.lastApSuccess, "2026-11-03T23:00:00Z", "the last good time is kept, not reset");
    assert.deepEqual(read(store, "index.json"), INDEX, "the race index is untouched");
    assert.equal(read(store, "state/NE.json").state, "NE", "the county file is untouched");
    assert.equal(read(store, "producer.json").idleText, "Published before the outage", "the published state is untouched");
    assert.equal(read(store, "status.json").consecutiveFailures, 1, "the status on disk says so too");
    writeFileSync(join(store, "settings.json"), JSON.stringify({ resultsType: "t", pollEnabled: false }));
    const paused = await pollOnce({ log: () => {} });
    assert.equal(paused.paused, true, "paused: nothing fetched, nothing lost");
    assert.deepEqual(read(store, "index.json"), INDEX);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(store, { recursive: true, force: true });
  }
});

test("a standby laptop that cannot reach the deployment keeps serving its copy, and Promote makes it production from that copy", async () => {
  const store = seed();
  const port = 4800 + Math.floor(Math.random() * 500);
  const env = { ...process.env, GLOBAL: DEAD, STORE_DIR: store, AP_API_BASE: DEAD, AP_API_KEY: "unused-in-tests", AP_RESULTS_TYPE: "t", MIRROR_SECONDS: "1", POLL_SECONDS: "3600", STUDIO_PASSWORD_PRODUCER_TEST_PRODUCER: PASSWORDS.producer };
  delete env.STUDIO_PASSWORD; delete env.GLOBAL_PASSWORD; delete env.BLOB_READ_WRITE_TOKEN;
  const child = spawn(process.execPath, [new URL("../scripts/serve.mjs", import.meta.url).pathname, "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(`server exited: ${log}`); try { if ((await fetch(`${base}/api/login`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 1200));   // a mirror pass has tried and failed by now
    const rt = (await get(`${base}/api/runtime`)).json;
    assert.deepEqual([rt.standby, rt.mode, rt.deployment?.reachable, rt.production?.where, rt.canPromote], [true, "mirror", false, "deployment", true]);
    assert.ok(rt.mirror?.lastError, "the failed copy is reported");
    assert.deepEqual((await get(`${base}/data/index.json?t=${Date.now()}`)).json.races.map((r) => r.label), ["NE-SEN", "MT-SEN"], "results still served from the copy");
    assert.equal((await get(`${base}/ticker`)).status, 200);
    assert.equal((await get(`${base}/data/producer.json`)).status, 502, "the published state lives on the deployment until Promote");
    const cookie = await signIn(base, PASSWORDS.producer);
    assert.ok(cookie, "a producer signs in on the laptop");
    assert.equal((await post(`${base}/api/promote`, {})).status, 401, "Promote needs a producer");
    const promoted = await post(`${base}/api/promote`, {}, { cookie });
    assert.equal(promoted.status, 200); assert.equal(promoted.json.production, "self");
    await new Promise((r) => setTimeout(r, 800));   // the first poll of the new production runs now and fails against the dead AP
    const rt2 = (await get(`${base}/api/runtime`)).json;
    assert.deepEqual([rt2.mode, rt2.polling, rt2.production?.where], ["poll", true, "self"]);
    const pub = (await get(`${base}/data/producer.json?t=${Date.now()}`)).json;
    assert.equal(pub.idleText, "Published before the outage", "the published state served from the copy");
    assert.equal(pub.screenA.chart, "B14");
    assert.deepEqual((await get(`${base}/data/index.json?t=${Date.now()}`)).json.races.map((r) => r.id), ["90001", "90002"], "the failed poll did not touch the results");
    assert.equal(read(store, "index.json").races.length, 2);
    const st = (await get(`${base}/data/status.json?t=${Date.now()}`)).json;
    assert.equal(st.lastApSuccess, "2026-11-03T23:00:00Z");
  } finally { child.kill(); rmSync(store, { recursive: true, force: true }); }
});
