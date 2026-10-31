// Studio (/studio): status bar and poller controls, the LIVE TICKER and the Ticker Builder (the one thing that is
// published), and the sections that organise this browser's view of the graphics (Slate, Races, Movement, catalogs).
import { buildQueue } from "/ticker-queue.js";
import { DEFAULTS, CHARTS, FEATURED_RACES, TICKER_FIELDS, BACKGROUNDS, specDef, normalizePlaylists, normalize, diffState, expandTicker, readLocal, saveLocal, screenAddress, describeScreen } from "/g/control.js";
import { THEMES, DEFAULT_THEME, themeName } from "/g/themes.js";
import { createCardManager } from "/studio/cards.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BADGE = { S: "SENATE", H: "HOUSE", USD: "DELEGATE", G: "GOVERNOR", L: "LT GOV", A: "ATTY GEN", SS: "SEC STATE", RR: "RR COMM", I: "MEASURE", M: "MAYOR" };
const kindBadge = (r) => `<span class="kind k-${esc(r.kind ?? "federal")} o-${esc(r.office ?? "")}" title="${esc(r.officeName ?? "")}">${esc(BADGE[r.office] ?? r.office)}</span>`;
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" }) + " ET" : "—"; // rule: every time carries its zone, ET by default
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};
const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { cache: "no-store", headers: { "content-type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { toLogin(loginKind === "test" ? "rehearsal" : "expired"); throw new Error("signed out"); }
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
};

// ---------- dialog ----------
function ask({ title, body, ok = "Confirm", danger = false, info = false }) {
  const dlg = $("dlg");
  if (dlg.open) dlg.close();
  $("dlgtitle").textContent = title;
  $("dlgbody").innerHTML = body;
  $("dlgok").textContent = ok;
  $("dlgok").className = danger ? "danger" : "primary";
  dlg.querySelector('button[value="cancel"]').hidden = info;   // info: one Close button, nothing to confirm
  dlg.returnValue = "cancel";
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}
// {id} markers from diffState become race labels (NE-SEN) once the index is loaded.
const withLabels = (text) => text.replace(/\{(\d+)\}/g, (_, id) => index?.byId?.get(id)?.label ?? `race ${id}`);
const changeList = (changes) => changes.length ? `<ul>${changes.map((c) => `<li>${esc(withLabels(c.text))}</li>`).join("")}</ul>` : `<p class="muted">No differences.</p>`;

// ---------- quick tooltips ----------
// Native title tooltips wait about a second. Every title on the page becomes a data-tip shown
// after 150 ms in a small box of our own; the text and markup stay exactly as written.
(() => {
  const tip = document.createElement("div"); tip.className = "qtip"; tip.hidden = true; document.body.appendChild(tip);
  let timer = null, current = null;
  const adopt = (el) => { if (el.hasAttribute("title")) { el.dataset.tip = el.getAttribute("title"); el.removeAttribute("title"); } return el.dataset.tip; };
  const show = (el) => {
    const text = adopt(el); if (!text) return;
    tip.textContent = text; tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left))}px`;
    const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
  };
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[title], [data-tip]"); if (!el || el === current) return;
    clearTimeout(timer); current = el; tip.hidden = true;
    timer = setTimeout(() => show(el), 150);
  });
  document.addEventListener("mouseout", (e) => { if (current && !current.contains(e.relatedTarget)) { clearTimeout(timer); current = null; tip.hidden = true; } });
  document.addEventListener("mousedown", () => { clearTimeout(timer); tip.hidden = true; });
  window.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
})();

// ---------- auth ----------
// The sign-in form is its own page, /studio/login. The server (proxy.js on Vercel, serve.mjs on a laptop) sends a
// browser without a valid cookie there before any of this page is served, so this script only ever runs signed in;
// it goes back there when the cookie stops verifying (expiry, a changed password, the rehearsal rule at Live).
const toLogin = (why) => location.replace(`/studio/login${why ? `?why=${why}` : ""}`);
function showApp() { $("app").hidden = false; $("account").hidden = false; }   // the poller strip waits for /api/runtime (renderStatus), so a laptop never flashes it
// ---------- who may do what: the footer's View User Permissions ----------
const ROLE_LABEL = { producer: "Producer", publisher: "Publisher", readonly: "Read only", rehearsal: "Rehearsal" };
const ROLE_ALLOWS = {
  producer: "Everything: publish the live ticker and the live screens, run or pause the poller, switch results between Test and Live.",
  publisher: "Publish the live ticker and the live screens. Cannot poll, pause, or switch Test/Live.",
  readonly: "See everything in the Studio, including what is live and who published it. Cannot publish or change anything.",
  rehearsal: "The shared rehearsal password: read only, and switched off the moment results go Live.",
};
const ROLE_ORDER = ["producer", "publisher", "readonly", "rehearsal"];
$("permslink").addEventListener("click", async () => {
  let me = {};
  try { me = await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()); } catch {}
  const people = (me.accounts ?? []).slice().sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  const rows = people.map((p) => `<tr><td>${esc(p.name)}${p.name === me.name && p.role === me.role ? ' <span class="you">(you)</span>' : ""}</td><td class="role">${esc(ROLE_LABEL[p.role] ?? p.role)}</td><td>${esc(ROLE_ALLOWS[p.role] ?? "")}</td></tr>`).join("");
  ask({
    title: "User permissions",
    info: true, ok: "Close",
    body: `${people.length ? `<table class="permtable"><thead><tr><th>Name</th><th>Role</th><th>Allows</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">Sign in to see who is on this site.</p>`}
      <p class="small"><b>Roles.</b></p>
      <ul class="permroles">${ROLE_ORDER.map((r) => `<li><b>${ROLE_LABEL[r]}.</b> ${esc(ROLE_ALLOWS[r])}</li>`).join("")}</ul>
      <p class="small muted">Each person has their own password, set on the site's Vercel project as <code>STUDIO_PASSWORD_&lt;ROLE&gt;_&lt;FIRST&gt;_&lt;LAST&gt;</code>. Adding, removing or changing someone's role is an edit to those variables and a redeploy; the engineer does it. Every publish is stamped with the publisher's name.</p>`,
  });
});
$("logout").addEventListener("click", async () => { try { await fetch("/api/login", { method: "DELETE" }); } catch {} toLogin(); });
// The sticky header's height changes with the banners; anchor jumps from the
// section nav must clear it, so its measured height drives scroll-padding-top on <html>.
new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", `${document.querySelector("header.top").offsetHeight + 8}px`)).observe(document.querySelector("header.top"));
// Which password signed in: "prod" (a named producer) or "test" (the rehearsal one, flagged in the banner row), and whose.
let loginKind = null;
let loginRole = null;         // "producer" | "publisher" | "readonly" | "rehearsal": the variable the password came from
let loginName = null;
/** The account menu, top right: the name on the button; the role and what it allows in the dropdown, with Sign out. */
const renderWho = () => {
  $("acctname").textContent = loginName ?? "Signed in";
  $("acctrole").textContent = loginRole ? (ROLE_LABEL[loginRole] ?? loginRole) : "";
  $("acctallows").textContent = loginRole ? (ROLE_ALLOWS[loginRole] ?? "") : "";
};
const acctOpen = (open) => { $("acctmenu").hidden = !open; $("acctbtn").setAttribute("aria-expanded", String(open)); $("account").classList.toggle("open", open); };
$("acctbtn").addEventListener("click", (e) => { e.stopPropagation(); acctOpen($("acctmenu").hidden); });
$("acctperms").addEventListener("click", () => { acctOpen(false); $("permslink").click(); });
document.addEventListener("click", (e) => { if (!e.target.closest("#account")) acctOpen(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") acctOpen(false); });
const byWhom = (s) => s?.updatedBy ? ` by ${esc(s.updatedBy)}` : "";

// ---------- data ----------
let status = null, settings = null, index = null;
let runtime = undefined;      // from /api/runtime: undefined until asked, null on the website (no such route), an object on a laptop (npm start)
let live = null;              // the LIVE TICKER's parameters as last read (normalized), or null if never read
let liveSeenAt = null;        // updatedAt of the live ticker when this page last pulled or published
let liveError = null;         // why the live ticker is unreadable right now, or null
// What the live address answers (/data/producer.json, the copy every ticker, screen and graphic reads): its updatedAt and when
// it was read. A publish is "on air" once this matches the authoritative copy's updatedAt. lastPublished: what this page
// published last, so the note shows under the ticker or the screen that is actually waiting.
let readersAt = undefined;    // undefined: never read; null: the address answered with no publish stamp
let readersReadAt = 0;
let readersError = null;
let lastPublished = null;     // { updatedAt, blocks: ["ticker"] | ["screenA"] | ... }
let draft = normalize(DEFAULTS);   // everything on this page, saved in this browser. Only the ticker builder's four fields are ever published.
const tickerPart = (s) => Object.fromEntries(TICKER_FIELDS.map((k) => [k, structuredClone(s[k])]));
const tickerDiff = (from, to) => diffState(from, to).filter((c) => TICKER_FIELDS.includes(c.field));
/** The page's featured races as race ids for chart addresses, or null when they are the shipped ones (then addresses stay short). */
const featuredLabels = () => draft.featuredRaceIds.join() === DEFAULTS.featuredRaceIds.join() ? null : draft.featuredRaceIds.map((id) => index?.byId?.get(id)?.label ?? id);
// ---------- display settings: a top template, one pair per section, one BG per live draft; this browser only ----------
const BG_OPTIONS = BACKGROUNDS;   // a keying colour or one of the backplates, the same list on every dropdown
const OPACITY_OPTIONS = ["100", "90", "80", "70", "60", "50", "40", "30", "20", "10"];
const SECTIONS = ["ticker", "screens", "playlists", "detail", "broad", "movement", "persistent", "catalog", "charts"];
const PAGES = ["ticker", "screenA", "screenB"];
function loadDisplay() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem("studio.display") ?? "null"); } catch {}
  if (!d) d = { top: { bg: "black", opacity: "100" }, sections: {}, pages: {} };   // the defaults: Black at 100%
  d.top ??= { bg: "black", opacity: "100" }; d.sections ??= {}; d.pages ??= {};
  return d;
}
let display = loadDisplay();
function saveDisplay() { try { localStorage.setItem("studio.display", JSON.stringify(display)); } catch {} }
const secDisplay = (sec) => ({ ...display.top, ...(display.sections[sec] ?? {}) });
/** A live draft's Background is part of the draft itself and is published with it; the address can still override it. */
const pageBg = (page) => (page === "ticker" ? draft.tickerBg : draft[page]?.bg) ?? "black";
const selectHtml = (attrs, options, value) => `<select ${attrs}>${options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;
/** The two dropdowns on every section's title line and the BG on every live draft, showing the saved values. */
function renderDisplayControls() {
  for (const sec of SECTIONS) {
    const d = secDisplay(sec);
    const box = document.querySelector(`.cardhead[data-sec="${sec}"] .secdisp`); if (!box) continue;
    // The Live Ticker and Live Screens sections have no Background of their own: each draft's Background covers both its addresses.
    box.innerHTML = `${sec === "ticker" || sec === "screens" ? "" : `<label>Background ${selectHtml(`data-sec="${sec}" data-f="bg"`, BG_OPTIONS, d.bg)}</label>`}<label>Opacity ${selectHtml(`data-sec="${sec}" data-f="opacity"`, OPACITY_OPTIONS.map((o) => [o, o + "%"]), d.opacity)}</label>`;
  }
  for (const page of PAGES) {
    const sel = document.querySelector(`select[data-page="${page}"]`); if (!sel) continue;
    sel.innerHTML = BG_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === pageBg(page) ? "selected" : ""}>${l}</option>`).join("");
  }
  $("topbg").innerHTML = BG_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");   // the same list as every other Background dropdown
  $("topbg").value = display.top.bg; $("topopacity").value = display.top.opacity;
}
/** Anything that shows a background or opacity follows the saved values. */
function applyDisplay() {
  renderDisplayControls();
  cards.refreshLinks(); cards.refreshFrames();
  renderTickerUrl(); renderTickerFrames(); renderScreens();
}
document.addEventListener("change", (e) => {
  const sec = e.target.closest("select[data-sec]");
  if (sec) { display.sections[sec.dataset.sec] = { ...secDisplay(sec.dataset.sec), [sec.dataset.f]: sec.value }; saveDisplay(); applyDisplay(); return; }
  const pg = e.target.closest("select[data-page]");
  if (pg) { if (pg.dataset.page === "ticker") draft.tickerBg = pg.value; else draft[pg.dataset.page].bg = pg.value; commit(); applyDisplay(); return; }
  if (e.target.id === "topbg" || e.target.id === "topopacity") { display.top = { bg: $("topbg").value, opacity: $("topopacity").value }; saveDisplay(); }
});
$("applyall").addEventListener("click", async () => {
  const top = { bg: $("topbg").value, opacity: $("topopacity").value };
  const ok = await ask({ title: "Apply to every section?", body: `<p>Every section's Background and Opacity become <b>${esc(BG_OPTIONS.find(([v]) => v === top.bg)?.[1] ?? top.bg)}</b> at <b>${esc(top.opacity)}%</b>. Previews and links on this page change to match. Nothing published changes.</p>`, ok: "Apply to All Charts" });
  if (!ok) return;
  display.top = top; display.sections = {};
  saveDisplay(); applyDisplay();
});
const cards = createCardManager({ maxLive: 32, getDisplay: (sec) => secDisplay(sec), getOrigin: () => origin(), getRaces: featuredLabels, getDraft: () => draft , getTheme: () => previewThemeParam() });
cards.onBudget((live, wanting) => { $("thumbbudget").textContent = wanting > live ? `${live} of ${wanting} previews live (at most 32 at once)` : live ? `${live} live previews` : ""; });

/** True between a Test/Live switch and the poll that confirms it (settings say one thing, the last run says another). */
const switchPending = () => { const want = settings?.resultsType ?? null, have = status?.resultsType ?? null; return !!want && !!have && want !== have; };   // only an explicit setting counts; a laptop's env fallback must not look like a switch
async function loadStatus() {
  try { settings = await api("/api/settings"); } catch {}
  // While a Test/Live switch waits for the poller to confirm it, every read goes past the CDN's 15 s copy.
  const bucket = switchPending() ? Date.now() : Math.floor(Date.now() / 15_000);
  try { const r = await fetch(`/data/status.json?t=${bucket}`, { cache: "no-store" }); const next = r.ok ? await r.json() : null; status = next?.generated ? next : null; } catch {}
  renderStatus();
  if (switchPending()) { clearTimeout(loadStatus.again); loadStatus.again = setTimeout(loadStatus, 3_000); }
  cards.setData({ status });
}
async function loadIndex() {
  try {
    const res = await fetch(`/data/index.json?t=${Math.floor(Date.now() / 15_000)}`, { cache: "no-store" });
    const next = res.ok ? await res.json() : null;
    if (!Array.isArray(next?.races)) return;   // no poll has written an index yet (fresh laptop store)
    index = next;
    index.byId = new Map(index.races.map((r) => [r.id, r]));
    const states = [...new Set(index.races.map((r) => r.state))].sort();
    for (const id of ["cstate"]) { const sel = $(id); const cur = sel.value; sel.innerHTML = `<option value="">All states</option>${states.map((s) => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("")}`; }
    cards.setData({ index });
  } catch { return; }
  renderAll();   // outside the try: a rendering bug must surface in the console, not vanish
}
/** Read the LIVE TICKER's parameters. On a laptop the runner answers from the deployment (or from itself when GLOBAL=self). */
async function loadLive() {
  try {
    const remote = normalize(await api("/api/producer"));
    liveError = null;
    const first = !live;
    live = remote;
    // A browser that has never used this page starts its builder from what is live, so Publish begins as a no-op.
    if (first && !readLocal()) { liveSeenAt = remote.updatedAt; draft = saveLocal({ ...normalize(DEFAULTS), ...tickerPart(remote) }); renderAll(); cards.broadcast(draft); }
    else renderLive();
  } catch (e) { liveError = e.message; renderLive(); }
  renderStatus();
}

