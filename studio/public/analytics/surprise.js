// How a race's live count compares with what was expected. Pure: no fetches, no page. All margins are Republican minus Democrat, in points,
// and the "Democrat" side is whoever the forecast runs against the Republican, so an independent like Dan Osborn sits there.
//
// A race's overall percent in is not enough to judge it: a big early batch can read as 69% of a county's expected vote with no precincts reported,
// and counties finish in no useful order. So a margin is judged in one of two ways:
//   the count itself, once almost everything is in; or
//   a projection: how far the counties that have really finished moved from 2024, applied to the race's 2024 margin.
export const NEARLY_ALL_PCT = 90;   // from here the count speaks for itself
export const EARLY_PCT = 20;        // under this, nothing is said at all
export const DONE_EEVP = 95, DONE_PRECINCTS = 80;   // a finished county: nearly all its expected vote, and its precincts have really reported
export const MIN_COUNTIES = 3, MIN_COVERAGE = 0.15;  // fewer finished counties or less of the vote than this makes no projection
export const NOTABLE_PTS = 5, BIG_PTS = 10;
export const SAFE_PTS = 15;         // the same side was forecast and is ahead, both by at least this: a shift, not a surprise (R+26 becoming R+19)
export const NOTABLE_Z = 1.28, BIG_Z = 2;   // 1.28 is the edge of the forecast's own 80% range

const lastName = (s) => String(s ?? "").trim().split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).pop()?.toLowerCase() ?? "";
const pctIn = (r) => r?.eevp || r?.precinctsPct || 0;

/** The two candidates the race is scored between, or null when it has no such pair (one party on the ballot, say). */
export function sides(race, base) {
  const cands = race?.candidates ?? [];
  const byName = (n) => n && cands.find((c) => c.last?.toLowerCase() === lastName(n));
  const top = (party) => cands.filter((c) => c.party === party).sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0];
  const d = byName(base?.model?.dem) ?? top("Dem"), r = byName(base?.model?.gop) ?? top("GOP");
  return d && r && d !== r ? { d, r } : null;
}
export const sideLetter = (c) => (c?.party === "Dem" ? "D" : c?.party === "GOP" ? "R" : "I");

/** Where the race is heading, from its finished counties. units: the race's county rows; pastOf(name): that place's 2024 {m, t}.
 *  Returns null with no finished county; usable says whether there are enough to lean on. */
export function projectRace(race, base, units, pastOf) {
  const pair = sides(race, base);
  if (!pair || !units?.length || base?.pres2024?.marginRD == null) return null;
  const house = base.office === "House";
  const estTotal = pctIn(race) > 0 ? race.totalVotes / (pctIn(race) / 100) : 0;
  const done = []; let allWeight = 0;
  for (const u of units) {
    const p = pastOf(u.name); if (!p) continue;
    allWeight += p.t;
    const tot = Object.values(u.votes ?? {}).reduce((s, v) => s + (v ?? 0), 0);
    if (!tot || (u.eevp ?? 0) < DONE_EEVP || (u.precinctsPct ?? 0) < DONE_PRECINCTS) continue;
    if (house && tot < 0.45 * p.t) continue;   // a county split between districts: its 2024 number is for the whole county, so it isn't comparable
    const now = ((u.votes[pair.r.id] ?? 0) - (u.votes[pair.d.id] ?? 0)) / tot * 100;
    done.push({ shift: now - p.m, past: p.m, w: p.t, tot });
  }
  if (!done.length) return null;
  const W = done.reduce((s, x) => s + x.w, 0);
  const shift = done.reduce((s, x) => s + x.shift * x.w, 0) / W;
  const coverage = house ? (estTotal ? Math.min(1, done.reduce((s, x) => s + x.tot, 0) / estTotal) : 0) : (allWeight ? W / allWeight : 0);
  const spread = Math.sqrt(done.reduce((s, x) => s + x.w * (x.shift - shift) ** 2, 0) / W);
  // Small rural counties tend to finish first. If what has finished looks nothing like the race as a whole, say so.
  const lopsided = Math.abs(done.reduce((s, x) => s + x.past * x.w, 0) / W - base.pres2024.marginRD) > 15;
  const confidence = coverage >= 0.7 && !lopsided ? "high" : coverage >= 0.4 && !lopsided ? "medium" : "low";
  return { margin: base.pres2024.marginRD + shift, shift, n: done.length, coverage, spread, lopsided, confidence, usable: done.length >= MIN_COUNTIES && coverage >= MIN_COVERAGE };
}

