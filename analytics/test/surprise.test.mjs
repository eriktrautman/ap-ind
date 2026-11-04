import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRace, projectRace, summarize, byState, fmtMargin, sides, flipOf, pickBellwethers } from "../../studio/public/analytics/surprise.js";

const cand = (last, party, votes, extra = {}) => ({ id: last, last, party, votes, winner: false, ...extra });
const race = (cands, extra = {}) => ({ label: "XX-1", id: "1", state: "XX", candidates: cands, totalVotes: cands.reduce((s, c) => s + c.votes, 0), eevp: 95, precinctsPct: 95, called: false, ...extra });
const base = (margin, cookSide = null, extra = {}) => ({ office: "Senate", cook: cookSide ? `Likely ${cookSide}` : "Toss Up", cookSide, pres2024: { marginRD: 0 }, model: { margin, p10: margin - 8, p90: margin + 8, dem: "Dee", gop: "Arr" }, ...extra });
const unit = (name, d, r, eevp = 99, precinctsPct = 99) => ({ name, eevp, precinctsPct, votes: { Dee: d, Arr: r } });
const past = (o) => (n) => o[n];

test("margins are R minus D, and the gap is how much better the Republican did than forecast", () => {
  const s = scoreRace(race([cand("Dee", "Dem", 40), cand("Arr", "GOP", 60)]), base(-4));
  assert.equal(Math.round(s.now), 20); assert.equal(Math.round(s.gap), 24); assert.equal(s.status, "scored"); assert.equal(s.basis, "count");
});
test("a called race against Cook's favorite is an upset; before a call, with nearly all in, the favorite is behind", () => {
  const called = scoreRace(race([cand("Dee", "Dem", 52, { winner: true }), cand("Arr", "GOP", 48)], { called: true }), base(6, "R"));
  assert.equal(called.flags[0].k, "upset"); assert.equal(called.severity, 3);
  const open = scoreRace(race([cand("Dee", "Dem", 52), cand("Arr", "GOP", 48)]), base(6, "R"));
  assert.equal(open.flags[0].k, "behind"); assert.equal(open.severity, 2);
});
test("a blowout that stays a blowout isn't a surprise, but one that gets close or flips is", () => {
  const score = (d, r, E, cook = null, extra = {}) => scoreRace(race([cand("Dee", "Dem", d), cand("Arr", "GOP", r)], extra), base(E, cook));
  const moved = score(40.5, 59.5, 26, "R");   // R+26 forecast, R+19 now
  assert.equal(moved.safe, true); assert.equal(moved.severity, 0); assert.equal(moved.flags.length, 0);
  assert.equal(summarize([moved]).surprises, 0); assert.equal(summarize([moved]).safeShifts, 1); assert.equal(summarize([moved]).meanAbsGap, null);
  assert.equal(summarize([moved]).medianGap < 0, true, "it still counts toward the national lean"); assert.equal(byState([moved]).get("XX").gap, null);
  const close = score(46, 54, 26, "R");       // R+26 forecast, R+8 now: now it's in play
  assert.equal(close.safe, false); assert.ok(close.severity >= 2);
  const flipped = score(52, 48, 26, "R");     // the other side is ahead
  assert.equal(flipped.safe, false); assert.equal(flipped.flags[0].k, "behind");
  const early = score(30, 70, 26, "R", { eevp: 50, precinctsPct: 50 });   // R+40 at half in: no early signal either
  assert.equal(early.flags.length, 0); assert.equal(early.safe, true);
  const near = score(48, 52, -4), far = score(39, 61, 14);   // both 8 points from forecast
  assert.equal(near.severity, far.severity); assert.ok(near.score > far.score, "same size of miss, the closer race ranks higher");
});
test("each state counts its surprises by side, kept apart from the ones AP has called", () => {
  const mk = (d, r, E, cook, extra) => ({ ...scoreRace(race([cand("Dee", "Dem", d, { winner: !!extra?.dWins }), cand("Arr", "GOP", r, { winner: !!extra?.rWins })], { called: !!(extra?.dWins || extra?.rWins), eevp: extra?.eevp ?? 95 }), base(E, cook)) });
  const st = byState([mk(52, 48, 6, "R"), mk(52, 48, 6, "R", { dWins: true }), mk(55, 45, -6, "D"), mk(55, 45, -6, "D", { rWins: true, eevp: 5 })]).get("XX");
  assert.deepEqual([st.cookD, st.calledD, st.cookR, st.calledR], [1, 1, 0, 1], "an early call against the favorite counts for its winner, whatever the margin");
  assert.equal(st.surprises, 3);
  const sum = summarize([mk(52, 48, 6, "R"), mk(52, 48, 6, "R", { dWins: true }), mk(45, 55, -6, "D")]);
  assert.deepEqual([sum.surprises, sum.called, sum.comingIn], [3, 1, 2]);
});
test("a seat changing hands: called, likely, or only ahead so far", () => {
  const r = (d, r2, extra = {}) => race([cand("Dee", "Dem", d, { winner: !!extra.dWins }), cand("Arr", "GOP", r2, { winner: !!extra.rWins })], { currentParty: "GOP", called: !!(extra.dWins || extra.rWins), eevp: extra.eevp ?? 95, precinctsPct: extra.prec ?? extra.eevp ?? 95 });
  const f = (x, b = base(1)) => flipOf(x, b, scoreRace(x, b));
  assert.deepEqual(f(r(55, 45, { dWins: true })), { stage: "called", from: "R", to: "D", name: "Dee" });
  assert.equal(f(r(45, 55, { rWins: true })), null, "held");
  assert.equal(f(r(55, 45)).stage, "likely");
  assert.equal(f(r(55, 45, { eevp: 40 })).stage, "ahead");
  assert.equal(f(r(55, 45, { eevp: 40, prec: 1 })), null, "one big batch isn't a flip");
  assert.equal(f(r(55, 45, { eevp: 10 })), null, "too early");
  assert.equal(f(r(45, 55)), null, "the holder is ahead");
  assert.equal(flipOf({ ...r(0, 0), totalVotes: 0 }, base(1), {}), null);
});
test("bellwethers are the biggest counties, then the most counted of those big enough to matter", () => {
  const u = (name, t, inPct, tot = 1) => ({ name, t, in: inPct, tot });
  const rows = [u("Big1", 5000, 10), u("Big2", 4000, 0, 0), u("Big3", 3000, 40), u("Mid", 1000, 80), u("Mid2", 900, 95), u("Mid3", 800, 50), u("Tiny", 50, 100), u("NoPast", 0, 100)];
  const b = pickBellwethers(rows);
  assert.deepEqual(b.map((x) => x.name), ["Big1", "Big2", "Big3", "Mid2", "Mid"], "a tiny county at 100% doesn't get in");
  assert.deepEqual(b.map((x) => x.why), ["big", "big", "big", "in", "in"]);
  assert.deepEqual(pickBellwethers([u("A", 100, 0, 0), u("B", 90, 0, 0), u("C", 80, 0, 0), u("D", 70, 0, 0), u("E", 60, 0, 0), u("F", 50, 0, 0)]).map((x) => x.name), ["A", "B", "C", "D", "E"], "before any votes, the next biggest fill in");
  assert.equal(pickBellwethers([u("Only", 10, 50)]).length, 1, "a state with few counties just shows them");
});
test("a Toss Up can't be an upset, whoever wins", () => {
  const s = scoreRace(race([cand("Dee", "Dem", 51, { winner: true }), cand("Arr", "GOP", 49)], { called: true }), base(1));
  assert.equal(s.flags.length, 0); assert.equal(s.severity, 0);
});
test("an AP call with 1% in counts as a call, but its margin isn't judged", () => {
  const s = scoreRace(race([cand("Dee", "Dem", 53, { winner: true }), cand("Arr", "GOP", 47)], { called: true, eevp: 1 }), base(-21, "D"));
  assert.equal(s.status, "scored"); assert.equal(s.flags.length, 0); assert.equal(s.marginCounts, false);
  assert.equal(summarize([s]).meanAbsGap, null); assert.equal(byState([s]).get("XX").gap, null);
  assert.equal(scoreRace(race([cand("Dee", "Dem", 53, { winner: true }), cand("Arr", "GOP", 47)], { called: true, eevp: 1 }), base(10, "R")).flags[0].k, "upset");
});
test("an unfinished count with no projection is never judged: under 20% says nothing, then only an early signal", () => {
  const lopsided = [cand("Dee", "Dem", 80), cand("Arr", "GOP", 20)];
  assert.equal(scoreRace(race(lopsided, { eevp: 10, precinctsPct: 10 }), base(5, "R")).flags.length, 0);
  const early = scoreRace(race(lopsided, { eevp: 80, precinctsPct: 80 }), base(5, "R"));
  assert.equal(early.status, "early"); assert.equal(early.severity, 0); assert.deepEqual(early.flags.map((f) => f.k), ["early"]);
  assert.equal(summarize([early]).surprises, 0); assert.equal(summarize([early]).earlySignals, 1);
});
test("Georgia's case: a big batch with almost no precincts in isn't even an early signal", () => {
  const s = scoreRace(race([cand("Dee", "Dem", 67), cand("Arr", "GOP", 33)], { eevp: 22, precinctsPct: 0.7 }), base(-4));
  assert.equal(s.oneBatch, true); assert.equal(s.flags.length, 0); assert.equal(s.status, "early");
  const p = projectRace(race([cand("Dee", "Dem", 1), cand("Arr", "GOP", 1)]), base(0), [unit("Fulton", 300, 37, 69, 0), unit("Clayton", 60, 10, 96, 0)], past({ Fulton: { m: -40, t: 500 }, Clayton: { m: -60, t: 90 } }));
  assert.equal(p, null, "high expected vote with no precincts is not a finished county");
});
test("the projection is the race's 2024 margin plus how far finished counties moved, weighted by their size", () => {
  const units = [unit("A", 40, 60), unit("B", 45, 55), unit("C", 30, 70), unit("D", 50, 50, 40, 40)];
  const pasts = { A: { m: 10, t: 100 }, B: { m: 0, t: 300 }, C: { m: 30, t: 100 }, D: { m: -5, t: 500 } };   // shifts: +10, +10, +10
  const b = base(-3, null, { pres2024: { marginRD: 2 } });
  const p = projectRace(race([cand("Dee", "Dem", 50), cand("Arr", "GOP", 50)], { eevp: 60, precinctsPct: 60 }), b, units, past(pasts));
  assert.equal(p.n, 3, "the unfinished county is left out"); assert.equal(Math.round(p.shift), 10); assert.equal(Math.round(p.margin), 12);
  assert.equal(p.coverage, 0.5); assert.equal(p.usable, true); assert.equal(p.confidence, "medium");
  const s = scoreRace(race([cand("Dee", "Dem", 55), cand("Arr", "GOP", 45)], { eevp: 60, precinctsPct: 60 }), b, p);
  assert.equal(s.basis, "counties"); assert.equal(Math.round(s.judged), 12); assert.equal(Math.round(s.gap), 15); assert.equal(s.flags[0].k, "bigmiss"); assert.ok(s.flags[0].t.includes("projected"));
});
test("too few finished counties makes no projection, and counties nothing like the race lower the confidence", () => {
  const pasts = { A: { m: 50, t: 10 }, B: { m: 50, t: 10 }, C: { m: 50, t: 10 }, D: { m: 0, t: 970 } };
  const b = base(0);
  assert.equal(projectRace(race([cand("Dee", "Dem", 1), cand("Arr", "GOP", 1)]), b, [unit("A", 40, 60), unit("B", 40, 60)], past(pasts)).usable, false);
  const thin = projectRace(race([cand("Dee", "Dem", 1), cand("Arr", "GOP", 1)]), b, [unit("A", 40, 60), unit("B", 40, 60), unit("C", 40, 60), unit("D", 50, 50, 10, 10)], past(pasts));
  assert.equal(thin.usable, false, "3% of the vote");
  const rural = { A: { m: 50, t: 300 }, B: { m: 50, t: 300 }, C: { m: 50, t: 300 }, D: { m: 0, t: 100 } };
  const skew = projectRace(race([cand("Dee", "Dem", 1), cand("Arr", "GOP", 1)]), b, [unit("A", 40, 60), unit("B", 40, 60), unit("C", 40, 60)], past(rural));
  assert.equal(skew.lopsided, true); assert.equal(skew.confidence, "low");
  const s = scoreRace(race([cand("Dee", "Dem", 90), cand("Arr", "GOP", 10)], { eevp: 40, precinctsPct: 40 }), base(40, "R"), skew);
  assert.ok(s.severity <= 1, "a thin projection can't make a big surprise"); assert.ok(!s.flags.some((f) => f.k === "behind"));
});
test("a House race skips a county its district only partly covers", () => {
  const b = base(0, null, { office: "House", pres2024: { marginRD: 5 } });
  const r = race([cand("Dee", "Dem", 600), cand("Arr", "GOP", 600)], { eevp: 50, precinctsPct: 50 });
  const p = projectRace(r, b, [unit("Whole", 200, 200), unit("Whole2", 200, 200), unit("Whole3", 200, 200), unit("Split", 50, 50)], past({ Whole: { m: 0, t: 600 }, Whole2: { m: 0, t: 600 }, Whole3: { m: 0, t: 600 }, Split: { m: 40, t: 900 } }));
  assert.equal(p.n, 3); assert.equal(Math.round(p.shift), 0);
  assert.equal(Math.round(p.coverage * 100), 50, "share of the district's estimated total vote");
});
test("an independent the forecast runs against the Republican takes the Democrat's side", () => {
  const b = base(-2, "R", { model: { margin: -2, p10: -12, p90: 8, dem: "Dan Osborn", gop: "Pete Ricketts" } });
  const r = race([cand("Osborn", "Una", 55), cand("Ricketts", "GOP", 45), cand("Marvin", "Lib", 0)]);
  assert.equal(sides(r, b).d.last, "Osborn");
  const s = scoreRace(r, b); assert.equal(s.dLetter, "I"); assert.equal(Math.round(s.now), -10); assert.equal(fmtMargin(s.now, s.dLetter), "I+10.0");
});
test("races with no two sides or no forecast are not scored, and a race with no votes is waiting", () => {
  assert.equal(scoreRace(race([cand("A", "Dem", 60), cand("B", "Dem", 40)]), { model: { margin: null, dem: "A", gop: "B" } }).status, "unscored");
  assert.equal(scoreRace(race([cand("Dee", "Dem", 90)]), base(-100)).status, "unscored");
  assert.equal(scoreRace(race([cand("Dee", "Dem", 0), cand("Arr", "GOP", 0)]), base(1)).status, "waiting");
});
test("a result on old district lines isn't compared with 2022", () => {
  const s = scoreRace(race([cand("Dee", "Dem", 45), cand("Arr", "GOP", 55)]), base(0, null, { y2022: { marginRD: 5, otherLines: true }, pres2024: { marginRD: 3 } }));
  assert.equal(s.vs2022, null); assert.equal(Math.round(s.vs2024), 7);
});
test("the summary needs five judged races before it claims a direction, and states add up", () => {
  const mk = (st, d, r) => ({ ...scoreRace(race([cand("Dee", "Dem", d), cand("Arr", "GOP", r)], { state: st }), base(0)), state: st });
  const few = [mk("AA", 40, 60), mk("AA", 50, 50)];
  assert.equal(summarize(few).hasDirection, false);
  const many = [...few, mk("BB", 45, 55), mk("BB", 45, 55), mk("CC", 48, 52)];
  const sum = summarize(many); assert.equal(sum.hasDirection, true); assert.equal(sum.judged, 5); assert.ok(sum.medianGap > 0); assert.equal(sum.towardD, 0);
  const st = byState(many); assert.equal(Math.round(st.get("AA").gap), 10); assert.equal(st.get("AA").surprises, 1);
});
