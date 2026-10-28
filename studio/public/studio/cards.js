// Graphic cards: the real broadcast page scaled into a 16:9 thumbnail, an open-in-new-tab
// link at 1920x1080, a freshness bubble, and a race tag that cannot be mistaken.
//
// Thumbnail budget: only `maxLive` cards run a live iframe at once. Cards ask for a slot when
// they scroll into view and give it up when they leave; lower `priority` wins (featured
// sections use 1-2, movement 3, catalog 9). Catalog cards start static (numbers only) and
// join the queue only when the producer presses Preview.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COUNTY_CHARTS = new Set(["B6", "B8", "B10", "B13"]);
const fmtClock = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "—"; // rule: every time carries its zone, ET by default
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};

export function createCardManager({ maxLive = 32, getDisplay = () => ({ bg: "black", opacity: "100" }), getOrigin = () => location.origin, getRaces = () => null, getDraft = () => null } = {}) {
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

  /** Open/Show links are the semantic address (/g/B5?bg=black&opacity=60&src=global&race=NE-SEN): display
   *  parameters first, then the race by label. Thumbnails load the page directly (no redirect per frame). */
  /** The address to hand a switcher or rundown: absolute, chart id and race id, display parameters first, no
   *  preview-only parameters (src, fit, sample). A1 (the ticker) copies the ticker address instead. */
  function copyUrl(c) {
    const p = new URLSearchParams();
    const d = getDisplay(c.section);
    if (d.bg) p.set("bg", d.bg);
    if (d.opacity && d.opacity !== "100") p.set("opacity", d.opacity);
    if (c.race && c.chart.needsState) p.set("state", c.race.state);
    else if (c.race) p.set("race", c.race.label);
    racesParam(c, p);
    for (const [k, v] of Object.entries(c.params ?? {})) if (v) p.set(k, v);
    const s = p.toString();
    return `${getOrigin()}/g/${c.chart.id}${s ? "?" + s : ""}`;
  }
  /** Charts that draw a list of races (the C, D and A series) carry the page's featured races as races=
   *  when those differ from the shipped set; with the shipped set the address stays short and the page uses it. */
  function racesParam(c, p) { if (c.chart.kind !== "race") { const r = getRaces(); if (r) p.set("races", r.join(",")); } }
  function pageUrl(c, forOpen) {
    const semantic = forOpen && (c.chart.page ?? "").startsWith("/g/");
    const u = new URL(semantic ? `/g/${c.chart.id}` : c.chart.page, location.origin);
    const p = new URLSearchParams();
    const d = getDisplay(c.section);   // the section's Background and Opacity: previews and links alike
    if (d.bg) p.set("bg", d.bg);
    if (d.opacity && d.opacity !== "100") p.set("opacity", d.opacity);
    if (forOpen && c.open === "preview") p.set("fit", "1");   // "show": the real page at full size
    for (const [k, v] of u.searchParams) p.set(k, v);          // e.g. reports.html?view=counts
    if (c.race && c.chart.needsState) p.set(semantic ? "state" : "st", c.race.state);
    else if (c.race) { if (semantic) p.set("race", c.race.label); else p.set("id", c.race.id); }
    racesParam(c, p);
    for (const [k, v] of Object.entries(c.params ?? {})) if (v) p.set(k, v);
    if (!forOpen) p.set("preview", "1");
    p.set("sample", "auto");   // fabricated results until the count starts
    return u.pathname + "?" + p.toString();
  }

  function reconcile() {
    const wanting = [...cards].filter((c) => c.chart.built && !c.chart.retired && !c.static && c.visible).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
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
    f.src = pageUrl(c, false); f.dataset.u = f.src;
    f.addEventListener("load", () => { feedFrame(f); const d = getDraft(); if (d) f.contentWindow?.postMessage({ type: "producer", state: d }, "*"); });
    c.thumb.querySelector(".ph")?.remove();
    c.thumb.appendChild(f);
    c.frame = f;
    scaleThumb(c.thumb);
  }
  function unmount(c, reason) {
    if (c.frame) { c.frame.remove(); c.frame = null; }
    if (c.chart.retired) { placeholder(c, `<span>Retired</span><span class="small">${esc(c.chart.name)}${c.chart.retiredNote ? " · " + esc(c.chart.retiredNote) : ""}</span><span class="small">The id ${esc(c.chart.id)} stays reserved.</span>`, "retired"); return; }
    if (c.chart.unavailable) { placeholder(c, `<span>Not available</span><span class="small">${esc(c.chart.name)} · ${esc(c.chart.unavailable)}</span>`, "retired"); return; }
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

  function card({ chart, race = null, priority = 5, isStatic = false, showRace = true, menu = [], params = null, open = "preview", section = "charts" }) {
    const el = document.createElement("div");
    el.className = "gcard";
    const title = race ? `${chart.id} ${chart.name} · ${race.label}` : `${chart.id} ${chart.name}`;
    el.innerHTML = `
      <div class="ghead"><span class="cid" title="Chart id ${esc(chart.id)}: /g/${esc(chart.id)} in any address">${esc(chart.id)}</span><span class="gname" title="${esc(chart.name)}">${esc(chart.name)}</span>${race && showRace ? `<span class="racetag" title="Race id ${esc(race.label)} (AP race ${esc(race.id)}) · ${esc(race.stateName)} · ${esc(race.title)}">${esc(race.label)}</span>` : ""}${menu.length ? `<button class="kebab" title="More" aria-label="More">⋯</button><div class="menu" hidden>${menu.map((m, i) => `<button data-mi="${i}">${esc(m.label)}</button>`).join("")}</div>` : ""}</div>
      <div class="thumb"></div>
      <div class="gfoot"><span class="bubble off"><span class="dot off"></span>…</span><span class="spacer"></span>${chart.built && !chart.retired && chart.page ? `<button class="copybtn" type="button" title="Copy this graphic's address (chart id and race id, with the Global settings) for a switcher or rundown">Copy URL</button>` : ""}<a class="openbtn" target="_blank" rel="noopener" title="Open this graphic in a new tab, scaled to fit the window"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9 2h5v5M14 2L7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>${open === "show" ? "Show 1920×1080" : "Preview"}</a></div>`;
    const c = { el, chart, race, params, open, priority, section, static: isStatic, visible: false, frame: null, seq: card.seq = (card.seq ?? 0) + 1,
      title, thumb: el.querySelector(".thumb"), bubble: el.querySelector(".bubble"), link: el.querySelector("a"), copy: el.querySelector(".copybtn") };
    el._card = c; c.thumb._card = c;
    c.link.href = pageUrl(c, true);
    if (chart.retired) { el.classList.add("retired"); c.link.removeAttribute("href"); c.link.textContent = "retired"; c.link.classList.add("muted"); }
    else if (!chart.built) { c.link.removeAttribute("href"); c.link.textContent = "not built yet"; c.link.classList.add("muted"); }
    else { c.thumb.classList.add("clickable"); if (open === "show") el.classList.add("show"); c.thumb.title = open === "show" ? "Open this graphic at 1920×1080 in a new tab" : "Open this graphic in a new tab, scaled to fit the window"; }
    if (c.copy) c.copy.dataset.url = copyUrl(c);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".copybtn")) { const b = e.target.closest(".copybtn"); navigator.clipboard?.writeText(copyUrl(c)).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy URL"), 1500); }).catch(() => { b.textContent = copyUrl(c); }); return; }
      if (e.target.closest(".kebab")) { const m = el.querySelector(".menu"); m.hidden = !m.hidden; return; }
      const mi = e.target.closest("[data-mi]"); if (mi) { el.querySelector(".menu").hidden = true; menu[Number(mi.dataset.mi)]?.onClick(); return; }
      if (e.target.closest(".loadbtn")) { c.static = false; c.priority = 0; c.visible = true; schedule(); return; }
      if (e.target.closest(".thumb") && chart.built) window.open(c.link.href, "_blank", "noopener");
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
  /** One download for every preview: the room's copy of the results file and poller status goes to each frame. */
  function feedPayload() {
    return { type: "feed", index: index ? { generated: index.generated, resultsType: index.resultsType, apTimestamp: index.apTimestamp, races: index.races } : null, status: status ?? null };
  }
  function feedFrame(f) { if (index || status) f.contentWindow?.postMessage(feedPayload(), "*"); }
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "feed-request") return;
    for (const c of cards) if (c.frame?.contentWindow === e.source) feedFrame(c.frame);
  });
  function setData({ status: s, index: i }) {
    if (s) status = s;
    if (i) { index = i; index.byId = new Map(i.races.map((r) => [r.id, r])); }
    for (const c of cards) { renderFresh(c); if (c.frame) feedFrame(c.frame); }
  }
  function broadcast(draft) {
    for (const c of cards) c.frame?.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  }
  /** Source changed: every open link and every live frame points at the new source. */
  function refreshSource() {
    for (const c of cards) {
      if (c.chart.built) c.link.href = pageUrl(c, true);
      if (c.frame) c.frame.contentWindow?.postMessage({ type: "producer-source", source: "local" }, "*");
    }
  }
  function refreshLinks() { for (const c of cards) if (c.chart.built) { c.link.href = pageUrl(c, true); if (c.copy) c.copy.dataset.url = copyUrl(c); } }
  /** Display settings changed: live previews whose address changed reload. */
  function refreshFrames() { for (const c of cards) if (c.frame) { const u = pageUrl(c, false); if (c.frame.dataset.u !== u) { c.frame.dataset.u = u; c.frame.src = u; } } }
  setInterval(() => { for (const c of cards) renderFresh(c); reconcile(); }, 15_000);
  document.addEventListener("click", (e) => { if (!e.target.closest(".kebab, .menu")) for (const m of document.querySelectorAll(".gcard .menu")) m.hidden = true; });
  window.addEventListener("scroll", schedule, { passive: true });

  return { card, prune, setData, broadcast, refreshSource, refreshFrames, refreshLinks, onBudget: (fn) => { onBudget = fn; }, get count() { return cards.size; } };
}
