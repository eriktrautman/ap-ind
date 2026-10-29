// With no server: what has to be true of the code for the routes to work at all. The chart registry and its
// pages, the cookie, the ticker's crawl text, and the deployment configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CHARTS, chartForPage, canonicalAddress, screenAddress } from "../lib/control.js";
import { matchPassword, issueCookie, cookieAccount } from "../lib/auth.js";
import { studioGate } from "../proxy.js";
import { buildQueue } from "../public/ticker-queue.js";

const ROOT = new URL("../", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url).pathname;

test("every chart id is unique and every built chart's page is in the repo, so the catalog and the router can serve it", () => {
  const ids = CHARTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate chart id");
  for (const id of ids) assert.match(id, /^[A-Z]\d{1,2}$/);
  for (const c of CHARTS.filter((c) => c.built && c.page?.startsWith("/g/"))) {
    assert.ok(existsSync(`${REPO}public/g/${c.page.split("?")[0].replace(/^\/g\//, "")}`), `${c.id} ${c.page} is missing`);
  }
  const c = CHARTS.find((x) => x.built && x.page?.startsWith("/g/") && !x.page.includes("?"));
  assert.equal(chartForPage(c.page)?.id, c.id);
  assert.equal(canonicalAddress(c.page, "?race=NE-SEN&bg=black"), `/g/${c.id}?race=NE-SEN&bg=black`);
  assert.equal(screenAddress({ chart: "B14", race: "NE-SEN" }, { bg: "black" }), "/g/B14?bg=black&race=NE-SEN");
});

test("a sign-in cookie opens the Studio for its account only, and dies when tampered, expired, or the password changes", () => {
  const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^STUDIO_/.test(k)));
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.STUDIO_PASSWORD_PRODUCER_TEST_PERSON = "secret";
  try {
    assert.equal(matchPassword("nope"), null);
    const a = matchPassword("secret");
    assert.deepEqual([a.name, a.role], ["Test Person", "producer"]);
    const cookie = issueCookie({ headers: {} }, a).split(";")[0];
    assert.equal(cookieAccount(`other=1; ${cookie}`)?.name, "Test Person");
    assert.equal(studioGate("/studio", cookie), false, "the gate opens for it");
    for (const p of ["/studio", "/studio/studio.js", "/studio/cards.js"]) assert.equal(studioGate(p, ""), true, `${p} is held without it`);
    for (const p of ["/studio/login", "/studio/studio.css", "/ticker", "/g/B5", "/"]) assert.equal(studioGate(p, ""), false, `${p} is open`);
    assert.equal(cookieAccount(cookie.slice(0, -1) + "x"), null, "tampered");
    const [, key, sig] = cookie.split("=")[1].split(".");
    assert.equal(cookieAccount(`studio=${Date.now() - 1000}.${key}.${sig}`), null, "expired");
    process.env.STUDIO_PASSWORD_PRODUCER_TEST_PERSON = "changed";
    assert.equal(cookieAccount(cookie), null, "password changed");
  } finally { delete process.env.STUDIO_PASSWORD_PRODUCER_TEST_PERSON; Object.assign(process.env, saved); }
});

test("the ticker crawl: idle line before data, pinned races in order with calls highlighted, manual items after every two races", () => {
  const races = [
    { id: "1", label: "NE-SEN", featured: true, totalVotes: 10, precinctsPct: 5, eevp: 5, candidates: [{ last: "Osborn", independent: true, pct: 51 }, { last: "Ricketts", party: "GOP", pct: 49 }] },
    { id: "2", label: "MT-SEN", called: true, totalVotes: 10, precinctsPct: 100, candidates: [{ last: "Winner", party: "Dem", pct: 60, winner: true }, { last: "Loser", party: "GOP", pct: 40 }] },
  ];
  assert.deepEqual(buildQueue([], { idleText: "Welcome" }).items.map((i) => [i.kind, i.text]), [["idle", "Welcome"]]);
  const q = buildQueue(races, { pinnedRaceIds: ["2", "1", "404"], manualItems: [{ id: "m", text: "Polls close at 7" }], callHighlight: true });
  assert.deepEqual(q.items.map((i) => i.key), ["race:2", "race:1", "manual:m"]);
  assert.deepEqual(q.missing, ["404"]);
  assert.match(q.items[0].text, /MT-SEN · Winner \(D\) 60\.0% · Loser \(R\) 40\.0% · AP CALL ✓ Winner \(D\)/);
  assert.equal(q.items[0].emphasis, true);
  assert.equal(buildQueue(races, { pinnedRaceIds: ["2"], callHighlight: false }).items[0].emphasis, false);
  assert.equal(buildQueue(races, {}).source, "default");
});

test("vercel.json wires the Studio gate, the chart router, the data files and the poll cron, and the build ships what the pages import", () => {
  const v = JSON.parse(readFileSync(`${ROOT}vercel.json`, "utf8"));
  assert.ok(existsSync(ROOT + v.proxy.entrypoint), "proxy entrypoint file");
  assert.ok(v.proxy.matcher.some((m) => m.startsWith("/studio")));
  assert.ok(v.rewrites.some((r) => r.source === "/g/:chart" && r.destination === "/g/chart"));
  assert.ok(v.rewrites.some((r) => r.source === "/data/:path*"));
  assert.ok(v.crons.some((c) => c.path === "/api/poll"));
  assert.ok(v.headers.some((h) => h.source.startsWith("/studio") && h.headers.some((x) => x.value === "no-store")));
  if (!existsSync(`${ROOT}dist`)) return;   // npm test builds first; test:unit need not
  assert.equal(readFileSync(`${ROOT}dist/g/control.js`, "utf8"), readFileSync(`${ROOT}lib/control.js`, "utf8"), "dist/g/control.js is lib/control.js");
  for (const f of ["studio/login.html", "studio/index.html", "g/chart.html", "g/polls.json", "g/candidates.json", "ticker.html", "live-screen-one.html"]) assert.ok(existsSync(`${ROOT}dist/${f}`), f);
});
