// Fabricated results for previews before the count starts (?sample=auto). Deterministic per race
// id, so a preview looks the same on every refresh, and never used by a page without that
// parameter. The curated featured races use the hand-written sample in sample-data.js.

// Small seeded PRNG so numbers are stable per race.
function rng(seed) {
  let a = 0; for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Give every race in an index plausible votes, reporting and some calls. Returns a new index. */
export function fabricateIndex(index, samples = []) {
  const byId = new Map(samples.map((r) => [r.id, r]));
  const races = index.races.map((r) => {
    const s = byId.get(r.id);
    if (s) return { ...r, ...s, candidates: s.candidates.map((c) => ({ ...(r.candidates.find((x) => x.id === c.id) ?? {}), ...c })), featured: r.featured, hasIndependent: r.hasIndependent };
    const rand = rng(r.id);
    const total = Math.round((r.office === "S" || r.office === "G" ? 400_000 + rand() * 2_400_000 : r.office === "H" ? 120_000 + rand() * 260_000 : 50_000 + rand() * 900_000));
    const eevp = Math.round(15 + rand() * 85);
    const counted = Math.round(total * eevp / 100);
    const n = r.candidates.length;
    // Shares: a leader at 44-62%, the rest split with a slight tail.
    const lead = 0.44 + rand() * 0.18;
    const weights = r.candidates.map((_, i) => (i === 0 ? lead : (1 - lead) * (n > 1 ? Math.pow(0.55, i - 1) : 1)));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const candidates = r.candidates.map((c, i) => ({ ...c, votes: Math.round(counted * weights[i] / wsum), winner: false }));
    candidates.sort((a, b) => b.votes - a.votes);
    const ctot = candidates.reduce((a, c) => a + c.votes, 0) || 1;
    for (const c of candidates) c.pct = Math.round(c.votes / ctot * 1000) / 10;
    const margin = (candidates[0]?.pct ?? 0) - (candidates[1]?.pct ?? 0);
    const called = eevp >= 85 && margin > 4;
    if (called) candidates[0].winner = true;
    return { ...r, candidates, totalVotes: ctot, eevp, precinctsPct: eevp, called, callStatus: called ? "Called" : "", lastUpdated: new Date().toISOString() };
  });
  return { ...index, races, sample: true };
}

/** County units with votes that add up to the race's fabricated totals. */
export function fabricateCounties(units, race) {
  if (!units?.length || !race?.candidates?.length) return units;
  const rand = rng(`${race.id}-counties`);
  const weights = units.map(() => 0.2 + rand() * 2.5);
  const wsum = weights.reduce((a, b) => a + b, 0);
  return units.map((u, i) => {
    const tot = Math.round(race.totalVotes * weights[i] / wsum);
    const tilt = (rand() - 0.5) * 0.3; // this county leans one way or the other
    const votes = {};
    let left = tot;
    race.candidates.forEach((c, j) => {
      const share = Math.max(0.01, c.pct / 100 + (j === 0 ? tilt : j === 1 ? -tilt : 0));
      const v = j === race.candidates.length - 1 ? left : Math.min(left, Math.round(tot * share));
      votes[c.id] = Math.max(0, v); left -= votes[c.id];
    });
    return { ...u, votes, eevp: Math.min(99, Math.round(race.eevp * (0.7 + rand() * 0.5))), precinctsPct: race.eevp };
  });
}

/** AP-style balance-of-power trend built from fabricated races. */
export function fabricateTrend(races) {
  const mk = () => ({ won: 0, leading: 0, holdovers: 0, winningTrend: 0, current: 0, insufficient: 0, net: 0, netLeaders: 0 });
  const build = (office, holdDem, holdGop, curDem, curGop) => {
    const p = { Dem: mk(), GOP: mk(), caucusDem: mk(), caucusGop: mk(), other: mk() };
    p.Dem.holdovers = holdDem; p.GOP.holdovers = holdGop; p.Dem.current = curDem; p.GOP.current = curGop;
    for (const r of races.filter((x) => x.office === office)) {
      const top = [...r.candidates].sort((a, b) => b.votes - a.votes)[0]; if (!top || !r.totalVotes) continue;
      const k = top.party === "Dem" ? "Dem" : top.party === "GOP" ? "GOP" : "other";
      if (r.called) p[k].won++; else p[k].leading++;
    }
    for (const k of Object.keys(p)) p[k].winningTrend = p[k].won + p[k].leading + p[k].holdovers;
    p.Dem.net = p.Dem.winningTrend - p.Dem.current; p.GOP.net = p.GOP.winningTrend - p.GOP.current;
    return { office: office === "S" ? "U.S. Senate" : "U.S. House", code: office, timestamp: new Date().toISOString(), parties: p };
  };
  return { generated: new Date().toISOString(), resultsType: "sample", senate: build("S", 32, 31, 45, 53), house: build("H", 0, 0, 215, 219) };
}

/** A night's worth of margin points ending at the race's current margin. */
export function fabricateHistory(race) {
  const cands = [...race.candidates].sort((a, b) => b.votes - a.votes);
  if (!cands[0] || !race.totalVotes) return [];
  const rand = rng(`${race.id}-history`);
  const end = (cands[0].pct ?? 0) - (cands[1]?.pct ?? 0);
  const now = Math.floor(Date.now() / 1000), pts = [];
  let m = end + (rand() - 0.5) * 20;
  for (let i = 0; i < 150; i++) {
    const t = now - (150 - i) * 60;
    m += (end - m) * 0.04 + (rand() - 0.5) * 1.2;
    const gap = Math.abs(m);
    pts.push([t, m >= 0 ? cands[0].id : cands[1]?.id ?? cands[0].id, +gap.toFixed(2), Math.min(race.eevp, Math.round(5 + i * (race.eevp / 150))), Math.round(race.totalVotes * (i + 1) / 150)]);
  }
  return pts;
}