/** One race, scored. proj: from projectRace, when there are county rows. */
export function scoreRace(race, base, proj = null) {
  const out = { label: race.label, id: race.id, state: race.state, office: base?.office, pct: pctIn(race), called: !!race.called, status: "waiting", flags: [], severity: 0, gap: null, now: null, judged: null, basis: null, proj, score: 0, marginCounts: false };
  if (!race.totalVotes || !base) return out;
  const pair = sides(race, base);
  if (!pair || base.model?.unopposed || base.model?.margin == null) { out.status = "unscored"; return out; }
  out.dLetter = sideLetter(pair.d);
  const total = race.candidates.reduce((s, c) => s + (c.votes ?? 0), 0) || race.totalVotes;
  out.now = ((pair.r.votes ?? 0) - (pair.d.votes ?? 0)) / total * 100;
  const E = base.model.margin;
  if (out.pct >= NEARLY_ALL_PCT) { out.judged = out.now; out.basis = "count"; }
  else if (proj?.usable) { out.judged = proj.margin; out.basis = "counties"; }
  out.marginCounts = out.judged != null;
  const shown = out.judged ?? out.now;
  out.leader = shown > 0 ? "R" : shown < 0 ? "D" : null;
  out.gap = shown - E;   // positive: better for the Republican than forecast
  const sigma = base.model.p90 != null && base.model.p10 != null && base.model.p90 > base.model.p10 ? (base.model.p90 - base.model.p10) / 2.563 : 6;
  out.z = Math.abs(out.gap) / sigma;
  out.vs2024 = base.pres2024 ? shown - base.pres2024.marginRD : null;
  out.vs2022 = base.y2022 && !base.y2022.otherLines ? shown - base.y2022.marginRD : null;
  const winner = race.candidates.find((c) => c.winner);
  const winSide = winner === pair.r ? "R" : winner === pair.d ? "D" : winner ? "other" : null;
  // A blowout that stays a blowout isn't news, however far it moved. It still counts toward the national lean, which is where a shift like that belongs.
  out.safe = Math.sign(shown) === Math.sign(E) && Math.min(Math.abs(shown), Math.abs(E)) >= SAFE_PTS;
  const scored = out.called || out.marginCounts;
  out.status = scored ? "scored" : out.pct >= EARLY_PCT ? "early" : "counting";
  if (out.status === "counting") return out;
  const fav = base.cookSide;          // Cook's favorite; a Toss Up has none
  const modelFav = Math.abs(E) >= 3 ? (E > 0 ? "R" : "D") : null;
  const amount = Math.abs(out.gap);
  const big = amount >= BIG_PTS || out.z >= BIG_Z, notable = amount >= NOTABLE_PTS || out.z >= NOTABLE_Z;
  const shaky = out.basis === "counties" && proj.confidence === "low";   // a thin projection can point something out, never call it big
  const how = out.basis === "counties" ? ` (projected, ${proj.confidence} confidence)` : "";
  if (out.called && winSide && fav && winSide !== fav) { out.flags.push({ k: "upset", t: `Upset: Cook had ${base.cook}` }); out.severity = 3; }
  else if (out.called && winSide && !fav && modelFav && winSide !== modelFav) { out.flags.push({ k: "forecastmiss", t: "Forecast's favorite lost" }); out.severity = 2; }
  else if (!out.called && out.marginCounts && !shaky && out.leader && fav && out.leader !== fav) { out.flags.push({ k: "behind", t: `Cook's favorite is behind (${base.cook})${how}` }); out.severity = 2; }
  if (out.safe) { /* no margin flag */ }
  else if (out.marginCounts && big) { out.flags.push({ k: shaky ? "miss" : "bigmiss", t: `${amount.toFixed(1)} pts from forecast${how}` }); out.severity = Math.max(out.severity, shaky ? 1 : 2); }
  else if (out.marginCounts && notable) { out.flags.push({ k: "miss", t: `${amount.toFixed(1)} pts from forecast${how}` }); out.severity = Math.max(out.severity, 1); }
  // Plenty of "expected vote" but almost no precincts is one big batch of one kind of vote, not a signal about the race.
  const oneBatch = (race.precinctsPct ?? 0) < out.pct / 3;
  if (!out.marginCounts && !out.called && big && !oneBatch && !out.safe) out.flags.push({ k: "early", t: `Early signal: ${amount.toFixed(1)} pts from forecast with ${Math.round(out.pct)}% in` });
  out.oneBatch = oneBatch;
  // Which side the surprise favors: the winner of a call that beat the favorite, else the way the margin missed.
  out.toward = out.flags.some((f) => f.k === "upset" || f.k === "forecastmiss") && (winSide === "R" || winSide === "D") ? winSide : out.gap > 0 ? "R" : "D";
  // Among equals, the closer the race, the higher it ranks: 7 points in a 2-point race beats 7 points in a 14-point one.
  out.score = out.severity * 100 + amount * (10 / (10 + Math.min(Math.abs(shown), Math.abs(E))));
  return out;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Across races: how many, how far, and in which direction. A direction needs five judged races before it means anything. */
export function summarize(scores) {
  const scored = scores.filter((s) => s.status === "scored");
  const gaps = scored.filter((s) => s.marginCounts).map((s) => s.gap);
  const close = scored.filter((s) => s.marginCounts && !s.safe).map((s) => s.gap);   // the average miss is about races that were in play
  const surprises = scored.filter((s) => s.severity > 0);
  const med = median(gaps);
  return {
    counting: scores.filter((s) => s.status !== "waiting").length, scored: scored.length, judged: gaps.length, projected: scored.filter((s) => s.basis === "counties").length,
    surprises: surprises.length, called: surprises.filter((s) => s.called).length, comingIn: surprises.filter((s) => !s.called).length, big: surprises.filter((s) => s.severity >= 2).length, upsets: scored.filter((s) => s.flags.some((f) => f.k === "upset")).length,
    towardR: surprises.filter((s) => s.toward === "R").length, towardD: surprises.filter((s) => s.toward === "D").length,
    earlySignals: scores.filter((s) => s.status === "early" && s.flags.length).length,
    medianGap: med, meanAbsGap: close.length ? close.reduce((a, g) => a + Math.abs(g), 0) / close.length : null, hasDirection: gaps.length >= 5, safeShifts: scored.filter((s) => s.marginCounts && s.safe).length,
  };
}

/** One state on the map: the mean miss of its judged races that were in play, and how many surprises. */
export function byState(scores) {
  const out = new Map();
  for (const s of scores) {
    const x = out.get(s.state) ?? { state: s.state, counting: 0, scored: 0, surprises: 0, sum: 0, early: 0, cookD: 0, cookR: 0, calledD: 0, calledR: 0 };
    if (s.status !== "waiting") x.counting++;
    if (s.status === "scored") { if (s.marginCounts && !s.safe) { x.scored++; x.sum += s.gap; } if (s.severity > 0) { x.surprises++; x[`${s.called ? "called" : "cook"}${s.toward}`]++; } }
    if (s.status === "early" && s.flags.length) x.early++;
    out.set(s.state, x);
  }
  for (const x of out.values()) x.gap = x.scored ? x.sum / x.scored : null;
  return out;
}

export const BELLWETHER_BIG = 3, BELLWETHER_IN = 2, BELLWETHER_MIN_SHARE = 0.01;
/** The counties to watch in a race: the biggest few by 2024 vote, then whichever have the most counted among those with enough people to matter
 *  (1% of the race's 2024 vote). Rows carry {why: "big"|"in"}. Most-counted picks need votes in; until then the next biggest fill in. */
export function pickBellwethers(rows) {
  const known = rows.filter((x) => x.t > 0).sort((a, b) => b.t - a.t);
  const all = known.reduce((s, x) => s + x.t, 0);
  const big = known.slice(0, BELLWETHER_BIG).map((x) => ({ ...x, why: "big" }));
  const rest = known.slice(BELLWETHER_BIG);
  const most = rest.filter((x) => x.tot > 0 && x.t >= all * BELLWETHER_MIN_SHARE).sort((a, b) => b.in - a.in || b.t - a.t).slice(0, BELLWETHER_IN);
  const fill = rest.filter((x) => !most.includes(x)).slice(0, BELLWETHER_IN - most.length);
  return [...big, ...[...most, ...fill].map((x) => ({ ...x, why: "in" }))];
}

const partyTag = (p) => (p === "Dem" ? "D" : p === "GOP" ? "R" : "I");
/** Whether a seat is changing hands: called, likely (a judged margin, no call yet), or just ahead for now. Null when it isn't. */
export function flipOf(race, base, s) {
  const from = partyTag(race.currentParty);
  if (!race.currentParty || !race.totalVotes) return null;
  const winner = race.candidates.find((c) => c.winner);
  if (race.called && winner) return partyTag(winner.party) !== from || race.flipped ? { stage: "called", from, to: partyTag(winner.party), name: winner.last } : null;
  const pair = sides(race, base); if (!pair || s.now == null) return null;
  const m = s.judged ?? s.now, lead = m > 0 ? pair.r : pair.d;
  if (m === 0 || partyTag(lead.party) === from) return null;
  if (s.marginCounts) return { stage: "likely", from, to: partyTag(lead.party), name: lead.last };
  return s.pct >= EARLY_PCT && !s.oneBatch ? { stage: "ahead", from, to: partyTag(lead.party), name: lead.last } : null;
}

export const fmtMargin = (m, dLetter = "D") => m == null ? "—" : Math.abs(m) < 0.05 ? "Even" : `${m > 0 ? "R" : dLetter}+${Math.abs(m).toFixed(1)}`;
export const fmtShift = (g, dLetter = "D") => g == null ? "—" : Math.abs(g) < 0.05 ? "0" : `${Math.abs(g).toFixed(1)} toward ${g > 0 ? "R" : dLetter}`;