/** Read the live address exactly as its readers do (same path, same 5 s bucket), to say whether a publish has reached them. */
async function loadReaders() {
  try {
    const r = await fetch(`/data/producer.json?t=${Math.floor(Date.now() / 5_000)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`${r.status}`);
    readersAt = (await r.json())?.updatedAt ?? null; readersError = null;
  } catch (e) { readersError = e.message; }
  readersReadAt = Date.now();
  renderFresh();
}
/** The note under each published preview: waiting (amber), late (red after a minute), picked up (green for a moment), or nothing. */
function freshState() {
  if (!live?.updatedAt || readersAt === undefined) return null;
  const pubAt = Date.parse(live.updatedAt), seen = readersAt ? Date.parse(readersAt) : 0;
  const behind = seen < pubAt;
  const since = (Date.now() - pubAt) / 1000;
  if (behind) return { kind: since > 60 ? "late" : "waiting", since };
  if (since < 20) return { kind: "ok", since };
  return null;
}
function renderFresh() {
  const f = freshState();
  const mine = lastPublished && live && lastPublished.updatedAt === live.updatedAt ? lastPublished.blocks : null;   // else someone else's publish: every block
  const who = !mine && live?.updatedBy ? `${live.updatedBy} published` : "Published";
  for (const [block, el] of [["ticker", $("tickerfresh")], ["screenA", document.querySelector("#screenA .freshline")], ["screenB", document.querySelector("#screenB .freshline")]]) {
    if (!el) continue;
    const show = f && (!mine || mine.includes(block));
    el.hidden = !show;
    if (!show) continue;
    const when = `${who} ${Math.round(f.since)} s ago`;
    el.className = `freshline ${f.kind}`;
    el.innerHTML = f.kind === "ok" ? `✓ On air: the live address has picked this up. <span class="muted">${esc(when)}.</span>`
      : f.kind === "late" ? `⚠ Still not on air after ${Math.round(f.since / 60)} min: the live address still answers with the previous version. <span class="muted">${esc(when)}${readersError ? ` · the address is unreadable: ${esc(readersError)}` : ""}. The preview on this side changes when it has picked it up.</span>`
      : `⏳ Not on air yet: the live address still answers with the previous version. <span class="muted">${esc(when)}; readers pick a publish up within a few seconds.</span>`;
  }
}

// ---------- state model: this page is a workbench; only the ticker builder is published, to the one live ticker ----------
const otherOperator = () => live && liveSeenAt !== live.updatedAt;
/** Roles, from the password's variable name. Producer actions (poll, pause, Test/Live) need a PRODUCER password. Publishing
 *  (ticker, live screens) is open to PRODUCER and PUBLISHER. READONLY and the rehearsal password only look. */
const isProducer = () => loginRole === "producer";
const mayPublish = () => loginRole === "producer" || loginRole === "publisher";
const canPublish = () => mayPublish() && (runtime ? !!runtime.production?.canPush : true);
const WRENCH = '<svg class="wrench" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M13.6 4.6a3.6 3.6 0 0 1-4.7 4.3L4 13.8a1.5 1.5 0 0 1-2.1-2.1l4.9-4.9a3.6 3.6 0 0 1 4.3-4.7L8.9 4.3l2.8 2.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg> ';
const LOCK = '<svg class="lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const notProducer = () => loginRole === "publisher"
  ? "Producer only. A publisher password publishes the ticker and the live screens; Test/Live, pause and poll change the poller for every output and need a producer password."
  : "Producer only. You are signed in with a read-only password, which can look but not change anything.";
const NOT_PUBLISHER = "Read-only account. This password can look but not publish; a publisher or producer password can.";
const NOT_CONFIGURED = "You are not authorized to publish from this computer. Publishing needs the live ticker's password to be set up on this machine by the engineer. You can still use this ticker by its address, and pull from the live ticker.";
/** Grey out a producer-only control for the current sign-in. */
function producerOnly(el) {
  el.disabled = !isProducer(); el.classList.toggle("noauth", !isProducer()); if (!isProducer()) el.title = notProducer();
  const has = !!el.querySelector(".lock");
  if (!isProducer() && !has) el.insertAdjacentHTML("afterbegin", LOCK); else if (isProducer() && has) el.querySelector(".lock").remove();
}
const canPull = () => runtime ? !!runtime.production?.canPull : !liveError;
// The live ticker is always named by its web address: on the website that is this site; on a laptop it is
// the website it points at, or the laptop itself (GLOBAL=self).
const prodHost = () => runtime ? (runtime.production?.where === "self" ? `${location.host} (this laptop)` : runtime.production?.origin?.replace(/^https?:\/\//, "") ?? "the website") : location.host;
const onSite = () => !runtime;
const origin = () => (onSite() ? location.origin : runtime?.production?.origin ?? location.origin);
const BUILDER = "the builder's crawl order (races, text and chunks), its chunks, AP Call highlight and idle text";

/** Every edit comes through here: the page saves to this browser at once. Nothing is published by an edit. */
function commit() {
  draft = saveLocal(normalize(draft));
  renderAll();
  cards.broadcast(draft);
}

/** The box at the top of the page: two kinds of ticker, graphics as addresses, and what this page does and does not change. */
function renderHow() {
  const host = prodHost();
  $("howtext").innerHTML = [
    `<b>Every chart is a link.</b> Show or Copy URL on any card gives an address carrying the chart, the race and the display settings. It always shows the same thing and can be shared with other authorized people.`,
    `<b>Live Ticker.</b> One permanent address, <code>${esc(host)}/ticker</code>. Build a crawl order of races, text and chunks (packages of races and text, built once under the ticker and placed anywhere), use it by its own link, or publish it to become the live ticker; it updates published within seconds.`,
    `<b>Live Screens.</b> Two permanent addresses for full-screen charts. Build the draft on the left and publish it to the published screen on the right.`,
    `<b>Collect what you need.</b> Feature races and charts to keep them close in the sections above the catalogs. This organises your view only and is never published.`,
    `<b>Producer actions</b> (poll, Test/Live, pause) need a producer password. A publisher password publishes the ticker and the live screens but cannot use them; a read-only password (and the rehearsal one) can look but not change anything published.`,
    `<b>Restore All Default Settings</b> resets this page, never the live ticker or screens.`,
  ].map((x) => `<li>${x}</li>`).join("");
}

/** The LIVE TICKER block: what it is crawling right now and when that was published. */
function renderLive() {
  renderHow();
  const box = $("liveparams");
  if (!live) box.innerHTML = `<div class="warnline bad">${liveError ? `Cannot read the live ticker: ${esc(liveError)}` : "Reading the live ticker…"}</div>`;
  else {
    box.innerHTML = `<table class="params">
      <tr><td class="k" title="crawl: races, text and chunks in crawl order; hover a piece for the full text">crawl</td><td><div class="chips">${live.tickerItems.map((it) => seqChip(it, live)).join("")}</div></td></tr>
      ${live.chunks.length ? `<tr><td class="k" title="chunks: the packages published with this ticker, used in the crawl or not">chunks</td><td>${live.chunks.map((c) => `<div><span class="chunktag">CHUNK</span><b>${esc(c.name || c.id)}</b> <span class="chips" style="display:inline-flex">${c.items.map((it) => seqChip(it, live)).join("")}</span></div>`).join("")}</td></tr>` : ""}
      <tr><td class="k" title="calls: 1 highlights AP Calls yellow, 0 does not">calls</td><td>${live.callHighlight ? "1 · AP Calls highlighted yellow" : "0 · no highlight"}</td></tr>
      <tr><td class="k" title="idle: the line that crawls when there is nothing else">idle</td><td>${esc(live.idleText || DEFAULTS.idleText)}</td></tr>
      <tr><td class="k" title="background: what the permanent address shows when it names none">background</td><td>${esc(BG_OPTIONS.find(([v]) => v === live.tickerBg)?.[1] ?? live.tickerBg)} <span class="muted">· override on any address with <code>?bg=</code> black, green, capitol, flag, panels or transparent, and <code>&amp;opacity=10..100</code></span></td></tr>
      <tr><td class="k">published</td><td>${live.updatedAt ? `${esc(fmtTime(live.updatedAt))} (${esc(ago(live.updatedAt))})${byWhom(live)}` : "never: the shipped defaults are live"}</td></tr>
    </table>`;
  }
  renderPublishState();
  renderScreens();
  renderFresh();
}
function renderPublishState() {
  const changes = live ? tickerDiff(live, draft) : [];
  const same = live && !changes.length;
  const st = $("pubstate");
  st.className = `pubstate ${same ? "same" : "dirty"}`;
  st.textContent = !live ? "Live ticker not read yet" : same ? "Builder matches the live ticker" : `Builder differs from the live ticker: ${changes.length} change${changes.length === 1 ? "" : "s"}`;
  st.title = changes.length ? changes.map((c) => "• " + withLabels(c.text)).join("\n") : "The live ticker is crawling exactly what this builder has.";
  const r = runtime?.production;
  $("publish").disabled = !canPublish() || !changes.length;
  $("publish").classList.toggle("noauth", !canPublish());
  $("publish").innerHTML = `${canPublish() ? "" : LOCK}Publish to Live`;
  $("pubwhy").textContent = canPublish() ? "" : mayPublish() ? "Not set up on this machine" : "Read-only account";
  $("publish").title = !canPublish() ? (mayPublish() ? NOT_CONFIGURED : NOT_PUBLISHER) : !changes.length ? "Nothing to publish: the builder already matches the live ticker" : `Replace the live ticker's parameters with the builder's (${changes.length} change${changes.length === 1 ? "" : "s"})`;
  document.querySelector("#liveframe .lockmark").hidden = canPublish();
  document.querySelector("#ticker .screenmid .arrow:not(.back)").classList.toggle("off", $("publish").disabled);
  $("pull").disabled = !canPull() || !live;
  $("pull").title = !canPull() ? (r?.reason ?? liveError ?? "pulling is not possible right now") : "Replace the builder's races, items, idle text and highlight with the live ticker's";
}

async function publish() {
  if (!canPublish()) return;
  let latest = live;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; } catch (e) { liveError = e.message; }
  const changes = tickerDiff(latest ?? DEFAULTS, draft);
  const someoneElse = latest && latest.updatedAt !== liveSeenAt;
  const host = prodHost();
  const ok = await ask({
    title: "Publish to the LIVE TICKER?",
    body: `<p><b>${esc(host)}/ticker</b> takes ${BUILDER}. It changes within about 5 seconds, at the next item boundary, without restarting the crawl; a note under the published preview says when the live address has picked it up. Nothing else on this page is published, and tickers built from an address are not affected.</p>
      ${changeList(changes)}
      <p class="small muted">Last published: ${latest?.updatedAt ? esc(fmtTime(latest.updatedAt)) + " (" + esc(ago(latest.updatedAt)) + ")" + byWhom(latest) : "never"}.</p>
      ${someoneElse ? `<div class="warnline bad">${latest.updatedBy ? esc(latest.updatedBy) : "Someone else"} published at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or published. Publishing now replaces their ticker. Press Cancel and Pull if you want to see it first.</div>` : ""}
      ${!changes.length ? `<div class="warnline">The builder already matches the live ticker.</div>` : ""}`,
    ok: "Publish", danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify(tickerPart(draft)) }));
    live = saved; liveSeenAt = saved.updatedAt; liveError = null;
    lastPublished = { updatedAt: saved.updatedAt, blocks: ["ticker"] };
    renderAll(); loadReaders();
  } catch (e) {
    await ask({ title: "Publish failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>The live ticker is unchanged. The builder is still saved on this page.</p>`, ok: "OK" });
  }
}
async function pull() {
  let latest;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; }
  catch (e) { liveError = e.message; renderLive(); await ask({ title: "Can't read the live ticker", body: `<div class="warnline bad">${esc(e.message)}</div><p>The builder is unchanged.</p>`, ok: "OK" }); return; }
  // Pull keeps chunks that exist only on this page, so the change list is against what the builder will actually become.
  const mineAfter = draft.chunks.filter((c) => !latest.chunks.some((x) => x.id === c.id));
  const changes = tickerDiff(draft, { ...latest, chunks: [...latest.chunks, ...mineAfter] });
  const ok = await ask({
    title: "Pull from the LIVE TICKER?",
    body: `<p>${BUILDER[0].toUpperCase() + BUILDER.slice(1)} are replaced by the live ticker's (published ${latest.updatedAt ? esc(ago(latest.updatedAt)) : "never, so they are the defaults"}). Nothing published changes.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">The builder already matches the live ticker.</div>` : ""}`,
    ok: "Pull into the builder", danger: changes.length > 0,
  });
  if (!ok) return;
  liveSeenAt = latest.updatedAt;
  // The live chunks replace this page's copies of the same chunks; chunks that exist only here stay.
  draft = saveLocal({ ...draft, ...tickerPart(latest), chunks: [...latest.chunks, ...mineAfter] });
  renderAll(); cards.broadcast(draft);
}
async function restoreDefaults() {
  const changes = diffState(draft, DEFAULTS);
  const ok = await ask({ title: "Restore the defaults on this page?", body: `<div class="warnline bad"><b>Everything on this page</b> goes back to the shipped defaults: the ticker builder, both live screen drafts, featured races and charts, overview charts, persistent elements and their inputs, and every Background and Opacity dropdown (Black at 100%). This browser's saved settings are replaced.</div><p><b>The LIVE TICKER is not touched.</b> It keeps crawling what was last published until someone publishes again.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">This page is already on the defaults.</div>` : ""}`, ok: "Restore defaults", danger: true });
  if (!ok) return;
  draft = saveLocal(normalize(DEFAULTS));
  display = { top: { bg: "black", opacity: "100" }, sections: {}, pages: {} }; saveDisplay(); applyDisplay();   // display settings too: Black at 100%
  renderAll(); cards.broadcast(draft);
}
$("publish").addEventListener("click", publish);
$("pull").addEventListener("click", pull);
$("defaults").addEventListener("click", restoreDefaults);

