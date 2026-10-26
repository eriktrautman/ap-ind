// Builds the ticker queue from the race index and producer state. Shared by the on-air
// ticker and the studio preview so both show exactly the same crawl. Pure: no fetches.

const PLACEHOLDER_IDLE = "Election night coverage · results as they come in from AP";

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

/**
 * @param {Array} races   from index.json
 * @param {Object} producer {pinnedRaceIds, manualItems, idleText}
 * @returns {{items: Array<{key,kind,text,emphasis}>, source: "pins"|"default"|"idle", missing: string[]}}
 */
export function buildQueue(races, producer) {
  const p = producer ?? {};
  const byId = new Map((races ?? []).map((r) => [r.id, r]));
  const pins = Array.isArray(p.pinnedRaceIds) ? p.pinnedRaceIds : [];
  const usingDefault = pins.length === 0;
  const ids = usingDefault ? defaultPins(races ?? []) : pins;
  const missing = ids.filter((id) => !byId.has(id));

  const raceItems = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({ key: `race:${r.id}`, kind: "race", text: raceText(r), emphasis: !!r.called }));

  const manualItems = (Array.isArray(p.manualItems) ? p.manualItems : [])
    .filter((m) => m && m.text)
    .map((m) => ({ key: `manual:${m.id}`, kind: "manual", text: m.text, emphasis: true }));

  // Interleave: one manual item after every two race items, remainder at the end.
  const out = [];
  let mi = 0;
  raceItems.forEach((item, i) => {
    out.push(item);
    if (i % 2 === 1 && mi < manualItems.length) out.push(manualItems[mi++]);
  });
  while (mi < manualItems.length) out.push(manualItems[mi++]);

  if (!out.length) {
    out.push({ key: "idle", kind: "idle", text: p.idleText || PLACEHOLDER_IDLE, emphasis: false });
    return { items: out, source: "idle", missing };
  }
  return { items: out, source: usingDefault ? "default" : "pins", missing };
}
