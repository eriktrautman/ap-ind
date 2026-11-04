// With no server: what has to be true of the code for the routes to work at all. The chart registry and its
// pages, the cookie, the ticker's crawl text, and the deployment configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CHARTS, chartForPage, canonicalAddress, screenAddress, hideSmallWriteIns, tickerMinInOf, defaultCompareYear, normalize, normalizePlaylists, seedPlaylists, ZONE_BUNDLES, DEFAULTS, mergeIntoLibrary, airingBundles, MAX_BUNDLES } from "../lib/control.js";
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
    for (const p of ["/studio", "/studio/studio.js", "/studio/cards.js", "/analytics", "/analytics/county-card", "/analytics/baseline/races.json"]) assert.equal(studioGate(p, ""), true, `${p} is held without it`);
    assert.equal(studioGate("/analytics", cookie), false, "Analytics opens for it too");
    for (const p of ["/studio/login", "/studio/studio.css", "/ticker", "/g/B5", "/"]) assert.equal(studioGate(p, ""), false, `${p} is open`);
    assert.equal(cookieAccount(cookie.slice(0, -1) + "x"), null, "tampered");
    const [, key, sig] = cookie.split("=")[1].split(".");
    assert.equal(cookieAccount(`studio=${Date.now() - 1000}.${key}.${sig}`), null, "expired");
    process.env.STUDIO_PASSWORD_PRODUCER_TEST_PERSON = "changed";
    assert.equal(cookieAccount(cookie), null, "password changed");
  } finally { delete process.env.STUDIO_PASSWORD_PRODUCER_TEST_PERSON; Object.assign(process.env, saved); }
});

test("the ticker crawl: idle line before data, the crawl order with bundles expanded and calls highlighted, and an older state's races and items", () => {
  const races = [
    { id: "1", label: "NE-SEN", featured: true, totalVotes: 10, precinctsPct: 5, eevp: 5, candidates: [{ last: "Osborn", independent: true, pct: 51 }, { last: "Ricketts", party: "GOP", pct: 49 }] },
    { id: "2", label: "MT-SEN", called: true, totalVotes: 10, precinctsPct: 100, candidates: [{ last: "Winner", party: "Dem", pct: 60, winner: true }, { last: "Loser", party: "GOP", pct: 40 }] },
  ];
  assert.deepEqual(buildQueue([], { idleText: "Welcome" }).items.map((i) => [i.kind, i.text]), [["idle", "Welcome"]]);
  // An older state (races in order, a manual item after every two) still crawls the same way.
  const q = buildQueue(races, { pinnedRaceIds: ["2", "1", "404"], manualItems: [{ id: "m", text: "Polls close at 7" }], callHighlight: true });
  assert.deepEqual(q.items.map((i) => [i.kind, i.text.split(" · ")[0]]), [["race", "MT-SEN"], ["race", "NE-SEN"], ["manual", "Polls close at 7"]]);
  assert.deepEqual(q.missing, ["404"]);
  assert.match(q.items[0].text, /MT-SEN · Winner \(D\) 60\.0% · Loser \(R\) 40\.0% · AP CALL ✓ Winner \(D\)/);
  assert.equal(q.items[0].emphasis, true);
  assert.equal(buildQueue(races, { pinnedRaceIds: ["2"], callHighlight: false }).items[0].emphasis, false);
  assert.equal(buildQueue(races, {}).source, "default");
  // Only races with results: a race waits for votes and the threshold, a called race stays once it has votes, text always crawls.
  const counting = [{ id: "a", label: "A", totalVotes: 0, eevp: 0, candidates: [] }, { id: "b", label: "B", totalVotes: 9, eevp: 10, candidates: [] }, { id: "c", label: "C", totalVotes: 9, eevp: 30, candidates: [] }, { id: "d", label: "D", totalVotes: 9, eevp: 2, called: true, candidates: [{ last: "W", winner: true }] }];
  const crawl = (tickerMinIn) => buildQueue(counting, { tickerMinIn, tickerItems: [...counting.map((r) => ({ t: "race", id: r.id })), { t: "text", id: "t", text: "Note" }] }).items.map((i) => i.text.split(" · ")[0]);
  assert.deepEqual(crawl(null), ["A", "B", "C", "D", "Note"]);
  assert.deepEqual(crawl(0), ["B", "C", "D", "Note"]);
  assert.deepEqual(crawl(20), ["C", "D", "Note"]);
  assert.deepEqual([undefined, "", "x", "20", 150, -3].map(tickerMinInOf), [null, null, null, 20, 100, 0]);
  assert.equal(normalize({}).tickerMinIn, null);
  assert.equal(normalize({ tickerMinIn: 25 }).tickerMinIn, 25);
  assert.deepEqual([["2024", "2020", "2018", "2014"], ["2024", "2022", "2020"], ["2024", "2020"], []].map(defaultCompareYear), ["2018", "2022", "2024", ""], "B17: the latest midterm on file, else the latest year");
  // A write-in appears only over 1%, or as the winner; a race is never left with nobody.
  const wi = (name, pct, winner = false) => ({ name, pct, winner });
  assert.deepEqual(hideSmallWriteIns([wi("A", 50), wi("B (write-in)", 1), wi("C (write-in)", 1.1), wi("D Write-in", 0, true), wi("E", 0)]).map((c) => c.name), ["A", "C (write-in)", "D Write-in", "E"]);
  assert.deepEqual(hideSmallWriteIns([wi("F (write-in)", 0)]).map((c) => c.name), ["F (write-in)"]);
  // The crawl order: races, text and bundles in the producer's order; a bundle expands in place, each time it is placed.
  const st = normalize({ tickerItems: [{ t: "text", id: "a", text: "Welcome" }, { t: "bundle", id: "neb" }, { t: "race", id: "2" }, { t: "bundle", id: "neb" }], bundles: [{ id: "neb", name: "Nebraska", items: [{ t: "race", id: "1" }, { t: "text", id: "b", text: "Osborn watch" }] }] });
  assert.deepEqual(buildQueue(races, st).items.map((i) => i.text.split(" · ")[0]), ["Welcome", "NE-SEN", "Osborn watch", "MT-SEN", "NE-SEN", "Osborn watch"]);
  assert.deepEqual(st.pinnedRaceIds, ["1", "2"], "the races in crawl order, derived for everything that reads the old field");
  assert.deepEqual(st.manualItems.map((m) => m.text), ["Welcome", "Osborn watch", "Osborn watch"]);
  const fallback = normalize({ tickerItems: [{ t: "bundle", id: "gone" }] });
  assert.deepEqual(fallback.tickerItems, [{ t: "bundle", id: "slate" }], "a crawl with nothing left in it falls back to the Slate bundle");
  assert.deepEqual(fallback.bundles[0].items.filter((it) => it.t === "race").map((it) => it.id), fallback.pinnedRaceIds, "which holds the slate's races");
});

