// The routes a producer uses on the night, over HTTP: the public outputs, the data files, signing in, publishing
// the ticker and a live screen, and the roles. Against SMOKE_URL (a deployment; read-only unless SMOKE_PASSWORD
// is set, and never a write) or a local server started by helpers.mjs from dist/ with its own files and passwords.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server, get, post, put, signIn, PASSWORDS } from "./helpers.mjs";

let S;
before(async () => { S = await server(); });
after(() => S?.stop());
const url = (p) => `${S.base}${p}`;
const localOnly = (t) => { if (!S.local) { t.skip("local server only: never writes a deployment"); return true; } return false; };

// ---- public outputs ----
test("the landing page, the ticker and both live screens are up and public", async () => {
  const home = await get(url("/"));
  assert.equal(home.status, 200); assert.match(home.text, /Election Producer/);
  const t = await get(url("/ticker"));
  assert.equal(t.status, 200); assert.match(t.text, /ticker-queue\.js/); assert.match(t.text, /id="track"/);
  for (const p of ["/live-screen-one", "/live-screen-two"]) { const r = await get(url(p)); assert.equal(r.status, 200, p); assert.match(r.text, /live-screen\.js/); }
});
test("a chart is served by id, by page, and with its config and control module beside it", async () => {
  const byId = await get(url("/g/B14?race=NE-SEN"));
  assert.equal(byId.status, 200); assert.match(byId.text, /id="err"/, "the router page");
  const page = await get(url("/g/head-to-head"));   // the clean address: a deployment answers the .html one with a 308 to it
  assert.equal(page.status, 200); assert.match(page.text, /<html/i);
  const ctl = await get(url("/g/control.js"));
  assert.equal(ctl.status, 200); assert.match(ctl.text, /export const CHARTS/);
  const cfg = await get(url("/g/candidates.json"));
  assert.equal(cfg.status, 200); assert.ok(cfg.json && typeof cfg.json === "object");
});

// ---- data ----
test("the race index, the poller status and the published state are served as JSON", async () => {
  const idx = await get(url(`/data/index.json?t=${Date.now()}`));
  assert.equal(idx.status, 200); assert.ok(Array.isArray(idx.json?.races) && idx.json.races.length > 0, "races");
  assert.ok(["t", "l"].includes(idx.json.resultsType), "resultsType");
  const st = await get(url(`/data/status.json?t=${Date.now()}`));
  assert.equal(st.status, 200); assert.ok(st.json && "lastApSuccess" in st.json, "status has lastApSuccess");
  const pub = await get(url(`/data/producer.json?t=${Date.now()}`));
  assert.equal(pub.status, 200); assert.ok(Array.isArray(pub.json?.pinnedRaceIds), "pinnedRaceIds");
  const settings = await get(url("/api/settings"));
  assert.equal(settings.status, 200); assert.ok("resultsType" in settings.json && "pollEnabled" in settings.json);
});