// ---------- status bar + poller ----------
let speedsOpen = false; try { speedsOpen = localStorage.getItem("studio.speeds") === "1"; } catch {}
document.addEventListener("click", (e) => { if (e.target.closest("#st-speeds")) { speedsOpen = !speedsOpen; try { localStorage.setItem("studio.speeds", speedsOpen ? "1" : "0"); } catch {} renderStatus(); } });
function renderStatus() {
  const s = status;
  const age = s?.lastApSuccess ? (Date.now() - Date.parse(s.lastApSuccess)) / 1000 : Infinity;
  const paused = settings?.pollEnabled === false;
  const cls = paused ? "warn" : !s ? "bad" : age < 180 ? "ok" : age < 600 ? "warn" : "bad";
  const feedLabel = paused ? "Polling paused" : !s ? "No poller status yet" : age < 180 ? "AP feed live" : age < 600 ? `AP data ${Math.round(age / 60)} min old` : "AP feed stale";
  // Test vs Live shows what the poller is actually tracking (its last run). Between a switch and the poll that
  // confirms it, the bar says so instead of flipping back and forth with the CDN's older copies.
  const have = s?.resultsType ?? null, want = settings?.resultsType ?? settings?.envResultsType ?? null;
  const pending = switchPending();
  const rt = have ?? want ?? "t";
  const apOk = s && !(s.lastError && (s.consecutiveFailures ?? 0) > 0);
  const st = (id, html) => `<span class="st" id="${id}">${html}</span>`;
  $("statusbar").innerHTML =
    st("st-feed", `<span class="dot ${cls === "ok" ? "" : cls}"></span><b>${esc(feedLabel)}</b>`) +
    st("st-refresh", `<span class="k" title="When our poller last fetched results from AP successfully">Last Refresh</span><b>${esc(ago(s?.lastApSuccess))}</b>`) +
    st("st-asof", `<span class="k" title="AP's own timestamp on the results, not our fetch time. On the Test stream it moves only when AP runs its simulation, so it can sit hours or days back; on Live it advances with every tabulation update.">Data As Of</span><b>${esc(s?.apTimestamp ? fmtTime(s.apTimestamp) : "—")}</b>`) +
    st("st-rt", `<span class="k">Data Stream</span>${pending ? `<b style="color:#ffd166;font-weight:700" title="Switched; waiting for the next poll to confirm. The outputs follow within about a minute.">${rt === "l" ? "LIVE" : "TEST"} → ${want === "l" ? "LIVE" : "TEST"} ⏳</b>` : `<b style="color:${rt === "l" ? "#5fd48a" : "#ffd166"};font-weight:700">${rt === "l" ? "LIVE" : "TEST"}</b>`}`) +
    st("st-api", `<span class="k">API Access</span><span class="dot ${!s ? "off" : apOk ? "" : "bad"}"></span><b>${!s ? "unknown" : apOk ? "working" : "failing"}</b>`) +
    // The three cadences fold behind one click so the bar stays short.
    `<button class="st speeds ${speedsOpen ? "open" : ""}" id="st-speeds" type="button" title="${speedsOpen ? "Hide" : "Show"} the refresh speeds">Refresh speeds ${speedsOpen ? "▾" : "▸"}</button>` +
    (speedsOpen ? st("st-county", `<span class="k">County Data</span><b title="Each state's county units refresh every 10 minutes in rotation">every 10 min</b>`) +
      st("st-charts", `<span class="k">Chart Refresh</span><b title="Every graphic re-reads the results every 15 seconds">≤ 15 s</b>`) +
      st("st-air", `<span class="k">Data-to-Ticker Speed</span><b title="The ticker re-reads what is published every 5 seconds">≤ 5 s</b>`) : "");
  $("testbanner").hidden = rt !== "t";
  $("loginbanner").hidden = loginKind !== "test";

  $("rtype").querySelectorAll("button").forEach((b) => { const on = b.dataset.rt === rt, target = pending && b.dataset.rt === want; b.classList.toggle("on", on); b.classList.toggle("pending", target); b.innerHTML = `${target ? "⏳ " : on ? (b.dataset.rt === "t" ? WRENCH : "✓ ") : ""}${b.dataset.rt === "t" ? "Test" : "Live"}`; b.disabled = !isProducer() || pending; b.title = !isProducer() ? notProducer() : target ? "Switching: waiting for the next poll to confirm" : on ? "Current data stream" : `Switch to ${b.dataset.rt === "t" ? "AP test data" : "live results"}`; });
  // One lock on the group's label, not one per button; the selected side keeps its colour so the choice stays obvious.
  $("rtype").classList.toggle("locked", !isProducer());
  { const lbl = $("rtype").querySelector(".lbl"); const has = !!lbl.querySelector(".lock"); if (!isProducer() && !has) lbl.insertAdjacentHTML("afterbegin", LOCK); else if (isProducer() && has) lbl.querySelector(".lock").remove(); }
  $("pause").querySelector(".lbl").textContent = paused ? "Resume polling" : "Pause polling";
  $("pause").classList.toggle("danger", !paused);
  for (const el of [$("pollnow"), $("pollfresh"), $("pause")]) producerOnly(el);
  $("poller").hidden = runtime === undefined || (!!runtime && runtime.mode !== "poll");   // unknown yet, or a standby with no poller of its own
  if ($("poller").hidden) { $("pollinfo").hidden = true; $("pollinfobtn").setAttribute("aria-expanded", "false"); }
  $("readonly").hidden = isProducer();
  $("readonlytxt").textContent = loginRole === "publisher" ? "Publisher · Publishes Only · These Need a Producer" : "Not Authorized · This Account is Read Only";

  renderStandby();
  const problems = [];
  if (!index && runtime) problems.push(
    runtime.mode === "mirror" ? { warn: true, title: "No results on this laptop yet.", text: runtime.mirror?.lastError ? `The mirror cannot copy from the deployment: ${runtime.mirror.lastError}` : "The first copy from the deployment is in progress; the lists fill in within a minute." }
    : runtime.mode === "follow" ? { warn: true, title: "No results on this laptop.", text: "Started without mirroring or polling, and the files hold no index. Restart with npm start." }
    : { warn: true, title: "No results on this laptop yet.", text: "The first poll is running; the lists fill in within a minute." });
  if (paused) problems.push({ warn: true, title: "Polling is paused.", text: "No new AP data is being fetched. Everything keeps showing the last data. Under Producer actions press Resume polling." });
  else if (!s) problems.push({ title: "The poller has never written a status file.", text: "Under Producer actions press Poll now. If that fails, the error appears here in plain English." });
  else if (s.lastError && (s.consecutiveFailures ?? 0) > 0) problems.push({ title: `Last poll failed (${ago(s.lastError.at)}).`, text: s.lastError.text, fix: fixFor(s.lastError.code) });
  else if (age >= 180) problems.push({ warn: age < 600, title: `No successful poll for ${Math.round(age / 60)} minutes.`, text: "The cron should run every minute. Under Producer actions press Poll now: if it succeeds, the cron is not firing (check the Vercel project's Cron Jobs tab). If it fails, the error appears here." });
  if (s?.errors?.length && !(s.lastError && (s.consecutiveFailures ?? 0) > 0)) problems.push({ warn: true, title: "Last run finished with warnings.", list: s.errors });
  const p = $("problem");
  p.hidden = problems.length === 0;
  p.className = `problem top ${problems.every((x) => x.warn) ? "warn" : ""}`;
  p.innerHTML = problems.map((x) => `<b>${esc(x.title)}</b>${x.text ? esc(x.text) : ""}${x.fix ? ` <span class="muted">${esc(x.fix)}</span>` : ""}${x.list ? `<ul>${x.list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`).join("");
}
function fixFor(code) {
  return {
    "no-key": "The engineer adds AP_API_KEY in Vercel → Settings → Environment Variables and redeploys.",
    "ap-auth": "AP rejected the key. If it was just changed in Vercel, the project needs a redeploy. Otherwise the key or its election entitlement is wrong: call AP support.",
    "ap-rate": "AP's limit is 10 requests a minute. Do not press Poll now repeatedly; wait a minute.",
    "ap-timeout": "Try Poll now once more. If it keeps happening AP is slow on their side.",
    "ap-down": "AP's servers are returning errors. Try Poll now in a minute.",
    "blob": "Nothing you can fix from here; the engineer needs to check the Blob store token.",
    "network": "Try Poll now once more.",
    "unknown": "Try Poll now + reset caches. If it persists, send this message to the engineer.",
  }[code] ?? "";
}
async function runPoll(fresh) {
  const msg = $("pollmsg");
  for (const id of ["pollnow", "pollfresh"]) $(id).disabled = true;
  msg.className = "note"; msg.textContent = fresh ? "Resetting caches and polling AP…" : "Polling AP…";
  try {
    const r = await api(`/api/poll${fresh ? "?fresh=1" : ""}`, { method: "POST" });
    status = r;
    msg.className = `note ${r.ok ? "ok" : "bad"}`;
    msg.textContent = r.paused ? "Polling is paused; nothing fetched." : r.ok ? `Poll succeeded: ${r.raceCount} races in ${r.durationMs} ms.` : `Poll failed: ${r.errors?.[0] ?? "unknown error"}`;
    renderStatus(); cards.setData({ status }); loadIndex();
  } catch (e) { msg.className = "note bad"; msg.textContent = `Poll request failed: ${e.message}`; }
  finally { for (const id of ["pollnow", "pollfresh"]) $(id).disabled = false; }
}
$("pollnow").addEventListener("click", () => runPoll(false));
$("pollfresh").addEventListener("click", () => runPoll(true));
$("pause").addEventListener("click", async () => {
  const paused = settings?.pollEnabled === false;
  if (!paused && !(await ask({ title: "Pause polling?", body: `<p>The ticker, every graphic and the watch party at ${esc(location.host)} stop getting new AP results until you resume.</p>`, ok: "Pause", danger: true }))) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, pollEnabled: paused }) });
  renderStatus();
  if (!paused) $("pollmsg").textContent = "Paused. Resume polling when ready.";
  else { $("pollmsg").textContent = "Resumed. Polling now…"; runPoll(false); }
});
$("rtype").querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
  const rt = b.dataset.rt;
  const cur = settings?.resultsType ?? settings?.envResultsType ?? "t";
  if (rt === cur) return;
  const body = rt === "l" ? `<p>The ticker, every graphic and the public watch party at ${esc(location.host)} show real AP results from the next poll.</p>` : "<p>Real results are replaced by AP's practice simulation on the next poll.</p>";
  if (!(await ask({ title: rt === "l" ? "Switch to LIVE results?" : "Switch to AP TEST data?", body, ok: rt === "l" ? "Go live" : "Use test data", danger: rt === "l" }))) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, resultsType: rt }) });
  renderStatus(); $("pollmsg").textContent = `Switching to ${rt === "l" ? "LIVE" : "TEST"}: polling now; the bar confirms when the poller has run on the new stream.`;
  await runPoll(false); loadStatus();
}));

// ---------- shared race rendering ----------
const cands = (r) => r.candidates.slice(0, 3).map((c) => `${esc(c.last ?? c.name)} ${c.independent || c.featured ? "(I)" : c.party === "Dem" ? "(D)" : c.party === "GOP" ? "(R)" : ""}${r.totalVotes ? ` ${Number(c.pct).toFixed(1)}%` : ""}`).join(" · ");
const indName = (r) => FEATURED_RACES.find((f) => f.id === r.id)?.who ?? r.candidates.find((c) => c.featured)?.name ?? r.candidates.find((c) => c.independent)?.name ?? null;
const ICON_FEAT = '<span class="sic feat" title="Featured race"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.6-3.2 3 .8 4.4L8 11.5l-3.9 2.1.8-4.4-3.2-3 4.4-.6z" fill="currentColor"/></svg></span>';
const ICON_TICK = '<span class="sic tick" title="On the ticker"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M1 4h14v8H1z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 8h6M11 8h1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>';
const raceLine = (r) => `<span class="lab" title="Race id ${esc(r.label)} · AP race ${esc(r.id)}">${esc(r.label)}</span>${kindBadge(r)}${esc(r.title)}${r.called ? ' <span class="pill call">AP CALL</span>' : ""}${draft.featuredRaceIds.includes(r.id) ? ICON_FEAT : ""}${draft.pinnedRaceIds.includes(r.id) ? ICON_TICK : ""}`;
function raceBand(r, { featured, position = null }) {
  const who = indName(r);
  return `<div class="raceband">${position ? `<span class="pos" title="Position ${position} on the Slate">${position}</span>` : ""}<span class="lab" title="Race id ${esc(r.label)} · AP race ${esc(r.id)}">${esc(r.label)}</span><span class="ttl">${esc(r.stateName)} · ${esc(r.title)}</span>${who ? `<span class="who">${esc(who)}</span>` : ""}
    <span class="meta">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results yet"}${r.called ? " · AP CALL" : ""}${r.rankedChoice ? " · ranked choice" : ""}</span>
    <button class="featbtn" data-pin="${r.id}">${draft.pinnedRaceIds.includes(r.id) ? "Remove from ticker" : "Add to ticker"}</button><button class="featbtn" data-feat="${r.id}">${featured ? "Remove from Slate" : "Put on the Slate"}</button></div>`;
}
const raceName = (id) => { const r = index?.byId?.get(id); return r ? `${r.label} (${r.stateName}, ${r.title})` : `race ${id}`; };
/** Adding or removing a race or chart is a real action: confirm it, then commit. Reorders need no confirmation. */
async function confirmThen(title, body, fn) {
  const ok = await ask({ title, body: `<p>${body}</p><p class="small muted">This changes only this page. The LIVE TICKER changes only when you publish the builder.</p>`, ok: title.replace(/\?$/, "") });
  if (ok) { fn(); commit(); }
}
function toggleFeatured(id) {
  const on = draft.featuredRaceIds.includes(id);
  confirmThen(on ? "Remove from the Slate?" : "Put this race on the Slate?", `${esc(raceName(id))} ${on ? "leaves the Slate." : "gets a row on the Slate with every featured chart."}`,
    () => { draft.featuredRaceIds = on ? draft.featuredRaceIds.filter((x) => x !== id) : [...draft.featuredRaceIds, id]; });
}
/** The catalogs' Add to / Remove from ticker: a race joins the end of the crawl order, or every top-level entry of it goes.
 *  A race that crawls only inside a chunk is removed by editing the chunk. */
function toggleTicker(id) {
  const on = draft.pinnedRaceIds.includes(id);
  const top = draft.tickerItems.some((it) => it.t === "race" && it.id === id);
  if (on && !top) {
    const names = draft.chunks.filter((c) => c.items.some((it) => it.t === "race" && it.id === id)).map((c) => c.name || c.id);
    ask({ title: "This race crawls inside a chunk", body: `<p>${esc(raceName(id))} is in ${names.map((n) => `<b>${esc(n)}</b>`).join(", ")}. Edit the chunk in the Chunks area under the ticker to take it out.</p>`, ok: "OK", info: true }); return;
  }
  confirmThen(on ? "Remove from the ticker?" : "Add to the ticker?", `${esc(raceName(id))} ${on ? "leaves the crawl order." : "joins the end of the crawl order."}`,
    () => { draft.tickerItems = on ? draft.tickerItems.filter((it) => !(it.t === "race" && it.id === id)) : [...draft.tickerItems, { t: "race", id }]; });
}
function toggleChart(id) {
  const chart = CHARTS.find((c) => c.id === id); if (!chart || id === "A1") return;
  const key = chart.kind === "race" ? "featuredCharts" : chart.kind === "other" ? "persistentCharts" : "movementCharts";
  const on = draft[key].includes(id);
  const target = chart.kind === "race" ? "Featured Charts" : chart.kind === "other" ? "Persistent Elements" : overviewName(chart);
  const where = chart.kind === "race" ? "the Slate's chart set (every race on it)" : `the ${target}${chart.kind === "other" ? " section, where its inputs are set" : ""}`;
  confirmThen(on ? `Remove ${id} from ${target}?` : `Add ${id} to ${target}?`, `${esc(chart.id)} ${esc(chart.name)} ${on ? "leaves" : "joins"} ${where}.`,
    () => { const set = new Set(draft[key]); on ? set.delete(id) : set.add(id); draft[key] = CHARTS.filter((c) => set.has(c.id)).map((c) => c.id); if (on && key === "persistentCharts") delete draft.persistentSettings[id]; });
}

// ---------- Ticker section: the crawl order and the chunks ----------
// One list type for both: rows of races, text and (in the crawl order only) chunks, reordered with ▲▼, removed with ✕.
// data-list="seq" is draft.tickerItems; data-list="chunk:<id>" is that chunk's items.
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const chunkById = (id) => draft.chunks.find((c) => c.id === id);
const listFor = (key) => (key === "seq" ? draft.tickerItems : chunkById(key.slice(6))?.items);
const raceTip = (id) => { const r = index?.byId?.get(id); return r ? `${[r.label, r.stateName, r.title].filter(Boolean).join(" · ")}\n${cands(r).replace(/<[^>]+>/g, "")}${r.called ? "\nAP CALL" : ""}` : `race ${id}: not in the current AP feed; the ticker skips it`; };
const short = (t, n = 32) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
/** A condensed piece of a sequence: a race label, a text snippet or a chunk name, each with the full version on hover. */
function seqChip(it, st = draft) {
  if (it.t === "race") { const r = index?.byId?.get(it.id); return `<span class="chip race ${r ? "" : "missing"}" title="${esc(raceTip(it.id))}">${esc(r?.label ?? it.id)}</span>`; }
  if (it.t === "text") return `<span class="chip text" title="${esc(it.text)}">“${esc(short(it.text))}”</span>`;
  const c = st.chunks.find((x) => x.id === it.id);
  return `<span class="chip chunk ${c ? "" : "missing"}" title="${esc(c ? `Chunk ${c.name || c.id}: ${c.items.map((x) => x.t === "race" ? (index?.byId?.get(x.id)?.label ?? x.id) : `“${x.text}”`).join(" · ") || "(empty)"}` : "chunk no longer defined; the ticker skips it")}"><span class="chunktag">CHUNK</span>${esc(c?.name || it.id)}</span>`;
}
function seqRow(it, i, n) {
  const btns = `<div class="btns"><button class="up" ${i === 0 ? "disabled" : ""} title="Move up">▲</button><button class="down" ${i === n - 1 ? "disabled" : ""} title="Move down">▼</button><button class="rm" title="Remove from this list">✕</button></div>`;
  if (it.t === "race") {
    const r = index?.byId?.get(it.id);
    return `<div class="row" data-i="${i}"><div><div class="nm"><span class="ord">${i + 1}</span>${r ? raceLine(r) : `<span class="lab">${esc(it.id)}</span><span class="muted">not in the current AP feed; the ticker skips it</span>`}</div>${r ? `<div class="sub">${cands(r)}</div>` : ""}</div>${btns}</div>`;
  }
  if (it.t === "text") return `<div class="row textrow" data-i="${i}"><div class="nm"><span class="ord">${i + 1}</span><span class="quote" title="${esc(it.text)}">“${esc(it.text)}”</span></div>${btns}</div>`;
  const c = chunkById(it.id);
  return `<div class="row chunkrow" data-i="${i}"><div><div class="nm"><span class="ord">${i + 1}</span><span class="chunktag">CHUNK</span>${c ? `<b>${esc(c.name || c.id)}</b> <span class="muted small">${c.items.length} piece${c.items.length === 1 ? "" : "s"}</span>` : `<span class="muted">chunk no longer defined; the ticker skips it</span>`}</div>${c ? `<div class="chips">${c.items.length ? c.items.map((x) => seqChip(x)).join("") : '<span class="muted small">empty: add races and text in the Chunks area below</span>'}</div>` : ""}</div>${btns}</div>`;
}
function renderSeq() {
  const items = draft.tickerItems;
  const flat = expandTicker(draft);
  $("seqcount").textContent = `${items.length} element${items.length === 1 ? "" : "s"} · ${flat.length} piece${flat.length === 1 ? "" : "s"} crawl`;
  $("seq").innerHTML = items.map((it, i) => seqRow(it, i, items.length)).join("") || `<div class="empty">Nothing in the crawl order: the featured races crawl. Add races, text or a chunk below.</div>`;
  // Like the two boxes above it, the dropdown opens on its helper text; the chunks follow.
  $("chunkpick").innerHTML = `<option value="" selected>${draft.chunks.length ? "Add a chunk: choose one built below" : "Add a chunk: none built yet, build one below"}</option>` + draft.chunks.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.id)} (${c.items.length} piece${c.items.length === 1 ? "" : "s"})</option>`).join("");
  $("addchunkref").querySelector("button").disabled = !draft.chunks.length;
  if (document.activeElement !== $("idletext")) $("idletext").value = draft.idleText;
  $("callhl").value = draft.callHighlight ? "1" : "0";
}
function renderChunks() {
  const box = $("chunks");
  $("chunkcount").textContent = draft.chunks.length ? `${draft.chunks.length}` : "";
  const active = document.activeElement;
  if (box.contains(active) && active.matches(".chunkname")) return;   // typing a name: redraw on blur
  // A picker or text box in a chunk keeps its place through the redraw (a pick or an add redraws the card it sits in).
  const keep = box.contains(active) && active.matches("[data-pick], form[data-addtext] input") ? { chunk: active.closest(".chunk")?.dataset.chunk, pick: active.matches("[data-pick]") } : null;
  box.innerHTML = draft.chunks.map((c) => {
    const uses = draft.tickerItems.filter((it) => it.t === "chunk" && it.id === c.id).length;
    return `<div class="chunk" data-chunk="${esc(c.id)}">
      <div class="chunktop"><span class="chunktag">CHUNK</span><input class="chunkname" value="${esc(c.name)}" maxlength="60" placeholder="Chunk name" title="The name this chunk shows in the crawl order"><span class="muted small">${uses ? `in the crawl ${uses}×` : "not in the crawl"}</span><span class="spacer"></span><button class="addref" title="Place this chunk at the end of the crawl order">Add to crawl</button><button class="rmchunk" title="Delete this chunk; the crawl order drops it">Delete</button></div>
      <div class="list pins seq" data-list="chunk:${esc(c.id)}">${c.items.length ? c.items.map((it, i) => seqRow(it, i, c.items.length)).join("") : '<div class="empty">Empty. Add races and text below.</div>'}</div>
      <div class="filters addfeat"><input data-pick="chunk:${esc(c.id)}" placeholder="Add a race to this chunk: type a label, state or candidate" autocomplete="off"><div class="suggest" hidden></div></div>
      <form class="addmanual" data-addtext="chunk:${esc(c.id)}"><input placeholder="Add text to this chunk" maxlength="240"><button type="submit">Add text</button></form>
    </div>`;
  }).join("") || `<div class="empty">No chunks yet. Name one above to start building it.</div>`;
  if (keep?.chunk) box.querySelector(`.chunk[data-chunk="${keep.chunk}"] ${keep.pick ? "[data-pick]" : "form[data-addtext] input"}`)?.focus();
}
$("chunks").addEventListener("focusout", (e) => { if (e.target.closest(".chunkname")) setTimeout(renderChunks, 450); });   // after the name's debounced commit
// Reorder and remove, in the crawl order and inside every chunk.
document.addEventListener("click", (e) => {
  const list = e.target.closest("[data-list]"); const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!list || !row || !b) return;
  const a = listFor(list.dataset.list); if (!a) return;
  const i = Number(row.dataset.i); if (!(i >= 0 && i < a.length)) return;
  if (b.classList.contains("rm")) a.splice(i, 1);
  else if (b.classList.contains("up") && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  else if (b.classList.contains("down") && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  else return;
  commit();
});
// Text into the crawl order or a chunk.
document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-addtext]"); if (!form) return;
  e.preventDefault();
  const input = form.querySelector("input"); const text = input.value.trim(); if (!text) return;
  const a = listFor(form.dataset.addtext); if (!a) return;
  a.push({ t: "text", id: newId(), text }); input.value = ""; commit();
});
$("addchunkref").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("chunkpick").value; if (!id || !chunkById(id)) { $("chunkpick").focus(); return; }
  draft.tickerItems.push({ t: "chunk", id }); commit();
});
$("newchunk").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("chunkname").value.trim(); if (!name) { $("chunkname").focus(); return; }
  draft.chunks.push({ id: newId(), name, items: [] }); $("chunkname").value = ""; commit();
});
let chunkNameTimer = null;
$("chunks").addEventListener("input", (e) => {
  const inp = e.target.closest(".chunkname"); if (!inp) return;
  const c = chunkById(inp.closest(".chunk").dataset.chunk); if (!c) return;
  c.name = inp.value.trim().slice(0, 60);
  clearTimeout(chunkNameTimer); chunkNameTimer = setTimeout(commit, 400);
});
$("chunks").addEventListener("click", async (e) => {
  const box = e.target.closest(".chunk"); const b = e.target.closest("button"); if (!box || !b) return;
  const c = chunkById(box.dataset.chunk); if (!c) return;
  if (b.classList.contains("addref")) { draft.tickerItems.push({ t: "chunk", id: c.id }); commit(); return; }
  if (b.classList.contains("rmchunk")) {
    const uses = draft.tickerItems.filter((it) => it.t === "chunk" && it.id === c.id).length;
    const ok = await ask({ title: `Delete chunk "${c.name || c.id}"?`, body: `<p>Its ${c.items.length} piece${c.items.length === 1 ? "" : "s"} go with it${uses ? `, and the crawl order loses it in ${uses} place${uses === 1 ? "" : "s"}` : ""}.</p><p class="small muted">This changes only this page. The LIVE TICKER changes only when you publish the builder.</p>`, ok: "Delete chunk", danger: true });
    if (!ok) return;
    draft.chunks = draft.chunks.filter((x) => x.id !== c.id); draft.tickerItems = draft.tickerItems.filter((it) => !(it.t === "chunk" && it.id === c.id)); commit();
  }
});
let idleTimer = null;
$("idletext").addEventListener("input", () => { draft.idleText = $("idletext").value; clearTimeout(idleTimer); idleTimer = setTimeout(commit, 400); });
$("callhl").addEventListener("change", () => { draft.callHighlight = $("callhl").value === "1"; commit(); });
const frame = $("preview"), liveFrame = $("livepreview");
function scalePreviews() { scaleScreens(); }   // the two ticker frames use the Live Screens layout
/** The builder's preview frame gets the builder's four fields by postMessage, so it shows the page, not what is published. */
function sendPreview() {
  renderTickerUrl();
  frame.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  if (index) { const q = buildQueue(index.races, draft); $("previewnote").textContent = `${q.items.length} item${q.items.length === 1 ? "" : "s"}${q.missing.length ? ` · ${q.missing.length} not in the AP feed, skipped` : ""}`; }
}
frame.addEventListener("load", sendPreview);
window.addEventListener("resize", scalePreviews);
// ---------- stylesheet: previewed in this browser, pushed to production by a producer ----------
// The previewed stylesheet is remembered per browser. While it differs from the live one, every preview frame on this
// page carries ?theme= so it paints with it; addresses people copy never do, they follow what is live.
const THEME_LS = "studio.previewTheme";
let previewTheme = (() => { try { const v = localStorage.getItem(THEME_LS); return v && THEMES[v] ? v : null; } catch { return null; } })();
const liveTheme = () => (live?.theme && THEMES[live.theme] ? live.theme : DEFAULT_THEME);
const shownTheme = () => previewTheme ?? liveTheme();
function previewThemeParam() { const t = shownTheme(); return t !== liveTheme() ? t : ""; }
const withTheme = (url) => { const t = previewThemeParam(); return t ? `${url}${url.includes("?") ? "&" : "?"}theme=${encodeURIComponent(t)}` : url; };
function renderTheme() {
  const sel = $("themesel"); if (!sel) return;
  if (!sel.options.length) for (const [id, t] of Object.entries(THEMES)) sel.add(new Option(t.name, id));
  sel.value = shownTheme();
  const previewing = shownTheme() !== liveTheme();
  const st = $("themestate");
  st.textContent = previewing ? `Previewing here · live is ${themeName(liveTheme())}` : "Live";
  st.className = `muted small${previewing ? " preview" : ""}`;
  sel.disabled = !isProducer(); sel.title = isProducer() ? "" : notProducer();
  const pb = $("pushtheme"); producerOnly(pb); if (isProducer()) { pb.disabled = !previewing || !canPublish(); if (!canPublish()) pb.title = NOT_CONFIGURED; }
}
$("themesel").addEventListener("change", () => {
  const v = $("themesel").value; previewTheme = v === liveTheme() ? null : v;
  try { previewTheme ? localStorage.setItem(THEME_LS, previewTheme) : localStorage.removeItem(THEME_LS); } catch {}
  renderTickerFrames(); cards.refreshFrames(); renderAll();   // every preview frame on the page reloads with the stylesheet
});
$("pushtheme").addEventListener("click", async () => {
  if (!isProducer() || !canPublish()) return;
  const id = shownTheme(); if (id === liveTheme()) return;
  const ok = await ask({
    title: "Push this stylesheet to production?", ok: "Push stylesheet", danger: true,
    body: `<p>Every output repaints with <b>${esc(themeName(id))}</b> within about ten seconds: the live ticker, both live screens and every chart address. Nothing else that is published changes.</p><p class="small muted">Live now: ${esc(themeName(liveTheme()))}. The <a href="/styleguide" target="_blank" rel="noopener">style guide</a> shows both.</p>`,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify({ theme: id }) }));
    live = saved; liveSeenAt = saved.updatedAt; liveError = null; previewTheme = null;
    try { localStorage.removeItem(THEME_LS); } catch {}
    renderTickerFrames(); cards.refreshFrames(); renderAll();
  } catch (e) { $("pollmsg").textContent = `Push stylesheet failed: ${e.message}`; }
});

