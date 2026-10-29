// Builds the ticker queue from the race index and producer state. Shared by the on-air
// ticker and the studio preview so both show exactly the same crawl. Pure: no fetches.

const PLACEHOLDER_IDLE = "Welcome to the Independent Election Night coverage";

export function partyTag(c) {
  if (c.independent) return "I";
  if (c.party === "Dem") return "D";
  if (c.party === "GOP") return "R";
  return c.party ?? "";
}

export function candShort(c) {
  const t = partyTag(c);
  return t ? `${c.last ?? c.name} (${t})` : (c.last ?? c.name);
}

export function raceText(r) {
  const top = r.candidates.slice(0, 3);
  if (!r.totalVotes) return `${r.label} · ${r.precinctsPct > 0 ? "polls closed" : "polls open"} · no results yet`;
  const cands = top.map((c) => `${candShort(c)} ${Number(c.pct ?? 0).toFixed(1)}%`).join(" · ");
  const winner = r.candidates.find((c) => c.winner);
  const status = r.called ? `AP CALL ✓ ${candShort(winner ?? r.candidates[0])}` : `${Math.round(r.eevp || r.precinctsPct || 0)}% in`;
  return `${r.label} · ${cands} · ${status}`;
}

/** Races to show when the producer has pinned nothing: featured races, then any with an independent and votes. */
export function defaultPins(races) {
  const featured = races.filter((r) => r.featured).map((r) => r.id);
  if (featured.length) return featured;
  return races
    .filter((r) => r.hasIndependent && r.kind === "federal" && r.candidates.some((c) => c.independent && c.pct >= 5))
    .sort((a, b) => a.state.localeCompare(b.state))
    .map((r) => r.id);
}

/** The crawl order as flat race and text entries: tickerItems with its chunks expanded when the state has a sequence,
 *  else the older fields (races in order, a manual item after every two). */
export function crawlSequence(p) {
  if (Array.isArray(p.tickerItems)) {
    const chunks = new Map((Array.isArray(p.chunks) ? p.chunks : []).map((c) => [c.id, c]));
    const out = [];
    for (const it of p.tickerItems) {
      if (!it) continue;
      if (it.t === "chunk") { const c = chunks.get(it.id); if (c) for (const x of c.items ?? []) out.push({ ...x, chunk: c.id }); }
      else out.push(it);
    }
    return out;
  }
  const pins = Array.isArray(p.pinnedRaceIds) ? p.pinnedRaceIds : [];
  const manual = (Array.isArray(p.manualItems) ? p.manualItems : []).filter((m) => m && m.text);
  const out = []; let mi = 0;
  pins.forEach((id, i) => { out.push({ t: "race", id }); if (i % 2 === 1 && mi < manual.length) { const m = manual[mi++]; out.push({ t: "text", id: m.id, text: m.text }); } });
  while (mi < manual.length) { const m = manual[mi++]; out.push({ t: "text", id: m.id, text: m.text }); }
  return out;
}

/**
 * @param {Array} races   from index.json
 * @param {Object} producer {tickerItems, chunks, idleText, callHighlight} (or the older {pinnedRaceIds, manualItems})
 * @returns {{items: Array<{key,kind,text,emphasis}>, source: "pins"|"default"|"idle", missing: string[]}}
 */
export function buildQueue(races, producer) {
  const p = producer ?? {};
  const byId = new Map((races ?? []).map((r) => [r.id, r]));
  let seq = crawlSequence(p);
  const usingDefault = !seq.some((it) => it.t === "race" || (it.t === "text" && it.text));
  if (usingDefault) seq = defaultPins(races ?? []).map((id) => ({ t: "race", id }));
  const missing = [...new Set(seq.filter((it) => it.t === "race" && !byId.has(it.id)).map((it) => it.id))];

  const out = [];
  seq.forEach((it, i) => {
    if (it.t === "race") { const r = byId.get(it.id); if (r) out.push({ key: `race:${r.id}:${i}`, kind: "race", text: raceText(r), emphasis: !!r.called && p.callHighlight !== false }); }
    else if (it.t === "text" && it.text) out.push({ key: `manual:${it.id ?? i}:${i}`, kind: "manual", text: it.text, emphasis: true });
  });

  if (!out.length) {
    out.push({ key: "idle", kind: "idle", text: p.idleText || PLACEHOLDER_IDLE, emphasis: false });
    return { items: out, source: "idle", missing };
  }
  return { items: out, source: usingDefault ? "default" : "pins", missing };
}