// ---- signing in ----
test("signed out: the Studio is not served, the sign-in page is, a wrong password is refused, every write is 401", async () => {
  for (const p of ["/studio", "/studio/studio.js", "/studio/cards.js"]) {
    const r = await get(url(p));
    assert.equal(r.status, 302, p); assert.match(r.location ?? "", /\/studio\/login$/, p);
    assert.ok(!r.text.includes("PRODUCER ACTIONS"), `${p} leaked the page`);
  }
  const login = await get(url("/studio/login"));
  assert.equal(login.status, 200); assert.match(login.text, /id="loginform"/);
  assert.equal((await get(url("/studio/studio.css"))).status, 200);
  const me = await get(url("/api/login"));
  assert.equal(me.status, 200); assert.equal(me.json.authed, false); assert.equal(me.json.configured, true);
  const bad = await post(url("/api/login"), { password: "definitely-not-it" });
  assert.equal(bad.status, 403); assert.equal(bad.setCookie, null);
  assert.equal((await put(url("/api/producer"), { idleText: "x" })).status, 401);
  assert.equal((await put(url("/api/settings"), { resultsType: "t" })).status, 401);
  assert.equal((await post(url("/api/poll"), {})).status, 401);
});
test("signed in: a good password sets a cookie that opens the Studio and names the person; sign-out clears it", async (t) => {
  if (!S.password) return t.skip("set SMOKE_PASSWORD to sign in on a deployment");
  const cookie = await signIn(S.base, S.password);
  assert.ok(cookie, "sign-in failed");
  const me = await get(url("/api/login"), { headers: { cookie } });
  assert.equal(me.json.authed, true); assert.ok(me.json.name && me.json.role, "name and role");
  assert.ok(Array.isArray(me.json.accounts) && me.json.accounts.length, "who is on the site");
  const page = await get(url("/studio"), { headers: { cookie } });
  assert.equal(page.status, 200); assert.match(page.text, /PRODUCER ACTIONS/);
  assert.equal((await get(url("/studio/studio.js"), { headers: { cookie } })).status, 200);
  const out = await get(url("/api/login"), { method: "DELETE", headers: { cookie } });
  assert.match(out.setCookie ?? "", /Max-Age=0/);
  assert.equal((await get(url("/studio"), { headers: { cookie: "studio=1.x.forged" } })).status, 302, "a forged cookie is held at the door");
});
test("the roles hold: read-only cannot publish, a publisher cannot touch the poller, a producer can do both", async (t) => {
  if (localOnly(t)) return;
  const reader = await signIn(S.base, PASSWORDS.readonly), publisher = await signIn(S.base, PASSWORDS.publisher), producer = await signIn(S.base, PASSWORDS.producer);
  assert.ok(reader && publisher && producer, "all three sign in");
  assert.equal((await put(url("/api/producer"), { idleText: "no" }, { cookie: reader })).status, 403);
  assert.equal((await put(url("/api/settings"), { resultsType: "t" }, { cookie: publisher })).status, 403);
  assert.equal((await put(url("/api/producer"), { idleText: "yes" }, { cookie: publisher })).status, 200);
  assert.equal((await put(url("/api/settings"), { resultsType: "t", pollEnabled: true }, { cookie: producer })).status, 200);
});
test("the rehearsal password works on Test results and is shut out, cookies included, the moment results go Live", async (t) => {
  if (localOnly(t)) return;
  const producer = await signIn(S.base, PASSWORDS.producer);
  const rehearsal = await signIn(S.base, PASSWORDS.rehearsal);
  assert.ok(rehearsal, "rehearsal signs in while results are Test");
  assert.equal((await get(url("/api/login"), { headers: { cookie: rehearsal } })).json.testLogin, true);
  assert.equal((await put(url("/api/settings"), { resultsType: "l", pollEnabled: true }, { cookie: producer })).status, 200);
  try {
    assert.equal((await post(url("/api/login"), { password: PASSWORDS.rehearsal })).status, 403, "refused at Live");
    assert.equal((await get(url("/api/login"), { headers: { cookie: rehearsal } })).json.authed, false, "the old cookie no longer signs in");
    assert.equal((await get(url("/api/login"), { headers: { cookie: producer } })).json.authed, true, "named passwords are untouched");
  } finally { await put(url("/api/settings"), { resultsType: "t", pollEnabled: true }, { cookie: producer }); }
  assert.ok(await signIn(S.base, PASSWORDS.rehearsal), "back on Test, rehearsal signs in again");
});

// ---- publishing ----
test("publishing the ticker: the published state the ticker reads changes, stamped with the publisher's name, and the fields left out keep their values", async (t) => {
  if (localOnly(t)) return;
  const cookie = await signIn(S.base, PASSWORDS.publisher);
  const before = (await get(url("/api/producer"))).json;
  const text = `Published by the test at ${Date.now()}`;
  const r = await put(url("/api/producer"), { idleText: text, manualItems: [{ id: "t1", text: "Polls close at 7" }], tickerBg: "green" }, { cookie });
  assert.equal(r.status, 200); assert.equal(r.json.idleText, text); assert.equal(r.json.updatedBy, "Test Publisher"); assert.ok(r.json.updatedAt);
  const live = (await get(url(`/data/producer.json?t=${Date.now()}`))).json;
  assert.equal(live.idleText, text); assert.equal(live.tickerBg, "green");
  assert.deepEqual(live.manualItems.map((m) => m.text), ["Polls close at 7"]);
  assert.deepEqual(live.pinnedRaceIds, before.pinnedRaceIds, "the ticker races were not in the publish and did not change");
  assert.deepEqual(live.screenA, before.screenA, "nor was the live screen");
  const pull = (await get(url("/api/producer"))).json;
  assert.equal(pull.idleText, text, "Pull sees the same");
});
test("publishing a live screen: screen one shows the new chart at an address the router serves, screen two is untouched, and a bad publish is cleaned up", async (t) => {
  if (localOnly(t)) return;
  const cookie = await signIn(S.base, PASSWORDS.producer);
  const before = (await get(url("/api/producer"))).json;
  const r = await put(url("/api/producer"), { screenA: { chart: "B14", race: "NE-SEN", state: "", params: { a: "Osborn" }, bg: "green" } }, { cookie });
  assert.equal(r.status, 200);
  const live = (await get(url(`/data/producer.json?t=${Date.now()}`))).json;
  assert.deepEqual([live.screenA.chart, live.screenA.race, live.screenA.params.a, live.screenA.bg], ["B14", "NE-SEN", "Osborn", "green"]);
  assert.deepEqual(live.screenB, before.screenB, "screen two unchanged");
  const { screenAddress } = await import("../lib/control.js");
  const addr = screenAddress(live.screenA, { bg: live.screenA.bg });
  assert.equal(addr, "/g/B14?bg=green&race=NE-SEN&a=Osborn");
  assert.equal((await get(url(addr))).status, 200, "the address the live screen will load");
  const junk = await put(url("/api/producer"), { screenA: { chart: "nope", race: 5, params: "x" } }, { cookie });
  assert.equal(junk.status, 200);
  assert.equal(junk.json.screenA.chart, before.screenA.chart, "an unknown chart id falls back to the default screen");
});
