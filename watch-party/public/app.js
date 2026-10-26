// Shared client code: data loading with refresh, freshness, stars, formatting.
export const DATA = "/data";
export const REFRESH_MS = 60_000;

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");
export const pct = (n) => `${Number(n ?? 0).toFixed(1)}%`;
export const partyClass = (p) => (p === "Dem" ? "dem" : p === "GOP" ? "gop" : "oth");
export const candClass = (c) => (c.independent ? "ind" : partyClass(c.party));
export const tag = (c) => (c.party === "Dem" ? "D" : c.party === "GOP" ? "R" : c.independent ? "I" : c.party);
export const isSide = (c) => c.party === "Yes" || c.party === "No"; // ballot-measure "candidates"
/** Small grey badge naming the kind of race, so every row says what it is. */
export const BADGE = { S: "SENATE", H: "HOUSE", USD: "DELEGATE", G: "GOVERNOR", L: "LT GOV", A: "ATTY GEN", SS: "SEC STATE", RR: "RR COMM", I: "MEASURE", M: "MAYOR" };
export const kindBadge = (r) => `<span class="kind k-${esc(r.kind ?? "federal")}" title="${esc(r.officeName ?? "")}">${esc(BADGE[r.office] ?? r.office)}</span>`;
export const candColor = (c) => c.independent ? "#d4af37" : c.party === "GOP" ? "#c0392b" : c.party === "Dem" ? "#3b6fd6" : c.party === "Yes" ? "#0b1f44" : c.party === "No" ? "#8a93a6" : "#6f7d99";
export const winMark = (c) => (c.winner ? '<span class="win" title="AP has called this race">✓</span>' : "");
export const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function face(c, cls = "") {
  if (isSide(c)) return `<span class="face ${cls} side ${c.party.toLowerCase()}" title="${esc(c.party)}">${esc(c.party.toUpperCase())}</span>`;
  const inner = c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(initials(c.name))}'))">` : esc(initials(c.name));
  return `<span class="face ${cls} ${c.independent ? "ind" : partyClass(c.party)}" title="${esc(c.name)}">${inner}</span>`;
}

export function statusPill(r) {
  if (r.called) return `<span class="pill call">AP CALL</span>`;
  if (r.totalVotes > 0) return `<span class="pill counting">${Math.round(r.eevp || r.precinctsPct)}% IN</span>`;
  return `<span class="pill open">${r.pollClose && Date.parse(r.pollClose) > Date.now() ? "POLLS OPEN" : "NO RESULTS YET"}</span>`;
}

/** Independent's margin vs the best-placed other candidate, in points. null before results. */
export function indMargin(r) {
  if (!r.totalVotes) return null;
  const ind = r.candidates.find((c) => c.independent) ?? r.candidates[0];
  if (!ind) return null;
  const best = r.candidates.filter((c) => c.id !== ind.id).sort((a, b) => b.pct - a.pct)[0];
  return Math.round((ind.pct - (best?.pct ?? 0)) * 10) / 10;
}

export async function getJSON(path) {
  // Blob's CDN can serve a stale copy of an overwritten file for hours, so every read carries
  // a time-bucketed key: status every 15 s (it drives the freshness dot), data every 30 s.
  const bust = `?t=${Math.floor(Date.now() / (path === "status.json" ? 15_000 : 30_000))}`;
  const res = await fetch(`${DATA}/${path}${bust}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

/** Header status: dot colour by age of the last successful poll, "data as of", countdown. */
export function renderStatus(el, status, nextAt) {
  const age = status?.lastApSuccess ? (Date.now() - Date.parse(status.lastApSuccess)) / 1000 : Infinity;
  const cls = !status ? "off" : age < 180 ? "" : age < 600 ? "warn" : "bad";
  const label = !status ? "waiting for first data" : age < 180 ? "AP live" : age < 600 ? `AP data ${Math.round(age / 60)} min old` : "AP feed stale";
  const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  el.innerHTML = `<span class="dot ${cls}"></span><span>${label}<span class="long">${status?.lastApSuccess ? ` · data as of ${fmtTime(status.apTimestamp ?? status.lastApSuccess)}` : ""}</span> · ${left}s</span>`;
}

export const stars = {
  key: "wp-stars",
  get() { try { return new Set(JSON.parse(localStorage.getItem(this.key) ?? "[]")); } catch { return new Set(); } },
  toggle(id) { const s = this.get(); s.has(id) ? s.delete(id) : s.add(id); try { localStorage.setItem(this.key, JSON.stringify([...s])); } catch {} return s; },
};

export function testBanner(status) {
  const el = document.getElementById("testbanner");
  if (!el) return;
  el.hidden = status?.resultsType !== "t";
}

// State FIPS prefixes for the county map
export const FIPS = { AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56" };