function displayParams(d = secDisplay("ticker")) { const p = new URLSearchParams(); if (d.bg) p.set("bg", d.bg); if (d.opacity !== "100") p.set("opacity", d.opacity); return p; }
/** The two ticker frames: the builder with its own BG, the live one with the section's pair; reload only when the address changes. */
function renderTickerFrames() {
  const sec = secDisplay("ticker");
  const b = `/ticker?preview=1&bg=${pageBg("ticker")}${sec.opacity !== "100" ? `&opacity=${sec.opacity}` : ""}&src=local`;
  { const u = withTheme(b); if (frame.dataset.u !== u) { frame.dataset.u = u; frame.src = u; } }
  frame.parentElement.classList.toggle("checker", !pageBg("ticker"));
  // The published preview shows what is published, on the same Background and Opacity as its Copy Live URL.
  const l = `/ticker?${displayParams({ bg: "", opacity: sec.opacity }).toString()}`;   // no bg: the published one shows
  { const u = withTheme(l); if (liveFrame.dataset.u !== u) { liveFrame.dataset.u = u; liveFrame.src = u; } }
  liveFrame.parentElement.classList.toggle("checker", !(live?.tickerBg ?? "black"));
}
/** The LIVE TICKER's address: fixed; only the display parameters vary. */
/** The permanent address: bare, since the background is published with the ticker; only an opacity other than 100% is added. */
function liveTickerUrl() { const s = displayParams({ bg: "", opacity: secDisplay("ticker").opacity }).toString(); return `${origin()}/ticker${s ? "?" + s : ""}`; }
/** The builder's address: reproduces the ticker on this page with no publish: display parameters, then races by id, calls, items, idle. */
function tickerUrl() {
  const p = displayParams({ bg: pageBg("ticker"), opacity: secDisplay("ticker").opacity });
  // The crawl order with its chunks expanded: a race by its label, text after ~, entries separated by |.
  p.set("seq", expandTicker(draft).map((it) => it.t === "race" ? (index?.byId?.get(it.id)?.label ?? it.id) : `~${it.text.replace(/\|/g, "/")}`).join("|"));
  p.set("calls", draft.callHighlight === false ? "0" : "1");   // the AP Call highlight, always spelled out
  p.set("idle", draft.idleText || DEFAULTS.idleText);   // always spelled out, like calls
  return `${origin()}/ticker?${p.toString()}`;
}
function renderTickerUrl() {
  const u = tickerUrl(); $("tickerurl").textContent = u; $("tickerurl").href = u; $("tickeropen").href = u;
  const l = liveTickerUrl(); $("liveurl").textContent = l; $("liveurl").href = l; $("liveopen").href = l;
}
for (const [btn, fn, label] of [["tickercopy", tickerUrl, "Copy Draft URL"], ["livecopy", liveTickerUrl, "Copy Live URL"]]) $(btn).addEventListener("click", async () => { try { await navigator.clipboard.writeText(fn()); $(btn).textContent = "Copied"; setTimeout(() => ($(btn).textContent = label), 1500); } catch {} });
$("previewframe").addEventListener("click", () => window.open(tickerUrl(), "_blank", "noopener"));
$("liveframe").addEventListener("click", () => window.open(liveTickerUrl(), "_blank", "noopener"));

// ---------- Live Screens ----------
// Two fixed pages, /live-screen-a and /live-screen-b. Each row: the draft on the left (chart, race or state and the
// chart's own parameters, saved on this page), an arrow with Publish and Pull, and the published page on the right.
const SCREEN_PARAMS = {
  B1: [{ k: "cand", label: "Candidate", ph: "last name or AP id; empty = the featured candidate" }],
  B14: [{ k: "a", label: "Left candidate", ph: "last name; empty = the leaders" }, { k: "b", label: "Right candidate", ph: "last name" }],
  B13: [{ k: "who", label: "Who", options: [["ind", "the independent vs the 2024 Democratic vote"], ["main", "the Republican vs the 2024 Trump vote"]] }],
  B11: [{ k: "quote", label: "Quote", ph: "empty = the curated quotes in turn" }, { k: "who", label: "Attribution", ph: "" }],
  A2: [{ k: "name", label: "Name", ph: "" }, { k: "title", label: "Title", ph: "" }],
  D6: [{ k: "context", label: "Context line", ph: "one line under the race" }],
  C9: [{ k: "n", label: "Card number", ph: "0, 1, 2 …" }],
};
const SCREEN_IDS = { screenA: "one", screenB: "two" };
const screenLetter = (key) => (key === "screenA" ? "One" : "Two");
const screenPath = (key) => `/live-screen-${SCREEN_IDS[key]}`;
/** The published page's address: fixed; only the display parameters vary. */
function screenLiveUrl(key) { const s = displayParams({ bg: "", opacity: secDisplay("screens").opacity }).toString(); return `${origin()}${screenPath(key)}${s ? "?" + s : ""}`; }
/** The draft's own address: the chart-id address with the Default Chart Settings, usable anywhere. */
function screenDraftUrl(key) { return origin() + screenAddress(draft[key], { bg: pageBg(key), opacity: secDisplay("screens").opacity }); }
function raceOptions(selected) {
  if (!index) return "";
  const feat = draft.featuredRaceIds.map((id) => index.byId.get(id)).filter(Boolean);
  const opt = (r) => `<option value="${esc(r.label)}" ${selected === r.label ? "selected" : ""}>${esc(r.label)} · ${esc(r.stateName)} · ${esc(r.title)}</option>`;
  return `<optgroup label="On the Slate">${feat.map(opt).join("")}</optgroup><optgroup label="Every race">${index.races.filter((r) => !feat.includes(r)).sort((a, b) => a.label.localeCompare(b.label)).map(opt).join("")}</optgroup>`;
}
function stateOptions(selected) {
  const states = index ? [...new Set(index.races.map((r) => r.state))].sort() : FEATURED_RACES.map((r) => r.state);
  return states.map((s) => `<option ${selected === s ? "selected" : ""}>${s}</option>`).join("");
}
/** The chart specifier: Chart, Race, State (state charts), the chart's own inputs, Background. attr marks the inputs for
 *  their handler (data-sk="screenA" for a Live Screen draft, data-ps="1" for the playlist dialog); bgAttr the Background. */