test("vercel.json wires the Studio gate, the chart router, the data files and the poll cron, and the build ships what the pages import", () => {
  const v = JSON.parse(readFileSync(`${ROOT}vercel.json`, "utf8"));
  assert.ok(existsSync(ROOT + v.proxy.entrypoint), "proxy entrypoint file");
  assert.ok(v.proxy.matcher.some((m) => m.startsWith("/studio"))); assert.ok(v.proxy.matcher.includes("/analytics") && v.proxy.matcher.includes("/analytics/:path*"), "Analytics is behind the same gate");
  assert.ok(v.rewrites.some((r) => r.source === "/g/:chart" && r.destination === "/g/chart"));
  assert.ok(v.rewrites.some((r) => r.source === "/data/:path*"));
  const pub = v.rewrites.findIndex((r) => r.source === "/data/producer.json" && r.destination === "/api/published");   // readers get the fresh copy, before the blob rule
  assert.ok(pub >= 0 && pub < v.rewrites.findIndex((r) => r.source === "/data/:path*"), "the published state is read through its function, ahead of the blob rewrite");
  assert.ok(v.crons.some((c) => c.path === "/api/poll"));
  assert.ok(v.headers.some((h) => h.source.includes("studio") && h.source.includes("analytics") && h.headers.some((x) => x.value === "no-store")));
  if (!existsSync(`${ROOT}dist`)) return;   // npm test builds first; test:unit need not
  assert.equal(readFileSync(`${ROOT}dist/g/control.js`, "utf8"), readFileSync(`${ROOT}lib/control.js`, "utf8"), "dist/g/control.js is lib/control.js");
  for (const f of ["analytics/index.html", "analytics/county-card.html", "analytics/surprise.js", "analytics/baseline/races.json", "studio/login.html", "studio/index.html", "g/chart.html", "g/polls.json", "g/candidates.json", "ticker.html", "live-screen-one.html"]) assert.ok(existsSync(`${ROOT}dist/${f}`), f);
});

