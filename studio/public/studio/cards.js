// Graphic cards: the real broadcast page scaled into a 16:9 thumbnail, an open-in-new-tab
// link at 1920x1080, a freshness bubble, and a race tag that cannot be mistaken.
//
// Thumbnail budget: only `maxLive` cards run a live iframe at once. Cards ask for a slot when
// they scroll into view and give it up when they leave; lower `priority` wins (featured
// sections use 1-2, movement 3, catalog 9). Catalog cards start static (numbers only) and
// join the queue only when the producer presses Preview.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COUNTY_CHARTS = new Set(["B6", "B8", "B10", "B13"]);
const fmtClock = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};

export function createCardManager({ maxLive = 12, getBg = () => "black", getSource = () => "global", getDraft = () => null } = {}) {
  const cards = new Set();
  let status = null, index = null;
  let scheduled = false;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { const c = e.target._card; if (c) c.visible = e.isIntersecting; }
    schedule();
  }, { rootMargin: "200px 0px" });
  const ro = new ResizeObserver((entries) => { for (const e of entries) scaleThumb(e.target); });
  function scaleThumb(thumb) {
    const f = thumb.querySelector("iframe"); if (!f) return;
    f.style.transform = `scale(${thumb.clientWidth / 1920})`;
  }
  function schedule() { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; reconcile(); }, 50); }

  function pageUrl(c, forOpen) {
    const u = new URL(c.chart.page, location.origin);
    if (c.race) u.searchParams.set("id", c.race.id);
    u.searchParams.set("src", getSource());
    const bg = forOpen ? getBg() : "black";
    if (bg) u.searchParams.set("bg", bg);
    if (!forOpen) { u.searchParams.set("preview", "1"); u.searchParams.set("feed", "blob"); }
    return u.pathname + u.search;
  }

  function reconcile() {
    const wanting = [...cards].filter((c) => c.chart.built && !c.static && c.visible).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const live = new Set(wanting.slice(0, maxLive));
    for (const c of cards) {
      if (live.has(c)) mount(c); else unmount(c, wanting.includes(c) ? "paused" : null);
    }
    onBudget?.(live.size, wanting.length);
  }
  let onBudget = null;

  function mount(c) {
    if (c.frame) return;
    const f = document.createElement("iframe");
    f.title = c.title;
    f.loading = "eager";
    f.src = pageUrl(c, false);
    f.addEventListener("load", () => { const d = getDraft(); if (d) f.contentWindow?.postMessage({ type: "producer", state: d }, "*"); });
    c.thumb.querySelector(".ph")?.remove();
    c.thumb.appendChild(f);
    c.frame = f;
    scaleThumb(c.thumb);
  }
  function unmount(c, reason) {
    if (c.frame) { c.frame.remove(); c.frame = null; }
    if (!c.chart.built) { placeholder(c, `<span>Not built yet</span><span class="small">${esc(c.chart.name)}</span>`, "unbuilt"); return; }
    if (c.static) { placeholder(c, staticHtml(c) + `<button class="loadbtn">Preview</button>`); return; }
    if (reason === "paused") { placeholder(c, `<span>Preview paused (${maxLive} live thumbnails at once)</span><button class="loadbtn">Load this one</button>`); return; }
    if (!c.thumb.querySelector(".ph")) placeholder(c, `<span class="small">Scroll here to load the preview</span>`);
  }
  function placeholder(c, html, cls = "") {
    let ph = c.thumb.querySelector(".ph");
    if (!ph) { ph = document.createElement("div"); c.thumb.appendChild(ph); }
    ph.className = `ph ${cls}`;
    ph.innerHTML = html;
  }
  function staticHtml(c) {
    const r = c.race; if (!r) return `<span>${esc(c.chart.name)}</span>`;
    const top = (r.candidates ?? []).slice(0, 3).map((x) => `${esc(x.last ?? x.name)} ${r.totalVotes ? Number(x.pct).toFixed(1) + "%" : ""}`).join(" · ");
    return `<span class="num">${r.totalVotes ? Math.round(r.eevp || r.precinctsPct) + "% in" : "no results yet"}${r.called ? " · AP CALL" : ""}</span><span>${top}</span>`;
  }

  function freshnessFor(c) {
    const s = status;
    const race = c.race ? (index?.byId?.get(c.race.id) ?? c.race) : null;
    const parts = [];
    let at = null;
    if (c.race && COUNTY_CHARTS.has(c.chart.id)) {
      at = s?.countyFreshness?.[c.race.state] ?? null;
      parts.push(`County data for ${c.race.state} refreshed ${ago(at)}`);
    } else {
      at = s?.lastApSuccess ?? index?.generated ?? null;
      parts.push(`AP feed refreshed ${ago(at)}`);
    }
    if (race?.lastUpdated) parts.push(`AP last changed this race at ${fmtClock(race.lastUpdated)}`);
    if (s?.apTimestamp) parts.push(`AP data as of ${fmtClock(s.apTimestamp)}`);
    const age = at ? (Date.now() - Date.parse(at)) / 1000 : Infinity;
    const cls = !at ? "off" : age < 180 ? "" : age < 900 ? "warn" : "bad";
    return { text: at ? `data ${ago(at)}` : "no data yet", cls, title: parts.join("\n") };
  }
  function renderFresh(c) {
    const f = freshnessFor(c);
    c.bubble.className = `bubble ${f.cls}`;
    c.bubble.innerHTML = `<span class="dot ${f.cls === "" ? "" : f.cls === "off" ? "off" : f.cls}"></span>${esc(f.text)}`;
    c.bubble.title = f.title;
  }

  function card({ chart, race = null, priority = 5, isStatic = false, showRace = true }) {
    const el = document.createElement("div");
    el.className = "gcard";
    const title = race ? `${chart.id} ${chart.name} · ${race.label}` : `${chart.id} ${chart.name}`;
    el.innerHTML = `
      <div class="ghead"><span class="cid">${esc(chart.id)}</span><span class="gname" title="${esc(chart.name)}">${esc(chart.name)}</span>${race && showRace ? `<span class="racetag" title="${esc(race.stateName)} · ${esc(race.title)}">${esc(race.label)}</span>` : ""}</div>
      <div class="thumb"></div>
      <div class="gfoot"><span class="bubble off"><span class="dot off"></span>…</span><span class="spacer"></span><a target="_blank" rel="noopener">Open 1920×1080 ↗</a></div>`;
    const c = { el, chart, race, priority, static: isStatic, visible: false, frame: null, seq: card.seq = (card.seq ?? 0) + 1,
      title, thumb: el.querySelector(".thumb"), bubble: el.querySelector(".bubble"), link: el.querySelector("a") };
    el._card = c; c.thumb._card = c;
    c.link.href = pageUrl(c, true);
    if (!chart.built) { c.link.removeAttribute("href"); c.link.textContent = "not built yet"; c.link.classList.add("muted"); }
    el.addEventListener("click", (e) => {
      if (!e.target.closest(".loadbtn")) return;
      c.static = false; c.priority = 0; schedule();
    });
    cards.add(c);
    unmount(c, null);
    renderFresh(c);
    io.observe(el);
    ro.observe(c.thumb);
    return el;
  }

  /** Remove cards whose elements are no longer in the document (after a section re-render). */
  function prune() {
    for (const c of [...cards]) if (!c.el.isConnected) { io.unobserve(c.el); ro.unobserve(c.thumb); if (c.frame) c.frame.remove(); cards.delete(c); }
    schedule();
  }
  function setData({ status: s, index: i }) {
    if (s) status = s;
    if (i) { index = i; index.byId = new Map(i.races.map((r) => [r.id, r])); }
    for (const c of cards) renderFresh(c);
  }
  function broadcast(draft) {
    for (const c of cards) c.frame?.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  }
  /** Source changed: every open link and every live frame points at the new source. */
  function refreshSource() {
    for (const c of cards) {
      if (c.chart.built) c.link.href = pageUrl(c, true);
      if (c.frame) c.frame.contentWindow?.postMessage({ type: "producer-source", source: getSource() }, "*");
    }
  }
  function refreshLinks() { for (const c of cards) if (c.chart.built) c.link.href = pageUrl(c, true); }
  setInterval(() => { for (const c of cards) renderFresh(c); reconcile(); }, 15_000);
  window.addEventListener("scroll", schedule, { passive: true });

  return { card, prune, setData, broadcast, refreshSource, refreshLinks, onBudget: (fn) => { onBudget = fn; }, get count() { return cards.size; } };
}