function specFormHtml(s, attr, bgAttr, bg) {
  const chart = CHARTS.find((c) => c.id === s.chart);
  const groups = [["A", "Persistent elements"], ["B", "Per-race charts"], ["C", "Independent movement"], ["D", "Broad races"], ["F", "AP reports"]];
  const chartSel = `<label>Chart<select ${attr} data-f="chart">${groups.map(([ser, name]) => `<optgroup label="${ser} · ${name}">${CHARTS.filter((c) => c.id[0] === ser && c.built && !c.retired && c.page && c.id !== "A1").map((c) => `<option value="${c.id}" ${s.chart === c.id ? "selected" : ""}>${c.id} ${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>`;
  const needsRace = chart && (chart.kind === "race" || chart.needsRace);
  // The form keeps the same shape whatever the chart: Chart, Race, Background. A chart that draws no single race shows Race greyed out.
  const raceSel = needsRace || chart?.needsState
    ? `<label>Race<select ${attr} data-f="race"><option value="">${chart?.needsState ? "(by state instead)" : "choose a race"}</option>${raceOptions(s.race)}</select></label>`
    : `<label class="na" title="${esc(chart?.name ?? "This chart")} draws every race it needs on its own; it takes no race">Race<select disabled><option>not used by this chart</option></select></label>`;
  const stateSel = chart?.needsState ? `<label>State<select ${attr} data-f="state"><option value="">from the race</option>${stateOptions(s.state)}</select></label>` : "";
  const extra = (SCREEN_PARAMS[s.chart] ?? []).map((p) => p.options
    ? `<label>${esc(p.label)}<select ${attr} data-p="${p.k}"><option value="">default</option>${p.options.map(([v, t]) => `<option value="${v}" ${s.params[p.k] === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`
    : `<label>${esc(p.label)}<input ${attr} data-p="${p.k}" value="${esc(s.params[p.k] ?? "")}" placeholder="${esc(p.ph ?? "")}" maxlength="200"></label>`).join("");
  const bgSel = `<label>Background${selectHtml(bgAttr, BG_OPTIONS, bg)}</label>`;
  return chartSel + raceSel + stateSel + extra + bgSel;
}
function screenForm(key) { return specFormHtml(draft[key], `data-sk="${key}"`, `data-page="${key}"`, pageBg(key)); }
function screenLiveTable(key) {
  const s = live?.[key];
  if (!s) return `<div class="warnline bad">${liveError ? `Cannot read the live screen: ${esc(liveError)}` : "Reading the live screen…"}</div>`;
  const chart = CHARTS.find((c) => c.id === s.chart);
  const rows = [["chart", `${esc(s.chart)} ${esc(chart?.name ?? "")}`], ...(s.race ? [["race", `<span class="lab">${esc(s.race)}</span>`]] : []), ...(s.state ? [["state", esc(s.state)]] : []), ...Object.entries(s.params).map(([k, v]) => [k, esc(v)]), ["background", `${esc(BG_OPTIONS.find(([v]) => v === s.bg)?.[1] ?? s.bg)} <span class="muted">· override on any address with <code>?bg=</code> black, green, capitol, flag, panels or transparent, and <code>&amp;opacity=10..100</code></span>`], ["published", live.updatedAt ? `${esc(fmtTime(live.updatedAt))} (${esc(ago(live.updatedAt))})` : "never: the shipped default is published"]];
  return `<table class="params">${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join("")}</table>`;
}
function buildScreen(key) {
  const letter = screenLetter(key);
  const box = $(key);
  box.innerHTML = `
    <h3 class="screenhead"><span class="pos big" title="Live Screen ${letter}">${key === "screenA" ? 1 : 2}</span>Live Screen ${letter}</h3>
    <div class="screenrow">
      <div class="screen draft">
        <div class="frame clickable" data-open="draft" title="Open the draft at 1920×1080 in a new tab"><iframe title="Live Screen ${letter} draft"></iframe></div>
        <div class="gfoot"><span class="muted small">Draft on this page<span class="samplenote" title="The preview carries sample=auto: while no race in the feed has any votes, it draws made-up numbers so the layout can be seen. Show, Copy Draft URL and the live address read the real feed, which is empty until the count starts."></span></span><span class="spacer"></span><button class="copybtn" data-copy="draft" type="button" title="Copy the draft's address">Copy Draft URL</button><a class="openbtn" data-open="draft" target="_blank" rel="noopener" title="Open the draft at 1920×1080 in a new tab">Show 1920×1080</a></div>
        <div class="smode"><button data-mode="generate" title="Set the chart, race and settings by hand">Generate chart</button><button data-mode="playlist" title="Pick a chart from a playlist; it becomes this draft">Use playlist</button></div>
        <div class="sform"></div>
        <div class="splist" hidden></div>
      </div>
      <div class="screenmid">
        <div class="arrow" aria-hidden="true"><svg viewBox="0 0 64 24" width="72" height="27"><path d="M2 12h50M42 3l10 9-10 9" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <button class="publish" data-act="publish" title="Make this draft the published screen">Publish to Live</button>
        <span class="whynot"></span>
        <div class="arrow back" aria-hidden="true"><svg viewBox="0 0 64 24" width="72" height="27"><path d="M62 12H12M22 3L12 12l10 9" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <button class="pull" data-act="pull" title="Copy the published screen into the draft">Pull from Live</button>
        <span class="pubstate"></span>
      </div>
      <div class="screen onair">
        <div class="frame clickable" data-open="live" title="Open the published screen at 1920×1080 in a new tab"><iframe title="Live Screen ${letter} published"></iframe><span class="lockmark" hidden title="You cannot change what is published from this sign-in">${LOCK.replace('width="11" height="11"', 'width="14" height="14"')}</span></div>
        <div class="gfoot"><span class="muted small">Published now</span><span class="spacer"></span><button class="copybtn" data-copy="live" type="button" title="Copy the permanent address">Copy Live URL</button><a class="openbtn" data-open="live" target="_blank" rel="noopener" title="Open the published screen at 1920×1080 in a new tab">Show 1920×1080</a></div>
        <div class="freshline" hidden></div>
        <p class="tickerurl"><span class="k" title="This address never changes. Point the switcher at it once.">Permanent Address:</span> <a class="url liveaddr" target="_blank" rel="noopener"></a></p>
        <div class="liveparams"></div>
        <p class="muted small">Changes within about 5 seconds of a publish, cross-fading so nothing flashes; a note appears above while the live address has not picked one up yet. Only an authorized publish changes it.</p>
      </div>
    </div>`;
  box.dataset.built = "1";
}
function renderScreens() {
  for (const key of Object.keys(SCREEN_IDS)) {
    const box = $(key);
    if (!box.dataset.built) buildScreen(key);
    // the draft preview reloads only when its address changes; the published frame never reloads
    const dFrame = box.querySelector(".screen.draft iframe");
    const dAddr = screenAddress(draft[key], { bg: pageBg(key), opacity: secDisplay("screens").opacity, sample: "auto", theme: previewThemeParam() });
    if (dFrame.dataset.addr !== dAddr) { dFrame.dataset.addr = dAddr; dFrame.src = dAddr; }
    dFrame.parentElement.classList.toggle("checker", !pageBg(key));
    box.querySelector(".samplenote").textContent = index && !index.races.some((r) => r.totalVotes > 0) ? " · sample numbers until the count starts" : "";
    const oFrame = box.querySelector(".screen.onair iframe");
    const oAddr = `${screenPath(key)}?${displayParams({ bg: "", opacity: secDisplay("screens").opacity }).toString()}`;   // no bg: the published one shows
    { const u = withTheme(oAddr); if (oFrame.dataset.addr !== u) { oFrame.dataset.addr = u; oFrame.src = u; } }
    oFrame.parentElement.classList.toggle("checker", !(live?.[key]?.bg ?? "black"));
    const mode = screenMode[key] ?? "generate";
    box.querySelectorAll(".smode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    const form = box.querySelector(".sform"); form.hidden = mode !== "generate";
    if (!form.contains(document.activeElement)) form.innerHTML = screenForm(key);
    const sp = box.querySelector(".splist"); sp.hidden = mode !== "playlist";
    if (mode === "playlist") renderScreenPlaylist(key, sp);
    box.querySelector("a[data-open=draft]").href = screenDraftUrl(key);
    box.querySelector("a[data-open=live]").href = screenLiveUrl(key);
    const la = box.querySelector(".liveaddr"); la.textContent = screenLiveUrl(key); la.href = screenLiveUrl(key);
    box.querySelector(".liveparams").innerHTML = screenLiveTable(key);
    const changed = live ? JSON.stringify(live[key]) !== JSON.stringify(draft[key]) : false;
    const st = box.querySelector(".pubstate");
    st.className = `pubstate ${live && !changed ? "same" : "dirty"}`;
    st.textContent = !live ? "Published screen not read yet" : changed ? "Draft differs from published" : "Draft matches published";
    const pub = box.querySelector("button[data-act=publish]"), pull = box.querySelector("button[data-act=pull]");
    pub.disabled = !canPublish() || !changed; pub.classList.toggle("noauth", !canPublish());
    pub.innerHTML = `${canPublish() ? "" : LOCK}Publish to Live`;
    box.querySelector(".whynot").textContent = canPublish() ? "" : mayPublish() ? "Not set up on this machine" : "Read-only account";
    pub.title = !canPublish() ? (mayPublish() ? NOT_CONFIGURED : NOT_PUBLISHER) : !changed ? "Nothing to publish: the draft already matches the published screen" : `Make this draft the published screen (${describeScreen(draft[key])})`;
    pull.disabled = !canPull() || !live;
    box.querySelector(".lockmark").hidden = canPublish();
    box.querySelector(".screenmid .arrow:not(.back)").classList.toggle("off", pub.disabled);
  }
  scaleScreens();
}
// A draft from a playlist: pick the person and playlist, click a tile, and that chart spec becomes the draft.
let screenMode = (() => { try { return JSON.parse(localStorage.getItem("studio.screenMode") ?? "null") ?? {}; } catch { return {}; } })();
let screenPl = (() => { try { return JSON.parse(localStorage.getItem("studio.screenPl") ?? "null") ?? {}; } catch { return {}; } })();
const saveScreenPrefs = () => { try { localStorage.setItem("studio.screenMode", JSON.stringify(screenMode)); localStorage.setItem("studio.screenPl", JSON.stringify(screenPl)); } catch {} };
function renderScreenPlaylist(key, sp) {
  if (!playlists) { sp.innerHTML = `<div class="empty">${plError ? `Cannot read the playlists: ${esc(plError)}` : "Reading the playlists…"}</div>`; return; }
  const sel = screenPl[key] ?? {};
  const u = playlists.users.find((x) => x.id === sel.user) ?? playlists.users[0] ?? null;
  const p = u?.playlists.find((x) => x.id === sel.playlist) ?? u?.playlists[0] ?? null;
  const sig = JSON.stringify([u?.id, p?.id, p?.items, draft[key]]);
  if (sp.dataset.sig === sig) return;   // nothing changed: keep the tiles (and their frames) as they are
  sp.dataset.sig = sig;
  sp.innerHTML = `<div class="plbar"><label>Person <select data-spu="${key}">${playlists.users.map((x) => `<option value="${esc(x.id)}" ${x.id === u?.id ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("") || "<option value=''>nobody yet</option>"}</select></label><label>Playlist <select data-spl="${key}">${(u?.playlists ?? []).map((x) => `<option value="${esc(x.id)}" ${x.id === p?.id ? "selected" : ""}>${esc(x.name || x.id)} (${x.items.length})</option>`).join("") || "<option value=''>none yet</option>"}</select></label><span class="spacer"></span><span class="plmeta">Click a chart to make it the draft</span></div>`;
  if (!p?.items.length) { sp.insertAdjacentHTML("beforeend", `<div class="empty">Nothing in this playlist yet. Build it in the Playlists section.</div>`); return; }
  const grid = document.createElement("div"); grid.className = "cardgrid";
  const current = JSON.stringify(draft[key]);
  p.items.forEach((s, i) => {
    const chart = CHARTS.find((c) => c.id === s.chart); if (!chart) return;
    const el = cards.card({ chart, race: specRace(s), params: { ...s.params, ...(s.bg ? { bg: s.bg } : {}) }, section: "screens", priority: 7, open: "show", showRace: false });
    el.classList.add("minicard"); el.dataset.i = i; el.classList.toggle("chosen", JSON.stringify(s) === current);
    el.title = ""; el.querySelector(".thumb").title = `Click to make this the draft: ${describeScreen(s)}`;   // a tile is picked, not opened
    el.querySelector(".ghead").insertAdjacentHTML("afterbegin", `<span class="pos" title="Position ${i + 1}">${i + 1}</span>`);
    el.querySelector(".thumb").insertAdjacentHTML("beforebegin", `<div class="spec" title="${esc(describeScreen(s))}"><b>${esc(s.race || s.state || "")}</b>${s.race || s.state ? " · " : ""}${esc(specLine(s).replace(/^[^·]*· /, ""))}</div>`);
    grid.appendChild(el);
  });
  sp.appendChild(grid);
  cards.prune();
}
document.addEventListener("click", (e) => {
  const mb = e.target.closest(".smode button"); if (mb) { const key = mb.closest(".screenblock").id; screenMode[key] = mb.dataset.mode; saveScreenPrefs(); renderScreens(); return; }
}, true);
// Choosing a tile is done in the capture phase, before the card's own click (which would open the chart in a new tab).
document.addEventListener("click", (e) => {
  const card = e.target.closest(".screen .splist .gcard"); if (!card || e.target.closest(".kebab, .menu")) return;
  e.stopPropagation(); e.preventDefault();
  const key = card.closest(".screenblock").id; const sel = screenPl[key] ?? {};
  const u = playlists?.users.find((x) => x.id === sel.user) ?? playlists?.users[0]; const p = u?.playlists.find((x) => x.id === sel.playlist) ?? u?.playlists[0];
  const s = p?.items[Number(card.dataset.i)]; if (!s) return;
  draft[key] = structuredClone(s); commit();
}, true);
document.addEventListener("change", (e) => {
  const su = e.target.closest("[data-spu]"), sl = e.target.closest("[data-spl]");
  if (su) { screenPl[su.dataset.spu] = { user: su.value, playlist: null }; saveScreenPrefs(); renderScreens(); }
  else if (sl) { const key = sl.dataset.spl; screenPl[key] = { ...(screenPl[key] ?? {}), playlist: sl.value }; saveScreenPrefs(); renderScreens(); }
});
function scaleScreens() { document.querySelectorAll(".screen .frame").forEach((fr) => { const f = fr.querySelector("iframe"); if (f) f.style.transform = `scale(${fr.clientWidth / 1920})`; }); }
window.addEventListener("resize", scaleScreens);
let screenTimer = null;
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-sk]"); if (!el) return;
  const key = el.dataset.sk, s = draft[key];
  if (el.dataset.f === "chart") { s.chart = el.value; s.params = {}; el.blur(); }   // blur so the form redraws at once with the fields this chart needs
  else if (el.dataset.f === "race") s.race = el.value;
  else if (el.dataset.f === "state") s.state = el.value;
  else if (el.dataset.p) { if (el.value.trim()) s.params[el.dataset.p] = el.value; else delete s.params[el.dataset.p]; }
  clearTimeout(screenTimer); screenTimer = setTimeout(commit, el.tagName === "SELECT" ? 0 : 500);
});
document.addEventListener("click", async (e) => {
  const box = e.target.closest(".screenblock"); if (!box) return;
  const key = box.id;
  const copy = e.target.closest("[data-copy]");
  if (copy) { const u = copy.dataset.copy === "live" ? screenLiveUrl(key) : screenDraftUrl(key); const label = copy.textContent; try { await navigator.clipboard.writeText(u); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = label), 1500); } catch {} return; }
  const fr = e.target.closest(".frame[data-open]");
  if (fr) { window.open(fr.dataset.open === "live" ? screenLiveUrl(key) : screenDraftUrl(key), "_blank", "noopener"); return; }
  const act = e.target.closest("button[data-act]")?.dataset.act;
  if (act === "publish") publishScreen(key); else if (act === "pull") pullScreen(key);
});
async function publishScreen(key) {
  if (!canPublish()) return;
  const letter = screenLetter(key);
  let latest = live;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; } catch (e) { liveError = e.message; }
  const same = latest && JSON.stringify(latest[key]) === JSON.stringify(draft[key]);
  const someoneElse = latest && latest.updatedAt !== liveSeenAt;
  const ok = await ask({
    title: `Publish Live Screen ${letter}?`,
    body: `<p><b>${esc(prodHost())}${screenPath(key)}</b> changes to <b>${esc(describeScreen(draft[key]))}</b>${latest ? ` (now ${esc(describeScreen(latest[key]))})` : ""}, within about 5 seconds, cross-fading so nothing flashes; a note under the published screen says when the live address has picked it up. Nothing else is published.</p>
      ${someoneElse ? `<div class="warnline bad">${latest.updatedBy ? esc(latest.updatedBy) : "Someone else"} published at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or published.</div>` : ""}
      ${same ? `<div class="warnline">The draft already matches the published screen.</div>` : ""}`,
    ok: "Publish", danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify({ [key]: draft[key] }) }));
    live = saved; liveSeenAt = saved.updatedAt; liveError = null;
    lastPublished = { updatedAt: saved.updatedAt, blocks: [key] };
    renderAll(); loadReaders();
  } catch (e) {
    await ask({ title: "Publish failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>The published screen is unchanged. The draft is still saved on this page.</p>`, ok: "OK" });
  }
}
async function pullScreen(key) {
  const letter = screenLetter(key);
  let latest;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; }
  catch (e) { liveError = e.message; renderScreens(); await ask({ title: "Can't read the published screen", body: `<div class="warnline bad">${esc(e.message)}</div><p>The draft is unchanged.</p>`, ok: "OK" }); return; }
  const ok = await ask({ title: `Pull Live Screen ${letter} into the draft?`, body: `<p>The draft becomes <b>${esc(describeScreen(latest[key]))}</b>, what is published now${latest.updatedAt ? ` (published ${esc(ago(latest.updatedAt))})` : ""}. Nothing published changes.</p>`, ok: "Pull into the draft", danger: false });
  if (!ok) return;
  liveSeenAt = latest.updatedAt;
  draft = saveLocal({ ...draft, [key]: structuredClone(latest[key]) });
  renderAll(); cards.broadcast(draft);
}