test("stored playlists from before General gain it once, keep what they had, and a producer's removal sticks", () => {
  const old = normalizePlaylists({ users: [{ id: "ryan", name: "Ryan", playlists: [{ id: "seg", name: "Segment Test", items: [{ chart: "B5", race: "NE-SEN" }] }] }] });
  const seeded = seedPlaylists(old);
  assert.deepEqual(seeded.users.map((u) => u.name), ["General", "Ryan"]);
  assert.equal(seeded.users[1].playlists[0].items.length, 1, "what was stored is untouched");
  const removed = normalizePlaylists({ users: seeded.users.slice(1), generalSeeded: true });
  assert.deepEqual(seedPlaylists(removed).users.map((u) => u.name), ["Ryan"], "General does not come back");
  const ryanDoc = (flag) => normalizePlaylists({ generalSeeded: true, ryanB16Seeded: flag, users: [{ id: "ryan", name: "Ryan", playlists: [{ id: "a", name: "A", items: [{ chart: "B5", race: "NE-SEN" }, { chart: "B8", race: "NE-SEN" }] }] }, { id: "bob", name: "Bob", playlists: [{ id: "a", name: "A", items: [{ chart: "B5", race: "NE-SEN" }] }] }] });
  const charts = (d) => d.users.map((u) => u.playlists[0].items.map((i) => i.chart));
  assert.deepEqual(charts(seedPlaylists(ryanDoc(false))), [["B16", "B8"], ["B5"]], "only Ryan's B5s become B16s");
  assert.deepEqual(charts(seedPlaylists(ryanDoc(true))), [["B5", "B8"], ["B5"]], "and only once");
});

test("the shipped zone bundles survive validation whole, and a published crawl carries its own copy of each bundle it uses", () => {
  const races = ZONE_BUNDLES.flatMap((c) => c.items.filter((i) => i.t === "race").map((i) => i.id));
  assert.equal(new Set(races).size, races.length, "no race is in two zones");
  const st = normalize({ ...DEFAULTS, tickerItems: ZONE_BUNDLES.map((c) => ({ t: "bundle", id: c.id })) });
  assert.deepEqual(st.bundles.filter((c) => c.id !== "slate"), [...ZONE_BUNDLES], "nothing is trimmed");
  assert.equal(st.tickerItems.length, ZONE_BUNDLES.length, "every bundle stays in the crawl");
  const old = normalize({ chunks: [{ id: "abc", name: "Old", items: [{ t: "race", id: "1" }] }], tickerItems: [{ t: "chunk", id: "abc" }] });
  assert.deepEqual(old.tickerItems, [{ t: "bundle", id: "abc" }], "a state saved under the old name still reads");
  assert.equal(old.bundles.find((b) => b.id === "abc").name, "Old");
  assert.equal("chunks" in old, false);
});

test("A browser's old bundles join the library without losing work; only bundles in the crawl count as airing", () => {
  const b = (id, name, n = 1) => ({ id, name, items: Array.from({ length: n }, (_, i) => ({ t: "race", id: String(i) })) });
  const shipped = structuredClone(ZONE_BUNDLES[0]);
  const { bundles, copies, over } = mergeIntoLibrary([b("onlylive", "Live"), b("both", "Both"), b("same", "Same"), { ...shipped, name: "Changed live" }], [b("mine", "Mine"), b("both", "Both", 2), b("same", "Same"), shipped], () => "newid");
  assert.deepEqual(bundles.map((x) => x.id), ["onlylive", "both", "same", shipped.id, "mine", "newid"], "an unedited shipped copy is not kept as a copy");
  assert.equal(bundles.find((x) => x.id === "both").items.length, 1, "the live version wins");
  assert.equal(bundles.find((x) => x.id === "newid").items.length, 2, "the edited one survives");
  assert.deepEqual(copies, ["Both (my copy)"]);
  assert.equal(over, false);
  assert.equal(mergeIntoLibrary([], Array.from({ length: MAX_BUNDLES + 1 }, (_, i) => b(`b${i}`, "x")), () => "n").over, true);
  assert.deepEqual(airingBundles({ tickerItems: [{ t: "bundle", id: "a" }, { t: "race", id: "b" }], bundles: [b("a", "A"), b("b", "B")] }).map((x) => x.id), ["a"]);
});