// ---------- Playlists ----------
// Shared state from /api/playlists: people, each with playlists of chart specs. Every edit re-reads the document, applies the
// change and writes the whole thing back, so two people editing different playlists do not overwrite each other by much.
let playlists = null, plError = null;
let plSel = (() => { try { return JSON.parse(localStorage.getItem("studio.playlist") ?? "null") ?? {}; } catch { return {}; } })();
const plUser = () => playlists?.users.find((u) => u.id === plSel.user) ?? playlists?.users[0] ?? null;
const plList = () => { const u = plUser(); return u?.playlists.find((p) => p.id === plSel.playlist) ?? u?.playlists[0] ?? null; };
function plSelect(user, playlist) { plSel = { user, playlist }; try { localStorage.setItem("studio.playlist", JSON.stringify(plSel)); } catch {} renderPlaylists(); }
async function loadPlaylists() {
  try { playlists = normalizePlaylists(await api("/api/playlists")); plError = null; } catch (e) { plError = e.message; }
  renderPlaylists();
  if (Object.values(screenMode).includes("playlist")) renderScreens();
}
/** Re-read, change, write back. mutate(doc) edits in place; returns false to abort. */
async function savePlaylists(mutate, { producerOnly = false } = {}) {
  if (!mayPublish() || (producerOnly && !isProducer())) return false;
  let doc;
  try { doc = normalizePlaylists(await api("/api/playlists")); } catch (e) { await ask({ title: "Can't read the playlists", body: `<div class="warnline bad">${esc(e.message)}</div>`, ok: "OK", info: true }); return false; }
  if (mutate(doc) === false) return false;
  try { playlists = normalizePlaylists(await api("/api/playlists", { method: "PUT", body: JSON.stringify({ users: doc.users }) })); plError = null; }
  catch (e) { await ask({ title: "The change was not saved", body: `<div class="warnline bad">${esc(e.message)}</div><p>The playlists are as they were.</p>`, ok: "OK", info: true }); await loadPlaylists(); return false; }
  renderPlaylists();
  return true;
}
const specLine = (s) => [s.race || s.state, ...Object.entries(s.params ?? {}).map(([k, v]) => `${k}=${v}`), s.bg || "transparent"].filter(Boolean).join(" · ");
/** The race object a spec names, for the card's tag and address; a state chart with only a state gets a stand-in. */
function specRace(s) {
  const chart = CHARTS.find((c) => c.id === s.chart);
  const r = s.race ? index?.races?.find((x) => x.label === s.race) : null;
  if (r) return r;
  if (chart?.needsState && s.state) return { id: "", label: s.state, state: s.state, stateName: s.state, title: "state" };
  if (s.race) return { id: "", label: s.race, state: "", stateName: "", title: "not in the current AP feed" };
  return null;
}
function renderPlaylists() {
  const bar = $("plbar"), body = $("plbody");
  if (!playlists) { bar.innerHTML = ""; body.innerHTML = `<div class="empty">${plError ? `Cannot read the playlists: ${esc(plError)}` : "Reading the playlists…"}</div>`; return; }
  const u = plUser(), p = plList();
  const can = mayPublish(), prod = isProducer();
  bar.innerHTML = `
    <label>Person <select id="pluser">${playlists.users.map((x) => `<option value="${esc(x.id)}" ${x.id === u?.id ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("") || `<option value="">nobody yet</option>`}</select></label>
    <label>Playlist <select id="pllist" ${u ? "" : "disabled"}>${(u?.playlists ?? []).map((x) => `<option value="${esc(x.id)}" ${x.id === p?.id ? "selected" : ""}>${esc(x.name || x.id)} (${x.items.length})</option>`).join("") || `<option value="">none yet</option>`}</select></label>
    ${can && p ? `<button class="primary" id="pladd" title="Add a chart to this playlist: pick the chart, then its race and settings">+ Add chart…</button>` : ""}
    ${prod ? `<button id="plnewuser" title="A new person with their own playlists">New person…</button><button id="plnewlist" ${u ? "" : "disabled"} title="A new playlist for ${esc(u?.name ?? "this person")}">New playlist…</button>${p ? `<button id="plrename" title="Rename this playlist">Rename…</button><button id="pldelete" title="Delete this playlist">Delete…</button>` : ""}` : ""}
    <span class="spacer"></span>
    <span class="plmeta" title="Playlists are shared: everyone in the Studio sees the same ones">${playlists.updatedAt ? `Changed ${esc(ago(playlists.updatedAt))}${playlists.updatedBy ? " by " + esc(playlists.updatedBy) : ""}` : "Shipped playlists; nothing changed yet"}${can ? "" : " · read only"}</span>`;
  if (!p) { body.innerHTML = `<div class="empty">${u ? `${esc(u.name || u.id)} has no playlist yet.${prod ? " Press New playlist…" : ""}` : `No people yet.${prod ? " Press New person…" : ""}`}</div>`; return; }
  const grid = document.createElement("div"); grid.className = "cardgrid";
  p.items.forEach((s, i) => {
    const chart = CHARTS.find((c) => c.id === s.chart); if (!chart) return;
    const race = specRace(s);
    const menu = can ? [
      ...(i > 0 ? [{ label: "Move earlier", onClick: () => plMove(i, -1) }] : []),
      ...(i < p.items.length - 1 ? [{ label: "Move later", onClick: () => plMove(i, 1) }] : []),
      { label: "Edit…", onClick: () => plEdit(i) },
      { label: "Remove from playlist", onClick: () => plRemove(i) },
    ] : [];
    const el = cards.card({ chart, race, params: { ...s.params, ...(s.bg ? { bg: s.bg } : {}) }, section: "playlists", priority: 4, open: "show", showRace: !!race?.id, menu });
    el.classList.add("minicard"); el.dataset.i = i;
    el.querySelector(".ghead").insertAdjacentHTML("afterbegin", `<span class="handle" title="Drag to reorder">⠿</span><span class="pos" title="Position ${i + 1} in ${esc(p.name || "this playlist")}">${i + 1}</span>`);
    el.querySelector(".thumb").insertAdjacentHTML("beforebegin", `<div class="spec" title="${esc(describeScreen(s))}"><b>${esc(s.race || s.state || "")}</b>${s.race || s.state ? " · " : ""}${esc(specLine(s).replace(/^[^·]*· /, ""))}</div>`);
    grid.appendChild(el);
  });
  body.innerHTML = "";
  if (!p.items.length) body.innerHTML = `<div class="empty">Nothing in ${esc(p.name || "this playlist")} yet.${can ? " Press + Add chart…, or send a chart here from the Chart Catalog's ⋯ menu." : ""}</div>`;
  else { body.appendChild(grid); if (can) plDragDrop(grid); }
  cards.prune();
}
/** Reorder by dragging a card's ⠿ handle onto another card: left half drops before it, right half after. */
function plDragDrop(grid) {
  let from = null;
  grid.addEventListener("mousedown", (e) => { const h = e.target.closest(".handle"); if (h) h.closest(".gcard").draggable = true; });
  grid.addEventListener("dragstart", (e) => { const card = e.target.closest(".gcard"); if (!card?.draggable) { e.preventDefault(); return; } from = Number(card.dataset.i); card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(from)); } catch {} });
  grid.addEventListener("dragover", (e) => { const card = e.target.closest(".gcard"); if (from === null || !card) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = card.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; grid.querySelectorAll(".dropbefore, .dropafter").forEach((c) => c.classList.remove("dropbefore", "dropafter")); if (Number(card.dataset.i) !== from) card.classList.add(after ? "dropafter" : "dropbefore"); });
  grid.addEventListener("dragleave", (e) => { const card = e.target.closest(".gcard"); if (card && !card.contains(e.relatedTarget)) card.classList.remove("dropbefore", "dropafter"); });
  grid.addEventListener("drop", (e) => {
    const card = e.target.closest(".gcard"); if (from === null || !card) return; e.preventDefault();
    const r = card.getBoundingClientRect(); const to = Number(card.dataset.i) + (e.clientX > r.left + r.width / 2 ? 1 : 0); const i = from; from = null;
    grid.querySelectorAll(".dragging, .dropbefore, .dropafter").forEach((c) => c.classList.remove("dragging", "dropbefore", "dropafter"));
    if (to === i || to === i + 1) return;
    savePlaylists((doc) => { const list = doc.users.find((x) => x.id === plUser()?.id)?.playlists.find((x) => x.id === plList()?.id); if (!list?.items[i]) return false; const [it] = list.items.splice(i, 1); list.items.splice(to > i ? to - 1 : to, 0, it); });
  });
  grid.addEventListener("dragend", (e) => { from = null; const card = e.target.closest(".gcard"); if (card) { card.draggable = false; card.classList.remove("dragging"); } grid.querySelectorAll(".dropbefore, .dropafter").forEach((c) => c.classList.remove("dropbefore", "dropafter")); });
}
function plMove(i, d) { savePlaylists((doc) => { const list = doc.users.find((x) => x.id === plUser()?.id)?.playlists.find((x) => x.id === plList()?.id); if (!list || !list.items[i] || !list.items[i + d]) return false; [list.items[i], list.items[i + d]] = [list.items[i + d], list.items[i]]; }); }
async function plRemove(i) {
  const p = plList(); const s = p?.items[i]; if (!s) return;
  const ok = await ask({ title: "Remove from the playlist?", body: `<p><b>${esc(describeScreen(s))}</b> leaves <b>${esc(p.name || "this playlist")}</b> (position ${i + 1}).</p>`, ok: "Remove", danger: true });
  if (!ok) return;
  savePlaylists((doc) => { const list = doc.users.find((x) => x.id === plUser()?.id)?.playlists.find((x) => x.id === p.id); if (!list) return false; list.items.splice(i, 1); });
}
async function plEdit(i) {
  const p = plList(); const s = p?.items[i]; if (!s) return;
  const spec = await specDialog(s, { title: `Edit chart ${i + 1} in ${p.name || "this playlist"}`, ok: "Save" });
  if (!spec) return;
  savePlaylists((doc) => { const list = doc.users.find((x) => x.id === plUser()?.id)?.playlists.find((x) => x.id === p.id); if (!list || !list.items[i]) return false; list.items[i] = spec; });
}
async function plAdd(preset = null, target = null) {
  const u = target?.user ?? plUser(), p = target?.playlist ?? plList(); if (!u || !p) return;
  const spec = await specDialog(preset ?? { chart: "B5", race: "", state: "", params: {}, bg: "black" }, { title: `Add a chart to ${p.name || "the playlist"} (${u.name || u.id})`, ok: "Add to playlist" });
  if (!spec) return;
  const ok = await savePlaylists((doc) => { const list = doc.users.find((x) => x.id === u.id)?.playlists.find((x) => x.id === p.id); if (!list) return false; list.items.push(spec); });
  if (ok) plSelect(u.id, p.id);
}
const newPlId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
async function plNewUser() {
  const ok = await ask({ title: "New person", body: `<p><label>Name<br><input id="plname" maxlength="60" placeholder="e.g. Bob" style="width:100%"></label></p><p class="small muted">A person has their own playlists. Everyone in the Studio can see them; producers and publishers can change them.</p>`, ok: "Add person" });
  const name = $("plname")?.value.trim(); if (!ok || !name) return;
  const id = newPlId();
  if (await savePlaylists((doc) => { doc.users.push({ id, name, playlists: [] }); }, { producerOnly: true })) plSelect(id, null);
}
async function plNewList() {
  const u = plUser(); if (!u) return;
  const ok = await ask({ title: `New playlist for ${u.name || u.id}`, body: `<p><label>Name<br><input id="plname" maxlength="60" placeholder="e.g. Segment 1" style="width:100%"></label></p>`, ok: "Add playlist" });
  const name = $("plname")?.value.trim(); if (!ok || !name) return;
  const id = newPlId();
  if (await savePlaylists((doc) => { const user = doc.users.find((x) => x.id === u.id); if (!user) return false; user.playlists.push({ id, name, items: [] }); }, { producerOnly: true })) plSelect(u.id, id);
}
async function plRename() {
  const u = plUser(), p = plList(); if (!u || !p) return;
  const ok = await ask({ title: "Rename the playlist", body: `<p><label>Name<br><input id="plname" maxlength="60" value="${esc(p.name)}" style="width:100%"></label></p>`, ok: "Rename" });
  const name = $("plname")?.value.trim(); if (!ok || !name) return;
  savePlaylists((doc) => { const list = doc.users.find((x) => x.id === u.id)?.playlists.find((x) => x.id === p.id); if (!list) return false; list.name = name; }, { producerOnly: true });
}
async function plDelete() {
  const u = plUser(), p = plList(); if (!u || !p) return;
  const ok = await ask({ title: `Delete "${p.name || p.id}"?`, body: `<p>${esc(u.name || u.id)}'s playlist and its ${p.items.length} chart${p.items.length === 1 ? "" : "s"} go. Nothing published changes.</p>`, ok: "Delete playlist", danger: true });
  if (!ok) return;
  if (await savePlaylists((doc) => { const user = doc.users.find((x) => x.id === u.id); if (!user) return false; user.playlists = user.playlists.filter((x) => x.id !== p.id); }, { producerOnly: true })) plSelect(u.id, null);
}
$("plbar").addEventListener("change", (e) => {
  if (e.target.id === "pluser") plSelect(e.target.value, null);
  else if (e.target.id === "pllist") plSelect(plUser()?.id, e.target.value);
});
$("plbar").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  ({ pladd: () => plAdd(), plnewuser: plNewUser, plnewlist: plNewList, plrename: plRename, pldelete: plDelete })[b.id]?.();
});
/** From a card's ⋯ menu (Chart Catalog, Slate, Races, Movement): choose the person and playlist, then finish the chart's
 *  spec. preset carries what the card already knows, e.g. the Slate card's race. */
async function addToPlaylistFromCatalog(chart, preset = {}) {
  if (!playlists) await loadPlaylists();
  if (!playlists?.users.length) { await ask({ title: "No playlists yet", body: `<p>A producer adds a person and a playlist in the Playlists section first.</p>`, ok: "OK", info: true }); return; }
  const u0 = plUser();
  const body = `<p class="small muted">Chart <b>${esc(chart.id)} ${esc(chart.name)}</b>. Pick where it goes; the next step sets its race and settings.</p>
    <div class="psform"><label>Person<select id="pickuser">${playlists.users.map((x) => `<option value="${esc(x.id)}" ${x.id === u0?.id ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("")}</select></label>
    <label>Playlist<select id="picklist"></select></label></div>`;
  const fill = () => { const u = playlists.users.find((x) => x.id === $("pickuser").value); $("picklist").innerHTML = (u?.playlists ?? []).map((x) => `<option value="${esc(x.id)}" ${x.id === plSel.playlist ? "selected" : ""}>${esc(x.name || x.id)} (${x.items.length})</option>`).join("") || `<option value="">no playlist yet</option>`; };
  const pending = ask({ title: "Add to which playlist?", body, ok: "Next: race and settings" });
  fill(); $("pickuser").addEventListener("change", fill);
  const ok = await pending;
  const user = playlists.users.find((x) => x.id === $("pickuser").value), list = user?.playlists.find((x) => x.id === $("picklist").value);
  if (!ok || !user || !list) return;
  await plAdd({ chart: chart.id, race: preset.race ?? "", state: preset.state ?? "", params: {}, bg: "black" }, { user, playlist: list });
}
// The chart specifier dialog: the same form as a Live Screen draft, editing a pending spec until OK.
let pendingSpec = null;
function renderSpecDialog() {
  $("psform").innerHTML = specFormHtml(pendingSpec, 'data-ps="1"', 'data-ps="1" data-f="bg"', pendingSpec.bg ?? "black");
  $("psdesc").textContent = describeScreen(pendingSpec);
}
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-ps]"); if (!el || !pendingSpec) return;
  if (el.dataset.f === "chart") { pendingSpec.chart = el.value; pendingSpec.params = {}; renderSpecDialog(); return; }
  if (el.dataset.f === "race") pendingSpec.race = el.value;
  else if (el.dataset.f === "state") pendingSpec.state = el.value;
  else if (el.dataset.f === "bg") pendingSpec.bg = el.value;
  else if (el.dataset.p) { if (el.value.trim()) pendingSpec.params[el.dataset.p] = el.value; else delete pendingSpec.params[el.dataset.p]; }
  $("psdesc").textContent = describeScreen(pendingSpec);
});
async function specDialog(spec, { title, ok }) {
  pendingSpec = { chart: spec.chart, race: spec.race ?? "", state: spec.state ?? "", params: { ...(spec.params ?? {}) }, bg: spec.bg ?? "black" };
  let warn = "";
  for (;;) {
    const pending = ask({ title, body: `${warn}<div class="psform" id="psform"></div><p class="psdesc muted" id="psdesc"></p>`, ok });
    renderSpecDialog();
    const confirmed = await pending;
    if (!confirmed) { pendingSpec = null; return null; }
    const chart = CHARTS.find((c) => c.id === pendingSpec.chart);
    const needsRace = chart && (chart.kind === "race" || chart.needsRace);
    if (needsRace && !pendingSpec.race) { warn = `<div class="warnline bad">${esc(chart.name)} draws one race: choose the race.</div>`; continue; }
    if (chart?.needsState && !pendingSpec.race && !pendingSpec.state) { warn = `<div class="warnline bad">${esc(chart.name)} draws one state: choose a race or a state.</div>`; continue; }
    const out = specDef(pendingSpec); pendingSpec = null;
    return out;
  }
}

// ---------- Race Detail section ----------
function renderDetail() {
  if (!index) return;
  $("featcount").textContent = `${draft.featuredRaceIds.length}`;
  $("featured").innerHTML = draft.featuredRaceIds.length ? draft.featuredRaceIds.map((id, i) => {
    const r = index.byId.get(id);
    return `<div class="row" data-id="${id}"><div><div class="nm"><span class="ord">${i + 1}</span>${r ? raceLine(r) : `<span class="lab">${esc(id)}</span><span class="muted">not in the current AP feed</span>`}</div>${r ? `<div class="sub">${esc(r.stateName)}${indName(r) ? " · " + esc(indName(r)) : ""} · ${cands(r)}</div>` : ""}</div>
      <div class="btns"><button class="up" ${i === 0 ? "disabled" : ""}>▲</button><button class="down" ${i === draft.featuredRaceIds.length - 1 ? "disabled" : ""}>▼</button><button class="rm">✕</button></div></div>`;
  }).join("") : `<div class="empty">No featured races. Add one below or from the catalog.</div>`;
  $("chartcount").textContent = `${draft.featuredCharts.length}`;
  $("featcharts").innerHTML = draft.featuredCharts.length ? draft.featuredCharts.map((id, i) => {
    const c = CHARTS.find((x) => x.id === id); if (!c) return "";
    return `<div class="row" data-id="${id}"><div><div class="nm"><span class="ord">${i + 1}</span><span class="lab">${esc(c.id)}</span>${esc(c.name)}${c.built ? "" : ' <span class="pill" style="background:#fdf6ea;color:#8a5a0e">not built yet</span>'}</div></div>
      <div class="btns"><button class="rm" title="Remove from Featured Charts">✕</button></div></div>`;
  }).join("") : `<div class="empty">No featured charts. Add one above or from the Chart Catalog.</div>`;
  const grid = $("racegrid");
  grid.innerHTML = "";
  draft.featuredRaceIds.forEach((id, i) => {
    const r = index.byId.get(id);
    const row = document.createElement("div"); row.className = "racerow";
    if (!r) { row.innerHTML = `<div class="raceband"><span class="pos">${i + 1}</span><span class="lab">${esc(id)}</span><span class="ttl">Not in the current AP feed</span><button class="featbtn" data-feat="${esc(id)}">Remove from Slate</button></div>`; grid.appendChild(row); return; }
    row.innerHTML = raceBand(r, { featured: true, position: i + 1 });
    const cg = document.createElement("div"); cg.className = "cardgrid";
    for (const cid of draft.featuredCharts) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      if (chart.only && !chart.only(r)) continue;
      cg.appendChild(cards.card({ chart, race: r, section: "detail", priority: i === 0 ? 1 : 2, open: "show", menu: [...(mayPublish() ? [{ label: "Add to a playlist…", onClick: () => addToPlaylistFromCatalog(chart, { race: r.label }) }] : []), { label: "Remove from Featured Charts (all races)…", onClick: () => toggleChart(chart.id) }] }));
    }
    if (!cg.children.length) cg.innerHTML = `<div class="empty">No featured charts selected.</div>`;
    row.appendChild(cg); grid.appendChild(row);
  });
  if (!draft.featuredRaceIds.length) grid.innerHTML = `<div class="empty">No featured races. Feature one above or from the Race Catalog and its charts appear here.</div>`;
}
$("featured").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!row || !b) return;
  const a = draft.featuredRaceIds; const i = a.indexOf(row.dataset.id); if (i < 0) return;
  if (b.classList.contains("rm")) { toggleFeatured(row.dataset.id); return; }
  if (b.classList.contains("up") && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  else if (b.classList.contains("down") && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  commit();
});
$("featcharts").addEventListener("click", (e) => { const row = e.target.closest(".row"); if (row && e.target.closest(".rm")) toggleChart(row.dataset.id); });
/** Type-to-add chart picker for the Featured Charts list: per-race charts not yet in the set. */
(() => {
  const input = $("chartq"), box = $("chartsuggest");
  const render = () => {
    const q = input.value.trim().toLowerCase();
    let rows = CHARTS.filter((c) => c.kind === "race" && !c.retired && !draft.featuredCharts.includes(c.id));
    if (q) rows = rows.filter((c) => `${c.id} ${c.name}`.toLowerCase().includes(q));
    box.hidden = false;
    box.innerHTML = rows.length ? rows.map((c) => `<div class="row" data-id="${c.id}"><div><div class="nm"><span class="lab" title="Chart id ${esc(c.id)}">${esc(c.id)}</span>${esc(c.name)}${c.built ? "" : ' <span class="muted small">not built yet</span>'}</div></div><div class="btns"><button>+ Add</button></div></div>`).join("") : `<div class="empty">${q ? "No charts match." : "Every per-race chart is already featured."}</div>`;
  };
  input.addEventListener("input", render); input.addEventListener("focus", render);
  box.addEventListener("mousedown", (e) => { const row = e.target.closest(".row"); if (!row) return; e.preventDefault(); toggleChart(row.dataset.id); input.value = ""; box.hidden = true; });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { box.hidden = true; input.blur(); } if (e.key === "Enter") { e.preventDefault(); const first = box.querySelector(".row"); if (first) { toggleChart(first.dataset.id); input.value = ""; box.hidden = true; } } });
  document.addEventListener("click", (e) => { if (!e.target.closest("#chartq, #chartsuggest")) box.hidden = true; });
})();
/** Type-to-add race picker shared by the ticker and Race Detail: matches label, state, office and
 *  candidate names; with nothing typed it suggests featured races, then races with an independent. */
function racePicker(inputId, boxId, { exclude, onPick }) {
  const input = $(inputId), box = $(boxId);
  const render = () => {
    if (!index) { box.hidden = true; return; }
    const q = input.value.trim().toLowerCase();
    const skip = new Set(exclude());
    let rows = index.races.filter((r) => !skip.has(r.id));
    if (q) rows = rows.filter((r) => `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.officeName} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q));
    else rows = rows.filter((r) => draft.featuredRaceIds.includes(r.id) || r.hasIndependent).sort((a, b) => (draft.featuredRaceIds.includes(b.id) - draft.featuredRaceIds.includes(a.id)) || a.label.localeCompare(b.label));
    rows = rows.slice(0, 12);
    box.hidden = false;
    box.innerHTML = rows.length ? rows.map((r) => `<div class="row" data-id="${r.id}"><div><div class="nm">${raceLine(r)}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div><div class="btns"><button>+ Add</button></div></div>`).join("") + (!q ? `<div class="empty">Type to search all ${index.races.length} races.</div>` : "") : `<div class="empty">No races match.</div>`;
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  box.addEventListener("mousedown", (e) => { const row = e.target.closest(".row"); if (!row) return; e.preventDefault(); onPick(row.dataset.id); input.value = ""; render(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { box.hidden = true; input.blur(); } if (e.key === "Enter") { e.preventDefault(); const first = box.querySelector(".row"); if (first) { onPick(first.dataset.id); input.value = ""; render(); } } });
  document.addEventListener("click", (e) => { if (!e.target.closest(`#${inputId}, #${boxId}`)) box.hidden = true; });
}
/** The same picker for the crawl order and every chunk (data-pick="seq" | "chunk:<id>"): one listener for all of them, since
 *  the chunk editors are redrawn on every change. A pick goes straight into that list, no confirmation: the list is right there. */
(() => {
  const boxOf = (input) => input.parentElement.querySelector(".suggest");
  const render = (input) => {
    const box = boxOf(input); if (!index || !box) { if (box) box.hidden = true; return; }
    const target = listFor(input.dataset.pick) ?? [];
    const skip = new Set(target.filter((it) => it.t === "race").map((it) => it.id));
    const q = input.value.trim().toLowerCase();
    let rows = index.races.filter((r) => !skip.has(r.id));
    if (q) rows = rows.filter((r) => `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.officeName} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q));
    else rows = rows.filter((r) => draft.featuredRaceIds.includes(r.id) || r.hasIndependent).sort((a, b) => (draft.featuredRaceIds.includes(b.id) - draft.featuredRaceIds.includes(a.id)) || a.label.localeCompare(b.label));
    rows = rows.slice(0, 12);
    box.hidden = false;
    box.innerHTML = rows.length ? rows.map((r) => `<div class="row" data-id="${r.id}"><div><div class="nm">${raceLine(r)}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div><div class="btns"><button>+ Add</button></div></div>`).join("") + (!q ? `<div class="empty">Type to search all ${index.races.length} races.</div>` : "") : `<div class="empty">No races match.</div>`;
  };
  const pick = (input, id) => { const a = listFor(input.dataset.pick); if (!a) return; a.push({ t: "race", id }); input.value = ""; commit(); const again = document.querySelector(`[data-pick="${input.dataset.pick}"]`); if (again) { again.focus(); render(again); } };
  document.addEventListener("input", (e) => { const i = e.target.closest("[data-pick]"); if (i) render(i); });
  document.addEventListener("focusin", (e) => { const i = e.target.closest("[data-pick]"); if (i) render(i); });
  document.addEventListener("mousedown", (e) => { const row = e.target.closest(".addfeat .suggest .row"); if (!row) return; const input = row.closest(".addfeat").querySelector("[data-pick]"); if (!input) return; e.preventDefault(); pick(input, row.dataset.id); });
  document.addEventListener("keydown", (e) => { const i = e.target.closest("[data-pick]"); if (!i) return; const box = boxOf(i); if (e.key === "Escape") { box.hidden = true; i.blur(); } if (e.key === "Enter") { e.preventDefault(); const first = box?.querySelector(".row"); if (first) pick(i, first.dataset.id); } });
  document.addEventListener("click", (e) => { if (!e.target.closest(".addfeat")) document.querySelectorAll("[data-pick] ~ .suggest").forEach((b) => (b.hidden = true)); });
})();
racePicker("featq", "featsuggest", { exclude: () => draft.featuredRaceIds, onPick: toggleFeatured });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-feat]"); if (b) toggleFeatured(b.dataset.feat); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-pin]"); if (b) toggleTicker(b.dataset.pin); });

/** A chart added to a DEFAULTS list after this browser saved its workbench joins that list once. studio.knownCharts remembers which
 *  charts this browser has been offered; a browser seeing this code for the first time counts every chart without an `added`
 *  date as already known (they predate the mechanism), so nothing a producer removed on purpose comes back. */
function adoptNewCharts() {
  let known = null;
  try { known = JSON.parse(localStorage.getItem("studio.knownCharts") ?? "null"); } catch {}
  const first = !Array.isArray(known);
  const seen = new Set(first ? CHARTS.filter((c) => !c.added).map((c) => c.id) : known);
  let changed = false;
  for (const c of CHARTS) {
    if (seen.has(c.id) || !c.built || c.retired) continue;
    const key = c.kind === "race" ? "featuredCharts" : c.kind === "other" ? "persistentCharts" : "movementCharts";
    if (DEFAULTS[key].includes(c.id) && !draft[key].includes(c.id)) {
      // keep the shipped order: insert before the first later default that the draft already has
      const after = DEFAULTS[key].slice(DEFAULTS[key].indexOf(c.id) + 1).find((id) => draft[key].includes(id));
      const at = after ? draft[key].indexOf(after) : draft[key].length;
      draft[key].splice(at, 0, c.id); changed = true;
    }
  }
  try { localStorage.setItem("studio.knownCharts", JSON.stringify(CHARTS.map((c) => c.id))); } catch {}
  if (changed) draft = saveLocal(draft);
}

// ---------- Movement and Races ----------
// movementCharts holds both series; the C charts render in Movement, the D charts in Races.
const seriesOf = (id) => id[0];
const overviewName = (chart) => (seriesOf(chart.id) === "D" ? "Races" : "Movement");
function renderMovement() {
  for (const [gridId, series] of [["movegrid", "C"], ["broadgrid", "D"]]) {
    const grid = $(gridId); grid.className = "cardgrid"; grid.innerHTML = "";
    for (const cid of draft.movementCharts.filter((id) => seriesOf(id) === series)) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      const params = chart.id === "D5" && draft.keyRaceIds.length ? { races: draft.keyRaceIds.map((id) => index?.byId?.get(id)?.label ?? id).join(",") } : null;
      grid.appendChild(cards.card({ chart, params, section: series === "D" ? "broad" : "movement", priority: 3, open: "show", menu: [...(mayPublish() ? [{ label: "Add to a playlist…", onClick: () => addToPlaylistFromCatalog(chart) }] : []), { label: `Remove from ${overviewName(chart)}…`, onClick: () => toggleChart(chart.id) }] }));
    }
    if (!grid.children.length) grid.innerHTML = `<div class="empty">Nothing selected. Add ${series} charts from the Chart Catalog below.</div>`;
  }
}

// ---------- Full Catalog ----------
const cfilters = new Set();
const openRaces = new Set();
function cmatches(r) {
  const q = $("cq").value.trim().toLowerCase();
  const st = $("cstate").value, off = $("coffice").value;
  if (st && r.state !== st) return false;
  if (off === "statewide" ? r.kind !== "statewide" : off && r.office !== off) return false;
  if (cfilters.has("ind") && !r.hasIndependent) return false;
  if (cfilters.has("featured") && !draft.featuredRaceIds.includes(r.id)) return false;
  if (cfilters.has("ticker") && !draft.pinnedRaceIds.includes(r.id)) return false;
  if (cfilters.has("called") && !r.called) return false;
  if (cfilters.has("counting") && (r.called || !r.totalVotes)) return false;
  if (q) { const hay = `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.officeName} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase(); if (!hay.includes(q)) return false; }
  return true;
}
function renderCatalog() {
  if (!index) return;
  const rows = index.races.filter(cmatches).sort((a, b) => a.state.localeCompare(b.state) || a.label.localeCompare(b.label));
  $("ccount").textContent = `${rows.length} of ${index.races.length} races`;
  const list = $("catalogList"); list.innerHTML = "";
  for (const r of rows.slice(0, 300)) {
    const crow = document.createElement("div"); crow.className = `crow ${openRaces.has(r.id) ? "open" : ""}`; crow.dataset.id = r.id;
    const featured = draft.featuredRaceIds.includes(r.id);
    const onTicker = draft.pinnedRaceIds.includes(r.id);
    crow.innerHTML = `<div class="row"><div><div class="nm">${raceLine(r)}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div>
      <div class="btns"><span class="nums muted small">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results"}</span><button class="mini ${onTicker ? "on" : ""}" data-pin="${r.id}" title="${onTicker ? "Remove from the ticker" : "Add to the ticker"}">${onTicker ? "✓ Ticker" : "+ Ticker"}</button><button class="mini ${featured ? "on" : ""}" data-feat="${r.id}" title="${featured ? "Remove from the Slate" : "Put on the Slate"}">${featured ? "★ Slate" : "☆ Slate"}</button></div></div>`;
    if (openRaces.has(r.id)) crow.appendChild(catalogBody(r, featured));
    list.appendChild(crow);
  }
  if (rows.length > 300) list.insertAdjacentHTML("beforeend", `<div class="empty">Showing 300. Narrow the search.</div>`);
  if (!rows.length) list.innerHTML = `<div class="empty">No races match.</div>`;
}
function catalogBody(r, featured) {
  const body = document.createElement("div"); body.className = "cbody";
  body.innerHTML = raceBand(r, { featured });
  const cg = document.createElement("div"); cg.className = "cardgrid";
  for (const chart of CHARTS.filter((c) => c.kind === "race")) {
    if (chart.only && !chart.only(r)) continue;
    const el = cards.card({ chart, race: r, section: "catalog", priority: 9, isStatic: true, open: "show" });
    const on = draft.featuredCharts.includes(chart.id);
    el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="featchart" data-chart="${chart.id}" title="Featured charts apply to every featured race">${on ? "★ Featured chart" : "☆ Make featured chart"}</button>`);
    cg.appendChild(el);
  }
  body.appendChild(cg);
  return body;
}
$("catalogList").addEventListener("click", (e) => {
  const fc = e.target.closest(".featchart");
  if (fc) { toggleChart(fc.dataset.chart); return; }
  if (e.target.closest("[data-feat], [data-pin], .gcard")) return;
  const crow = e.target.closest(".crow"); if (!crow || !e.target.closest(".row")) return;
  const id = crow.dataset.id;
  openRaces.has(id) ? openRaces.delete(id) : openRaces.add(id);
  renderCatalog(); cards.prune();
});
for (const id of ["cq", "cstate", "coffice"]) $(id).addEventListener(id === "cq" ? "input" : "change", () => { renderCatalog(); cards.prune(); });
document.querySelectorAll("#catalog .filters .chip").forEach((c) => c.addEventListener("click", () => {
  const f = c.dataset.cf; cfilters.has(f) ? cfilters.delete(f) : cfilters.add(f); c.classList.toggle("on", cfilters.has(f)); renderCatalog(); cards.prune();
}));

// ---------- Persistent Elements (A series, except the ticker) ----------
// Each element's inputs live in draft.persistentSettings[id] and go into its preview and open URLs.
const PERSIST_INPUTS = {
  A2: [{ f: "name", label: "Name", ph: "e.g. Dan Osborn" }, { f: "title", label: "Title", ph: "e.g. Independent candidate, U.S. Senate" }],
  A3: [{ f: "raceId", label: "Race", race: true }],
  A4: [{ f: "raceId", label: "Race", race: true, ph: "latest featured call (leave empty)" }],
};
function renderPersistent() {
  const grid = $("persistgrid"); grid.innerHTML = "";
  for (const id of draft.persistentCharts) {
    const chart = CHARTS.find((c) => c.id === id); if (!chart) continue;
    const st = draft.persistentSettings[id] ?? {};
    const race = st.raceId ? index?.byId?.get(st.raceId) ?? null : null;
    const el = cards.card({ chart, race, params: id === "A2" ? { name: st.name, title: st.title } : null, section: "persistent", priority: 4, showRace: !!race, open: "show", menu: [{ label: "Remove from Persistent Elements…", onClick: () => toggleChart(chart.id) }] });
    const inputs = PERSIST_INPUTS[id] ?? [];
    if (inputs.length) {
      const form = document.createElement("div"); form.className = "pform";
      form.innerHTML = inputs.map((i) => i.race
        ? `<label>${i.label}<select data-pid="${id}" data-f="${i.f}"><option value="">${esc(i.ph ?? "choose a race")}</option>${draft.featuredRaceIds.map((rid) => { const r = index?.byId?.get(rid); return r ? `<option value="${rid}" ${st.raceId === rid ? "selected" : ""}>${esc(r.label)} · ${esc(r.stateName)}</option>` : ""; }).join("")}${index ? `<optgroup label="Any race">${index.races.filter((r) => r.kind === "federal" && !draft.featuredRaceIds.includes(r.id)).slice(0, 500).map((r) => `<option value="${r.id}" ${st.raceId === r.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</optgroup>` : ""}</select></label>`
        : `<label>${i.label}<input data-pid="${id}" data-f="${i.f}" value="${esc(st[i.f] ?? "")}" placeholder="${esc(i.ph ?? "")}" maxlength="120"></label>`).join("");
      el.appendChild(form);
    }
    grid.appendChild(el);
  }
  if (!grid.children.length) grid.innerHTML = `<div class="empty">Nothing selected. Add lower thirds and strips from the Chart Catalog below.</div>`;
}
let pformTimer = null;
$("persistgrid").addEventListener("input", (e) => {
  const i = e.target.closest("[data-pid]"); if (!i) return;
  const id = i.dataset.pid; draft.persistentSettings[id] = { ...(draft.persistentSettings[id] ?? {}), [i.dataset.f]: i.value };
  clearTimeout(pformTimer); pformTimer = setTimeout(() => { draft = saveLocal(normalize(draft)); renderPersistent(); cards.prune(); cards.broadcast(draft); }, i.tagName === "SELECT" ? 0 : 600);
});
$("persistgrid").addEventListener("change", (e) => { const i = e.target.closest("select[data-pid]"); if (i) i.dispatchEvent(new Event("input", { bubbles: true })); });

// ---------- Chart Catalog ----------
function renderChartCatalog() {
  const sample = draft.featuredRaceIds.map((id) => index?.byId?.get(id)).find(Boolean) ?? index?.races?.find((r) => r.featured) ?? null;
  for (const [gridId, kind, series] of [["chartsA", "other", "A"], ["chartsRace", "race", "B"], ["chartsMove", "movement", "C"], ["chartsBroad", "movement", "D"], ["chartsF", "other", "F"]]) {
    const grid = $(gridId); grid.innerHTML = "";
    for (const chart of CHARTS.filter((c) => c.kind === kind && seriesOf(c.id) === series)) {
      const key = kind === "race" ? "featuredCharts" : kind === "other" ? "persistentCharts" : "movementCharts";
      const on = draft[key].includes(chart.id);
      const toPlaylist = chart.built && !chart.retired && chart.page && chart.id !== "A1" && mayPublish() ? [{ label: "Add to a playlist…", onClick: () => addToPlaylistFromCatalog(chart) }] : [];
      const el = cards.card({ chart, race: kind === "race" || chart.needsRace || chart.needsState ? sample : null, section: "charts", priority: 6, showRace: false, menu: toPlaylist });
      el.classList.add("minicard"); el.classList.toggle("inuse", on);
      if (chart.retired) el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">Retired · id reserved</span>`);
      else if (chart.unavailable) el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">${esc(chart.unavailable)}</span>`);
      else if (chart.id === "A1") { el.classList.add("inuse"); el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<a class="mini on" href="#ticker">★ Managed in Ticker</a>`); }
      else if (series === "F") el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">Reference page</span>`);
      else if (series === "A") el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="mini ${on ? "on" : ""} featchart" data-chart="${chart.id}" title="Shown in Persistent Elements with its inputs">${on ? "✓ In Persistent" : "+ Add to Persistent"}</button>`);
      else el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="mini ${on ? "on" : ""} featchart" data-chart="${chart.id}" title="${kind === "race" ? "Featured charts apply to every featured race" : `Shown in the ${overviewName(chart)}`}">${on ? (kind === "race" ? "★ Featured" : "✓ In Overview") : (kind === "race" ? "☆ Feature" : "+ Add to Overview")}</button>`);
      if ("BCD".includes(series)) el.querySelector(".copybtn")?.remove();   // a catalog chart has no race of its own: its address would be worthless
      grid.appendChild(el);
    }
  }
  if (sample) $("chartsRace").insertAdjacentHTML("afterbegin", `<div class="muted small" style="grid-column:1/-1">Previews use ${esc(sample.label)}, the first featured race. Gold outline = in use.</div>`);
}
$("charts").addEventListener("click", (e) => { const fc = e.target.closest(".featchart"); if (fc) toggleChart(fc.dataset.chart); });

// ---------- the (i) panels: what the strips' controls do, in plain English (the same words as their hover titles) ----------
function infoToggle(btnId, panelId, html) {
  const btn = $(btnId), panel = $(panelId);
  if (!btn || !panel) return;
  btn.onclick = () => { const open = panel.hidden; panel.innerHTML = html(); panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
}
const POLL_INFO = () => `<dl>
  <dt>Poll now</dt><dd>Fetches the latest results from AP this second instead of waiting for the next minute. The status bar updates when it finishes.</dd>
  <dt>Reset caches</dt><dd>Drops the in-memory copies of the curated candidate and photo files, then polls. Use it after those files change on GitHub.</dd>
  <dt>Pause polling</dt><dd>Stops fetching new AP results for the ticker, every graphic and the watch party until you press Resume. Everything keeps showing the last data.</dd>
  <dt>Data Stream</dt><dd><b>Test</b> is AP's practice simulation, <b>Live</b> is real results. Switching polls at once; the status bar confirms when the new stream has been read. Going Live also switches the rehearsal password off.</dd>
  <dt>Who can use them</dt><dd>These change what the poller does for every output, so they need a producer password. Publisher and read-only sign-ins see them locked.${runtime ? " On a laptop they appear only once it has been promoted to production; until then the website's Studio has them." : ""}</dd>
</dl>`;
const STANDBY_INFO = () => `<dl>
  <dt>Standby</dt><dd>This laptop copies the website's results, poller status and published ticker into its own files every ${esc(String(runtime?.mirror?.every ?? 30))} seconds, making no AP requests, so it can take over at any moment. Its ticker and graphics show the website's live ticker meanwhile.</dd>
  <dt>Copy taken</dt><dd>How old the local copy is, and the time of the results in it.</dd>
  <dt>Website</dt><dd>Whether ${esc(hostOf(runtime?.deployment?.origin))} is answering from here.</dd>
  <dt>This laptop</dt><dd>Its address on the studio network: what the switcher's browser inputs are pointed at after a promote, with the website's paths (/ticker, /g/B5?race=…).</dd>
  <dt>Promote</dt><dd>Makes this laptop production without a restart: copying stops, it polls AP itself every minute, its outputs switch to its own copy, and this strip turns orange with the address to use. Producer password only. The dialog warns if the website is still answering, because its poller and this laptop would then share one AP key.</dd>
  <dt>Return to standby</dt><dd>Reverses a promote: polling here stops and copying resumes. Point the switcher back at the website.</dd>
</dl>`;
infoToggle("pollinfobtn", "pollinfo", POLL_INFO);

// ---------- laptop: standby (mirroring production) or production (promoted) ----------
const hostOf = (u) => String(u ?? "").replace(/^https?:\/\//, "");
function renderStandby() {
  const el = $("standby");
  if (!el) return;
  if (!runtime || !runtime.standby) { el.hidden = true; $("standbyinfo").hidden = true; return; }   // the website, or a machine started as production
  el.hidden = false;
  const lanLink = `<a href="${esc(runtime.lan)}/studio" target="_blank" rel="noopener" title="This laptop's Studio over the network">${esc(hostOf(runtime.lan))}</a>`;
  const dep = runtime.deployment ?? {};
  const wasOpen = $("standbyinfo") && !$("standbyinfo").hidden;
  const info = `<button class="info" id="standbyinfobtn" type="button" aria-expanded="${wasOpen}" aria-controls="standbyinfo" title="What this strip and its buttons mean">i</button>`;
  if (runtime.production?.where === "self") {
    el.className = "standby prod";
    el.innerHTML = `<span class="k">PRODUCTION · THIS LAPTOP</span>${info}
      <span title="This laptop polls AP itself and serves its own files">Polling AP every ${esc(String(runtime.poll?.every ?? 60))} s</span>
      <span title="Point the switcher's browser inputs here, with the website's paths">Switcher → <b>${lanLink}</b></span>
      <span class="site" title="${dep.reachable ? "Its poller and this laptop now share one AP key" : `Whether ${esc(hostOf(dep.origin))} answers from here`}"><span class="dot ${dep.reachable ? "warn" : "bad"}"></span>${dep.reachable ? '<span class="bad">Website answering again</span>' : "Website not reachable"}</span>
      ${runtime.canDemote ? `<button id="demote" title="Stop polling here and go back to copying the website">Return to standby</button>` : ""}`;
  } else {
    const m = runtime.mirror;
    el.className = `standby${dep.reachable === false ? " warn" : ""}`;
    const copy = runtime.mode !== "mirror" ? '<span class="bad">Not copying</span> (--no-mirror)'
      : m?.lastOk ? `Copy taken ${esc(ago(new Date(m.lastOk).toISOString()))} · results ${esc(fmtTime(m.indexGenerated))}`
      : m?.lastError ? `<span class="bad">Mirror failing:</span> ${esc(m.lastError)}` : "First copy in progress…";
    el.innerHTML = `<span class="k">STANDBY</span>${info}
      <span title="This laptop's copy of the website's data, refreshed every ${esc(String(m?.every ?? 30))} s with no AP requests">${copy}</span>
      <span class="site" title="Whether ${esc(hostOf(dep.origin))} answers from here"><span class="dot ${dep.reachable ? "" : "bad"}"></span>Website ${dep.reachable ? "reachable" : '<span class="bad">NOT reachable</span>'}</span>
      <span title="This laptop's address on the studio network, for the switcher after a promote">This laptop <b>${lanLink}</b>${runtime.iface ? ` (${esc(runtime.iface)})` : ""}</span>
      ${runtime.canPromote ? `<button id="promote" class="danger" title="This laptop becomes production: it polls AP itself and serves its own copy">Promote: make this laptop production</button>` : ""}`;
  }
  infoToggle("standbyinfobtn", "standbyinfo", STANDBY_INFO);
  if (wasOpen) $("standbyinfo").innerHTML = STANDBY_INFO();
  const pb = $("promote"), db = $("demote");
  if (pb) { producerOnly(pb); pb.addEventListener("click", promoteLaptop); }
  if (db) { producerOnly(db); db.addEventListener("click", demoteLaptop); }
}
async function refreshRuntime() { runtime = await fetch("/api/runtime", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); }
async function promoteLaptop() {
  if (!isProducer() || !runtime?.canPromote) return;
  const dep = runtime.deployment ?? {}, m = runtime.mirror;
  const ok = await ask({
    title: "Make this laptop production?", ok: "Promote", danger: true,
    body: `<p>This laptop stops copying from <b>${esc(hostOf(dep.origin))}</b> and polls AP itself, every minute, into its own files. Its ticker and graphics switch to that copy at once${m?.lastOk ? `, taken ${esc(ago(new Date(m.lastOk).toISOString()))}` : ""}. Publishing from this Studio then changes this laptop's ticker.</p>
      <p><b>Then point the switcher's browser inputs at ${esc(hostOf(runtime.lan))}</b>, keeping the website's paths (/ticker, /g/B5?race=…). Use that address, not localhost.</p>
      ${dep.reachable ? `<div class="warnline bad">The website is still answering. Its poller and this laptop would then share one AP key, which allows ten requests a minute; two pollers exceed that and both start being refused. Promote only when the website is down, or pause polling in the website's Studio first.</div>` : `<div class="warnline">The website is not answering, which is what this is for.</div>`}`,
  });
  if (!ok) return;
  try { await api("/api/promote", { method: "POST" }); } catch (e) { $("pollmsg").textContent = `Promote failed: ${e.message}`; }
  await refreshRuntime(); renderAll();
}
async function demoteLaptop() {
  if (!isProducer() || !runtime?.canDemote) return;
  const ok = await ask({
    title: "Return this laptop to standby?", ok: "Return to standby",
    body: `<p>Polling AP from this laptop stops and it goes back to copying <b>${esc(hostOf(runtime.deployment?.origin))}</b> every 30 seconds. Its ticker and graphics read the website again.</p><p>Point the switcher's inputs back at the website.</p>`,
  });
  if (!ok) return;
  try { await api("/api/demote", { method: "POST" }); } catch (e) { $("pollmsg").textContent = `Return to standby failed: ${e.message}`; }
  await refreshRuntime(); renderAll();
}

// ---------- render everything ----------
function renderAll() {
  renderStatus();
  renderTheme();
  renderLive();
  renderSeq(); renderChunks(); sendPreview(); renderScreens(); renderPlaylists();
  renderDetail(); renderMovement(); renderPersistent(); renderCatalog(); renderChartCatalog();
  cards.prune();
}
// highlight the section in view
const secObs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) document.querySelectorAll("#sectionnav a").forEach((a) => a.classList.toggle("here", a.getAttribute("href") === `#${e.target.id}`));
}, { rootMargin: "-120px 0px -60% 0px" });
for (const id of ["ticker", "screens", "playlists", "detail", "broad", "movement", "persistent", "catalog", "charts"]) secObs.observe($(id));

// ---------- boot ----------
let timers = [];
async function boot() {
  timers.forEach(clearInterval);
  draft = readLocal() ?? normalize(DEFAULTS);
  adoptNewCharts();
  renderDisplayControls(); renderTickerFrames();   // the builder frame is fed by postMessage; the live one reads what is published
  scalePreviews();
  const loadRuntime = async () => { runtime = await fetch("/api/runtime", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); };
  await loadRuntime();
  await Promise.all([loadStatus(), loadIndex(), loadLive(), loadReaders(), loadPlaylists()]);
  renderAll();
  timers = [setInterval(loadStatus, 15_000), setInterval(loadIndex, 60_000), setInterval(loadLive, 20_000), setInterval(loadReaders, 5_000), setInterval(renderFresh, 1_000), setInterval(loadPlaylists, 30_000), setInterval(loadRuntime, 30_000), setInterval(() => { renderStatus(); renderLive(); }, 10_000)];
}
(async () => {
  const me = await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  if (!me.authed) { toLogin(me.rehearsalAllowed === false ? "rehearsal" : undefined); return; }   // the server let the page through on the cookie alone; the API applies the Live rule
  loginKind = me.testLogin ? "test" : "prod"; loginRole = me.role ?? null; loginName = me.name ?? null; renderWho();
  showApp(); boot();
})();
