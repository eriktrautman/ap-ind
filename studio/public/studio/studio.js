// Control room: status bar and poller controls, the LIVE TICKER and the Ticker Builder (the one thing that is
// published), and the sections that organise this browser's view of the graphics (Featured Races, overviews, catalogs).
import { buildQueue } from "/ticker-queue.js";
import { DEFAULTS, CHARTS, FEATURED_RACES, normalize, diffState, readLocal, saveLocal, screenAddress, describeScreen } from "/g/control.js";
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
  if (res.status === 401) { const wasTest = loginKind === "test"; loginKind = null; showLogin(); loginHint(wasTest); throw new Error("signed out"); }
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
};

// ---------- dialog ----------
function ask({ title, body, ok = "Confirm", danger = false }) {
  const dlg = $("dlg");
  if (dlg.open) dlg.close();
  $("dlgtitle").textContent = title;
  $("dlgbody").innerHTML = body;
  $("dlgok").textContent = ok;
  $("dlgok").className = danger ? "danger" : "primary";
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
/** Tell people on the sign-in page why the rehearsal password will not work, and why they were signed out. */
async function loginHint(wasTest, me = null) {
  const hint = $("loginhint");
  try { me = me ?? await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()); } catch { me = {}; }
  const live = me.rehearsalAllowed === false;
  hint.hidden = !live;
  hint.innerHTML = !live ? "" : wasTest
    ? "<b>You were signed out:</b> you were using the rehearsal password and results have just gone <b>Live</b>. The rehearsal password is switched off from here on. Sign in with the real password to continue."
    : "Results are <b>Live</b>, so the rehearsal password is switched off. Only the real password signs in.";
}
function showLogin() { $("login").hidden = false; $("app").hidden = true; $("logout").hidden = true; $("poller").hidden = true; }
function showApp() { $("login").hidden = true; $("app").hidden = false; $("logout").hidden = false; $("poller").hidden = false; }
$("loginform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginerr").textContent = "";
  try {
    const me = await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    loginKind = me.kind ?? "prod";
    $("password").value = "";
    showApp(); boot();
  } catch (err) { $("loginerr").textContent = err.message === "wrong password" ? "Wrong password." : err.message; loginHint(false); }
});
$("logout").addEventListener("click", async () => { await fetch("/api/login", { method: "DELETE" }); loginKind = null; showLogin(); });
// The sticky header's height changes with the banners; anchor jumps from the
// section nav must clear it, so its measured height drives scroll-padding-top on <html>.
new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", `${document.querySelector("header.top").offsetHeight + 8}px`)).observe(document.querySelector("header.top"));
// Which password signed in: "prod" or "test". A test sign-in is flagged in the banner row.
let loginKind = null;

// ---------- data ----------
let status = null, settings = null, index = null;
let runtime = null;           // from /api/runtime on a laptop (npm start); null on the deployment, where the live ticker is this site's
let live = null;              // the LIVE TICKER's parameters as last read (normalized), or null if never read
let liveSeenAt = null;        // updatedAt of the live ticker when this page last pulled or published
let liveError = null;         // why the live ticker is unreadable right now, or null
let draft = normalize(DEFAULTS);   // everything on this page, saved in this browser. Only the ticker builder's four fields are ever published.
const TICKER_FIELDS = ["pinnedRaceIds", "callHighlight", "manualItems", "idleText"];
const tickerPart = (s) => Object.fromEntries(TICKER_FIELDS.map((k) => [k, structuredClone(s[k])]));
const tickerDiff = (from, to) => diffState(from, to).filter((c) => TICKER_FIELDS.includes(c.field));
/** The page's featured races as race ids for chart addresses, or null when they are the shipped ones (then addresses stay short). */
const featuredLabels = () => draft.featuredRaceIds.join() === DEFAULTS.featuredRaceIds.join() ? null : draft.featuredRaceIds.map((id) => index?.byId?.get(id)?.label ?? id);
const cards = createCardManager({ maxLive: 32, getBg: () => $("bg").value, getOpacity: () => $("opacity").value, getOrigin: () => origin(), getRaces: featuredLabels, getDraft: () => draft });
cards.onBudget((live, wanting) => { $("thumbbudget").textContent = wanting > live ? `${live} of ${wanting} previews live (at most 32 at once)` : live ? `${live} live previews` : ""; });

async function loadStatus() {
  try { const r = await fetch(`/data/status.json?t=${Math.floor(Date.now() / 15_000)}`, { cache: "no-store" }); const next = r.ok ? await r.json() : null; status = next?.generated ? next : null; } catch {}
  try { settings = await api("/api/settings"); } catch {}
  renderStatus();
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

// ---------- state model: this page is a workbench; only the ticker builder is published, to the one live ticker ----------
const otherOperator = () => live && liveSeenAt !== live.updatedAt;
/** Producer actions (publish, poll, pause, Test/Live) need the real password; the rehearsal sign-in only looks. */
const isProducer = () => loginKind === "prod";
const canPublish = () => isProducer() && (runtime ? !!runtime.production?.canPush : true);
const LOCK = '<svg class="lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const NOT_PRODUCER = "Producer only. You are signed in with the rehearsal password; this needs the real password.";
const NOT_CONFIGURED = "You are not authorized to publish from this computer. Publishing needs the live ticker's password to be set up on this machine by the engineer. You can still use this ticker by its address, and pull from the live ticker.";
/** Grey out a producer-only control for the current sign-in. */
function producerOnly(el) {
  el.disabled = !isProducer(); el.classList.toggle("noauth", !isProducer()); if (!isProducer()) el.title = NOT_PRODUCER;
  const has = !!el.querySelector(".lock");
  if (!isProducer() && !has) el.insertAdjacentHTML("afterbegin", LOCK); else if (isProducer() && has) el.querySelector(".lock").remove();
}
const canPull = () => runtime ? !!runtime.production?.canPull : !liveError;
// The live ticker is always named by its web address: on the website that is this site; on a laptop it is
// the website it points at, or the laptop itself (GLOBAL=self).
const prodHost = () => runtime ? (runtime.production?.where === "self" ? `${location.host} (this laptop)` : runtime.production?.origin?.replace(/^https?:\/\//, "") ?? "the website") : location.host;
const onSite = () => !runtime;
const origin = () => (onSite() ? location.origin : runtime?.production?.origin ?? location.origin);
const BUILDER = "the builder's races and order, AP Call highlight, manual items and idle text";

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
    `<b>Live Ticker.</b> One permanent address, <code>${esc(host)}/ticker</code>. Build a ticker in the Ticker Builder, use it by its own link, or publish it to become the live ticker; it updates on air within seconds.`,
    `<b>Live Screens.</b> Two permanent addresses for full-screen charts. Build the draft on the left and publish it to the on-air screen on the right.`,
    `<b>Collect what you need.</b> Feature races and charts to keep them close in the sections above the catalogs. This organises your view only and is never published.`,
    `<b>Producer actions</b> (publish, poll, Test/Live) need the real password; the rehearsal password can look but not change anything on air.`,
    `<b>Restore All Default Settings</b> resets this page, never the live ticker or screens.`,
  ].map((x) => `<li>${x}</li>`).join("");
}

/** The LIVE TICKER block: what it is crawling right now and when that was published. */
function renderLive() {
  renderHow();
  const box = $("liveparams");
  if (!live) box.innerHTML = `<div class="warnline bad">${liveError ? `Cannot read the live ticker: ${esc(liveError)}` : "Reading the live ticker…"}</div>`;
  else {
    const labels = live.pinnedRaceIds.map((id) => index?.byId?.get(id)?.label ?? id);
    box.innerHTML = `<table class="params">
      <tr><td class="k" title="races: race ids in crawl order">races</td><td>${labels.map((l) => `<span class="lab">${esc(l)}</span>`).join(" ")}</td></tr>
      <tr><td class="k" title="calls: 1 highlights AP Calls yellow, 0 does not">calls</td><td>${live.callHighlight ? "1 · AP Calls highlighted yellow" : "0 · no highlight"}</td></tr>
      <tr><td class="k" title="item: manual items, one after every two races">item</td><td>${live.manualItems.length ? live.manualItems.map((m) => `<div>${esc(m.text)}</div>`).join("") : '<span class="muted">none</span>'}</td></tr>
      <tr><td class="k" title="idle: the line that crawls when there is nothing else">idle</td><td>${esc(live.idleText || DEFAULTS.idleText)}</td></tr>
      <tr><td class="k">published</td><td>${live.updatedAt ? `${esc(fmtTime(live.updatedAt))} (${esc(ago(live.updatedAt))})` : "never: the shipped defaults are live"}</td></tr>
    </table>`;
  }
  renderPublishState();
  renderScreens();
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
  $("pubwhy").textContent = canPublish() ? "" : isProducer() ? "Not set up on this machine" : "Read-only account";
  $("publish").title = !canPublish() ? (isProducer() ? NOT_CONFIGURED : NOT_PRODUCER) : !changes.length ? "Nothing to publish: the builder already matches the live ticker" : `Replace the live ticker's parameters with the builder's (${changes.length} change${changes.length === 1 ? "" : "s"})`;
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
    body: `<p><b>${esc(host)}/ticker</b> takes ${BUILDER}. It changes within 5 seconds, at the next item boundary, without restarting the crawl. Nothing else on this page is published, and tickers built from an address are not affected.</p>
      ${changeList(changes)}
      <p class="small muted">Last published: ${latest?.updatedAt ? esc(fmtTime(latest.updatedAt)) + " (" + esc(ago(latest.updatedAt)) + ")" : "never"}.</p>
      ${someoneElse ? `<div class="warnline bad">Someone else published at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or published. Publishing now replaces their ticker. Press Cancel and Pull if you want to see it first.</div>` : ""}
      ${!changes.length ? `<div class="warnline">The builder already matches the live ticker.</div>` : ""}`,
    ok: "Publish", danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify(tickerPart(draft)) }));
    live = saved; liveSeenAt = saved.updatedAt; liveError = null;
    renderAll();
  } catch (e) {
    await ask({ title: "Publish failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>The live ticker is unchanged. The builder is still saved on this page.</p>`, ok: "OK" });
  }
}
async function pull() {
  let latest;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; }
  catch (e) { liveError = e.message; renderLive(); await ask({ title: "Can't read the live ticker", body: `<div class="warnline bad">${esc(e.message)}</div><p>The builder is unchanged.</p>`, ok: "OK" }); return; }
  const changes = tickerDiff(draft, latest);
  const ok = await ask({
    title: "Pull from the LIVE TICKER?",
    body: `<p>${BUILDER[0].toUpperCase() + BUILDER.slice(1)} are replaced by the live ticker's (published ${latest.updatedAt ? esc(ago(latest.updatedAt)) : "never, so they are the defaults"}). Nothing on air changes.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">The builder already matches the live ticker.</div>` : ""}`,
    ok: "Pull into the builder", danger: changes.length > 0,
  });
  if (!ok) return;
  liveSeenAt = latest.updatedAt;
  draft = saveLocal({ ...draft, ...tickerPart(latest) });
  renderAll(); cards.broadcast(draft);
}
async function restoreDefaults() {
  const changes = diffState(draft, DEFAULTS);
  const ok = await ask({ title: "Restore the defaults on this page?", body: `<div class="warnline bad"><b>Everything on this page</b> goes back to the shipped defaults: the ticker builder, featured races and charts, overview charts, persistent elements and their inputs. This browser's saved settings are replaced.</div><p><b>The LIVE TICKER is not touched.</b> It keeps crawling what was last published until someone publishes again.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">This page is already on the defaults.</div>` : ""}`, ok: "Restore defaults", danger: true });
  if (!ok) return;
  draft = saveLocal(normalize(DEFAULTS));
  renderAll(); cards.broadcast(draft);
}
$("publish").addEventListener("click", publish);
$("pull").addEventListener("click", pull);
$("defaults").addEventListener("click", restoreDefaults);

// ---------- status bar + poller ----------
function renderStatus() {
  const s = status;
  const age = s?.lastApSuccess ? (Date.now() - Date.parse(s.lastApSuccess)) / 1000 : Infinity;
  const paused = settings?.pollEnabled === false;
  const cls = paused ? "warn" : !s ? "bad" : age < 180 ? "ok" : age < 600 ? "warn" : "bad";
  const feedLabel = paused ? "Polling paused" : !s ? "No poller status yet" : age < 180 ? "AP feed live" : age < 600 ? `AP data ${Math.round(age / 60)} min old` : "AP feed stale";
  // Test vs Live shows what the poller is actually tracking (its last run), not this machine's settings file.
  const rt = s?.resultsType ?? settings?.resultsType ?? settings?.envResultsType ?? "t";
  const apOk = s && !(s.lastError && (s.consecutiveFailures ?? 0) > 0);
  const st = (id, html) => `<span class="st" id="${id}">${html}</span>`;
  $("statusbar").innerHTML =
    st("st-feed", `<span class="dot ${cls === "ok" ? "" : cls}"></span><b>${esc(feedLabel)}</b>`) +
    st("st-refresh", `<span class="k">Last Refresh</span><b>${esc(ago(s?.lastApSuccess))}</b>`) +
    st("st-asof", `<span class="k">Data As Of</span><b>${esc(s?.apTimestamp ? fmtTime(s.apTimestamp) : "—")}</b>`) +
    st("st-rt", `<span class="k">Results</span><b style="color:${rt === "l" ? "#5fd48a" : "#ffd166"};font-weight:700">${rt === "l" ? "LIVE" : "TEST"}</b>`) +
    st("st-api", `<span class="k">AP Access</span><span class="dot ${!s ? "off" : apOk ? "" : "bad"}"></span><b>${!s ? "unknown" : apOk ? "working" : "failing"}</b>`) +
    st("st-air", `<span class="k">Data-to-Ticker Speed</span><b>≤ 5 s</b>`);
  $("testbanner").hidden = rt !== "t";
  $("loginbanner").hidden = loginKind !== "test";

  $("rtype").querySelectorAll("button").forEach((b) => { const on = b.dataset.rt === rt; b.classList.toggle("on", on); b.textContent = `${on ? "✓ " : ""}${b.dataset.rt === "t" ? "Test" : "Live"}`; b.disabled = !isProducer(); b.title = !isProducer() ? NOT_PRODUCER : on ? "Current results" : `Switch to ${b.dataset.rt === "t" ? "AP test data" : "live results"}`; });
  // One lock on the group's label, not one per button; the selected side keeps its colour so the choice stays obvious.
  { const lbl = $("rtype").querySelector(".lbl"); const has = !!lbl.querySelector(".lock"); if (!isProducer() && !has) lbl.insertAdjacentHTML("afterbegin", LOCK); else if (isProducer() && has) lbl.querySelector(".lock").remove(); }
  $("pause").querySelector(".lbl").textContent = paused ? "Resume polling" : "Pause polling";
  $("pause").classList.toggle("danger", !paused);
  for (const el of [$("pollnow"), $("pollfresh"), $("pause")]) producerOnly(el);
  $("readonly").hidden = isProducer();

  const problems = [];
  if (!index && runtime && !runtime.polling) problems.push({ warn: true, title: "No results on this laptop yet.", text: "The app was started with --no-poll and the local store holds no index. Start it without --no-poll, or run npm run poll, and the lists fill in within a minute." });
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
  renderStatus(); runPoll(false);
}));

// ---------- shared race rendering ----------
const cands = (r) => r.candidates.slice(0, 3).map((c) => `${esc(c.last ?? c.name)} ${c.independent || c.featured ? "(I)" : c.party === "Dem" ? "(D)" : c.party === "GOP" ? "(R)" : ""}${r.totalVotes ? ` ${Number(c.pct).toFixed(1)}%` : ""}`).join(" · ");
const indName = (r) => FEATURED_RACES.find((f) => f.id === r.id)?.who ?? r.candidates.find((c) => c.featured)?.name ?? r.candidates.find((c) => c.independent)?.name ?? null;
const ICON_FEAT = '<span class="sic feat" title="Featured race"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.6-3.2 3 .8 4.4L8 11.5l-3.9 2.1.8-4.4-3.2-3 4.4-.6z" fill="currentColor"/></svg></span>';
const ICON_TICK = '<span class="sic tick" title="On the ticker"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M1 4h14v8H1z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 8h6M11 8h1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>';
const raceLine = (r) => `<span class="lab" title="Race id ${esc(r.label)} · AP race ${esc(r.id)}">${esc(r.label)}</span>${kindBadge(r)}${esc(r.title)}${r.called ? ' <span class="pill call">AP CALL</span>' : ""}${draft.featuredRaceIds.includes(r.id) ? ICON_FEAT : ""}${draft.pinnedRaceIds.includes(r.id) ? ICON_TICK : ""}`;
function raceBand(r, { featured, position = null }) {
  const who = indName(r);
  return `<div class="raceband">${position ? `<span class="pos" title="Position ${position} in the Featured races list">${position}</span>` : ""}<span class="lab" title="Race id ${esc(r.label)} · AP race ${esc(r.id)}">${esc(r.label)}</span><span class="ttl">${esc(r.stateName)} · ${esc(r.title)}</span>${who ? `<span class="who">${esc(who)}</span>` : ""}
    <span class="meta">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results yet"}${r.called ? " · AP CALL" : ""}${r.rankedChoice ? " · ranked choice" : ""}</span>
    <button class="featbtn" data-pin="${r.id}">${draft.pinnedRaceIds.includes(r.id) ? "Remove from ticker" : "Add to ticker"}</button><button class="featbtn" data-feat="${r.id}">${featured ? "Remove from Featured" : "Set as Featured race"}</button></div>`;
}
const raceName = (id) => { const r = index?.byId?.get(id); return r ? `${r.label} (${r.stateName}, ${r.title})` : `race ${id}`; };
/** Adding or removing a race or chart is a real action: confirm it, then commit. Reorders need no confirmation. */
async function confirmThen(title, body, fn) {
  const ok = await ask({ title, body: `<p>${body}</p><p class="small muted">This changes only this page. The LIVE TICKER changes only when you publish the builder.</p>`, ok: title.replace(/\?$/, "") });
  if (ok) { fn(); commit(); }
}
function toggleFeatured(id) {
  const on = draft.featuredRaceIds.includes(id);
  confirmThen(on ? "Remove from Featured Races?" : "Feature this race?", `${esc(raceName(id))} ${on ? "leaves the Featured Races section." : "gets a row in Featured Races with every featured chart."}`,
    () => { draft.featuredRaceIds = on ? draft.featuredRaceIds.filter((x) => x !== id) : [...draft.featuredRaceIds, id]; });
}
function toggleTicker(id) {
  const a = draft.pinnedRaceIds, on = a.includes(id);
  if (on && a.length === 1) { ask({ title: "The ticker keeps at least one race", body: "<p>Add another race before removing this one.</p>", ok: "OK" }); return; }
  confirmThen(on ? "Remove from the ticker?" : "Add to the ticker?", `${esc(raceName(id))} ${on ? "stops crawling." : "joins the crawl at the end of the list."}`,
    () => { draft.pinnedRaceIds = on ? a.filter((x) => x !== id) : [...a, id]; });
}
function toggleChart(id) {
  const chart = CHARTS.find((c) => c.id === id); if (!chart || id === "A1") return;
  const key = chart.kind === "race" ? "featuredCharts" : chart.kind === "other" ? "persistentCharts" : "movementCharts";
  const on = draft[key].includes(id);
  const target = chart.kind === "race" ? "Featured Charts" : chart.kind === "other" ? "Persistent Elements" : overviewName(chart);
  const where = chart.kind === "race" ? "the Featured Races set (every featured race)" : `the ${target}${chart.kind === "other" ? " section, where its inputs are set" : ""}`;
  confirmThen(on ? `Remove ${id} from ${target}?` : `Add ${id} to ${target}?`, `${esc(chart.id)} ${esc(chart.name)} ${on ? "leaves" : "joins"} ${where}.`,
    () => { const set = new Set(draft[key]); on ? set.delete(id) : set.add(id); draft[key] = CHARTS.filter((c) => set.has(c.id)).map((c) => c.id); if (on && key === "persistentCharts") delete draft.persistentSettings[id]; });
}

// ---------- Ticker section ----------
function renderPins() {
  if (!index) return;
  $("pincount").textContent = `${draft.pinnedRaceIds.length}`;
  $("pins").innerHTML = draft.pinnedRaceIds.map((id, i) => {
    const r = index.byId.get(id);
    return `<div class="row" data-id="${id}">
      <div><div class="nm"><span class="ord">${i + 1}</span>${r ? raceLine(r) : `<span class="lab">${esc(id)}</span><span class="muted">not in the current AP feed; the ticker skips it</span>`}</div>${r ? `<div class="sub">${cands(r)}</div>` : ""}</div>
      <div class="btns"><button class="up" ${i === 0 ? "disabled" : ""}>▲</button><button class="down" ${i === draft.pinnedRaceIds.length - 1 ? "disabled" : ""}>▼</button><button class="rm" ${draft.pinnedRaceIds.length === 1 ? 'title="At least one race stays on the ticker"' : ""}>✕</button></div>
    </div>`;
  }).join("");
}
function renderManual() {
  $("manualcount").textContent = `${draft.manualItems.length}`;
  $("manual").innerHTML = draft.manualItems.length ? draft.manualItems.map((m) => `<div class="row manual" data-id="${esc(m.id)}"><div class="nm">${esc(m.text)}</div><div class="btns"><button class="rm">✕</button></div></div>`).join("") : "";
  if (document.activeElement !== $("idletext")) $("idletext").value = draft.idleText;
  $("callhl").checked = draft.callHighlight;
}
$("pins").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!row || !b) return;
  const a = draft.pinnedRaceIds; const i = a.indexOf(row.dataset.id); if (i < 0) return;
  if (b.classList.contains("rm")) { toggleTicker(row.dataset.id); return; }
  if (b.classList.contains("up") && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  else if (b.classList.contains("down") && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  commit();
});
$("manual").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row || !e.target.closest(".rm")) return;
  draft.manualItems = draft.manualItems.filter((m) => m.id !== row.dataset.id); commit();
});
$("addmanual").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("manualtext").value.trim(); if (!text) return;
  draft.manualItems.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text });
  $("manualtext").value = ""; commit();
});
let idleTimer = null;
$("idletext").addEventListener("input", () => { draft.idleText = $("idletext").value; clearTimeout(idleTimer); idleTimer = setTimeout(commit, 400); });
$("callhl").addEventListener("change", () => { draft.callHighlight = $("callhl").checked; commit(); });
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
function displayParams() { const bg = $("bg").value, o = $("opacity").value; const p = new URLSearchParams(); if (bg) p.set("bg", bg); if (o !== "100") p.set("opacity", o); return p; }
/** The LIVE TICKER's address: fixed; only the display parameters vary. */
function liveTickerUrl() { const s = displayParams().toString(); return `${origin()}/ticker${s ? "?" + s : ""}`; }
/** The builder's address: reproduces the ticker on this page with no publish: display parameters, then races by id, calls, items, idle. */
function tickerUrl() {
  const p = displayParams();
  p.set("races", draft.pinnedRaceIds.map((id) => index?.byId?.get(id)?.label ?? id).join(","));
  p.set("calls", draft.callHighlight === false ? "0" : "1");   // the AP Call highlight, always spelled out
  for (const m of draft.manualItems) if (m.text) p.append("item", m.text);
  if (draft.idleText && draft.idleText !== DEFAULTS.idleText) p.set("idle", draft.idleText);
  return `${origin()}/ticker?${p.toString()}`;
}
function renderTickerUrl() {
  const u = tickerUrl(); $("tickerurl").textContent = u; $("tickerurl").href = u; $("tickeropen").href = u;
  const l = liveTickerUrl(); $("liveurl").textContent = l; $("liveurl").href = l; $("liveopen").href = l;
}
for (const [btn, fn, label] of [["tickercopy", tickerUrl, "Copy Draft URL"], ["livecopy", liveTickerUrl, "Copy Live URL"]]) $(btn).addEventListener("click", async () => { try { await navigator.clipboard.writeText(fn()); $(btn).textContent = "Copied"; setTimeout(() => ($(btn).textContent = label), 1500); } catch {} });
$("previewframe").addEventListener("click", () => window.open(tickerUrl(), "_blank", "noopener"));
$("liveframe").addEventListener("click", () => window.open(liveTickerUrl(), "_blank", "noopener"));
$("bg").addEventListener("change", renderTickerUrl); $("opacity").addEventListener("change", renderTickerUrl);

// ---------- Live Screens ----------
// Two fixed pages, /live-screen-a and /live-screen-b. Each row: the draft on the left (chart, race or state and the
// chart's own parameters, saved on this page), an arrow with Publish and Pull, and the on-air page on the right.
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
/** The on-air page's address: fixed; only the display parameters vary. */
function screenLiveUrl(key) { const s = displayParams().toString(); return `${origin()}${screenPath(key)}${s ? "?" + s : ""}`; }
/** The draft's own address: the chart-id address with the Default Chart Settings, usable anywhere. */
function screenDraftUrl(key) { const bg = $("bg").value, o = $("opacity").value; return origin() + screenAddress(draft[key], { bg, opacity: o }); }
function raceOptions(selected) {
  if (!index) return "";
  const feat = draft.featuredRaceIds.map((id) => index.byId.get(id)).filter(Boolean);
  const opt = (r) => `<option value="${esc(r.label)}" ${selected === r.label ? "selected" : ""}>${esc(r.label)} · ${esc(r.stateName)} · ${esc(r.title)}</option>`;
  return `<optgroup label="Featured races">${feat.map(opt).join("")}</optgroup><optgroup label="Every race">${index.races.filter((r) => !feat.includes(r)).sort((a, b) => a.label.localeCompare(b.label)).map(opt).join("")}</optgroup>`;
}
function stateOptions(selected) {
  const states = index ? [...new Set(index.races.map((r) => r.state))].sort() : FEATURED_RACES.map((r) => r.state);
  return states.map((s) => `<option ${selected === s ? "selected" : ""}>${s}</option>`).join("");
}
function screenForm(key) {
  const s = draft[key];
  const chart = CHARTS.find((c) => c.id === s.chart);
  const groups = [["A", "Persistent elements"], ["B", "Per-race charts"], ["C", "Independent movement"], ["D", "Broad races"], ["F", "AP reports"]];
  const chartSel = `<label>Chart<select data-sk="${key}" data-f="chart">${groups.map(([ser, name]) => `<optgroup label="${ser} · ${name}">${CHARTS.filter((c) => c.id[0] === ser && c.built && !c.retired && c.page && c.id !== "A1").map((c) => `<option value="${c.id}" ${s.chart === c.id ? "selected" : ""}>${c.id} ${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>`;
  const needsRace = chart && (chart.kind === "race" || chart.needsRace);
  const raceSel = needsRace || chart?.needsState ? `<label>Race<select data-sk="${key}" data-f="race"><option value="">${chart?.needsState ? "(by state instead)" : "choose a race"}</option>${raceOptions(s.race)}</select></label>` : "";
  const stateSel = chart?.needsState ? `<label>State<select data-sk="${key}" data-f="state"><option value="">from the race</option>${stateOptions(s.state)}</select></label>` : "";
  const extra = (SCREEN_PARAMS[s.chart] ?? []).map((p) => p.options
    ? `<label>${esc(p.label)}<select data-sk="${key}" data-p="${p.k}"><option value="">default</option>${p.options.map(([v, t]) => `<option value="${v}" ${s.params[p.k] === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`
    : `<label>${esc(p.label)}<input data-sk="${key}" data-p="${p.k}" value="${esc(s.params[p.k] ?? "")}" placeholder="${esc(p.ph ?? "")}" maxlength="200"></label>`).join("");
  return chartSel + raceSel + stateSel + extra;
}
function screenLiveTable(key) {
  const s = live?.[key];
  if (!s) return `<div class="warnline bad">${liveError ? `Cannot read the live screen: ${esc(liveError)}` : "Reading the live screen…"}</div>`;
  const chart = CHARTS.find((c) => c.id === s.chart);
  const rows = [["chart", `${esc(s.chart)} ${esc(chart?.name ?? "")}`], ...(s.race ? [["race", `<span class="lab">${esc(s.race)}</span>`]] : []), ...(s.state ? [["state", esc(s.state)]] : []), ...Object.entries(s.params).map(([k, v]) => [k, esc(v)]), ["published", live.updatedAt ? `${esc(fmtTime(live.updatedAt))} (${esc(ago(live.updatedAt))})` : "never: the shipped default is on air"]];
  return `<table class="params">${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join("")}</table>`;
}
function buildScreen(key) {
  const letter = screenLetter(key);
  const box = $(key);
  box.innerHTML = `
    <h3 class="screenhead">Live Screen ${letter}</h3>
    <div class="screenrow">
      <div class="screen draft">
        <div class="frame clickable" data-open="draft" title="Open the draft at 1920×1080 in a new tab"><iframe title="Live Screen ${letter} draft"></iframe></div>
        <div class="gfoot"><span class="muted small">Draft on this page</span><span class="spacer"></span><button class="copybtn" data-copy="draft" type="button" title="Copy the draft's address">Copy Draft URL</button><a class="openbtn" data-open="draft" target="_blank" rel="noopener" title="Open the draft at 1920×1080 in a new tab">Show 1920×1080</a></div>
        <div class="sform"></div>
      </div>
      <div class="screenmid">
        <div class="arrow" aria-hidden="true"><svg viewBox="0 0 64 24" width="64" height="24"><path d="M2 12h50M42 3l10 9-10 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <button class="publish" data-act="publish" title="Make this draft the on-air screen">Publish to Live</button>
        <span class="whynot"></span>
        <div class="arrow back" aria-hidden="true"><svg viewBox="0 0 64 24" width="64" height="24"><path d="M62 12H12M22 3L12 12l10 9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <button class="pull" data-act="pull" title="Copy the on-air screen into the draft">Pull from Live</button>
        <span class="pubstate"></span>
      </div>
      <div class="screen onair">
        <div class="frame clickable" data-open="live" title="Open the on-air screen at 1920×1080 in a new tab"><iframe title="Live Screen ${letter} on air"></iframe></div>
        <div class="gfoot"><span class="muted small">On air now</span><span class="spacer"></span><button class="copybtn" data-copy="live" type="button" title="Copy the permanent address">Copy Live URL</button><a class="openbtn" data-open="live" target="_blank" rel="noopener" title="Open the on-air screen at 1920×1080 in a new tab">Show 1920×1080</a></div>
        <p class="tickerurl"><span class="k" title="This address never changes. Point the switcher at it once.">Permanent Address:</span> <a class="url liveaddr" target="_blank" rel="noopener"></a></p>
        <div class="liveparams"></div>
        <p class="muted small">Changes within 5 seconds of a publish, cross-fading so nothing flashes. Only an authorized publish changes it.</p>
      </div>
    </div>`;
  box.querySelector(".screen.onair iframe").src = `${screenPath(key)}?bg=black`;
  box.dataset.built = "1";
}
function renderScreens() {
  for (const key of Object.keys(SCREEN_IDS)) {
    const box = $(key);
    if (!box.dataset.built) buildScreen(key);
    // the draft preview reloads only when its address changes; the on-air frame never reloads
    const dFrame = box.querySelector(".screen.draft iframe");
    const dAddr = screenAddress(draft[key], { bg: "black", sample: "auto" });
    if (dFrame.dataset.addr !== dAddr) { dFrame.dataset.addr = dAddr; dFrame.src = dAddr; }
    const form = box.querySelector(".sform");
    if (!form.contains(document.activeElement)) form.innerHTML = screenForm(key);
    box.querySelector("a[data-open=draft]").href = screenDraftUrl(key);
    box.querySelector("a[data-open=live]").href = screenLiveUrl(key);
    const la = box.querySelector(".liveaddr"); la.textContent = screenLiveUrl(key); la.href = screenLiveUrl(key);
    box.querySelector(".liveparams").innerHTML = screenLiveTable(key);
    const changed = live ? JSON.stringify(live[key]) !== JSON.stringify(draft[key]) : false;
    const st = box.querySelector(".pubstate");
    st.className = `pubstate ${live && !changed ? "same" : "dirty"}`;
    st.textContent = !live ? "On-air screen not read yet" : changed ? "Draft differs from on air" : "Draft matches on air";
    const pub = box.querySelector("button[data-act=publish]"), pull = box.querySelector("button[data-act=pull]");
    pub.disabled = !canPublish() || !changed; pub.classList.toggle("noauth", !canPublish());
    pub.innerHTML = `${canPublish() ? "" : LOCK}Publish to Live`;
    box.querySelector(".whynot").textContent = canPublish() ? "" : isProducer() ? "Not set up on this machine" : "Read-only account";
    pub.title = !canPublish() ? (isProducer() ? NOT_CONFIGURED : NOT_PRODUCER) : !changed ? "Nothing to publish: the draft already matches the on-air screen" : `Make this draft the on-air screen (${describeScreen(draft[key])})`;
    pull.disabled = !canPull() || !live;
  }
  scaleScreens();
}
function scaleScreens() { document.querySelectorAll(".screen .frame").forEach((fr) => { const f = fr.querySelector("iframe"); if (f) f.style.transform = `scale(${fr.clientWidth / 1920})`; }); }
window.addEventListener("resize", scaleScreens);
let screenTimer = null;
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-sk]"); if (!el) return;
  const key = el.dataset.sk, s = draft[key];
  if (el.dataset.f === "chart") { s.chart = el.value; s.params = {}; if (!(SCREEN_PARAMS[s.chart] ?? []).length) s.params = {}; }
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
    body: `<p><b>${esc(prodHost())}${screenPath(key)}</b> changes to <b>${esc(describeScreen(draft[key]))}</b>${latest ? ` (now ${esc(describeScreen(latest[key]))})` : ""}, within 5 seconds, cross-fading so nothing flashes. Nothing else is published.</p>
      ${someoneElse ? `<div class="warnline bad">Someone else published at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or published.</div>` : ""}
      ${same ? `<div class="warnline">The draft already matches the on-air screen.</div>` : ""}`,
    ok: "Publish", danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify({ [key]: draft[key] }) }));
    live = saved; liveSeenAt = saved.updatedAt; liveError = null;
    renderAll();
  } catch (e) {
    await ask({ title: "Publish failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>The on-air screen is unchanged. The draft is still saved on this page.</p>`, ok: "OK" });
  }
}
async function pullScreen(key) {
  const letter = screenLetter(key);
  let latest;
  try { latest = normalize(await api("/api/producer")); live = latest; liveError = null; }
  catch (e) { liveError = e.message; renderScreens(); await ask({ title: "Can't read the on-air screen", body: `<div class="warnline bad">${esc(e.message)}</div><p>The draft is unchanged.</p>`, ok: "OK" }); return; }
  const ok = await ask({ title: `Pull Live Screen ${letter} into the draft?`, body: `<p>The draft becomes <b>${esc(describeScreen(latest[key]))}</b>, what is on air now${latest.updatedAt ? ` (published ${esc(ago(latest.updatedAt))})` : ""}. Nothing on air changes.</p>`, ok: "Pull into the draft", danger: false });
  if (!ok) return;
  liveSeenAt = latest.updatedAt;
  draft = saveLocal({ ...draft, [key]: structuredClone(latest[key]) });
  renderAll(); cards.broadcast(draft);
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
    if (!r) { row.innerHTML = `<div class="raceband"><span class="pos">${i + 1}</span><span class="lab">${esc(id)}</span><span class="ttl">Not in the current AP feed</span><button class="featbtn" data-feat="${esc(id)}">Remove from Featured</button></div>`; grid.appendChild(row); return; }
    row.innerHTML = raceBand(r, { featured: true, position: i + 1 });
    const cg = document.createElement("div"); cg.className = "cardgrid";
    for (const cid of draft.featuredCharts) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      if (chart.only && !chart.only(r)) continue;
      cg.appendChild(cards.card({ chart, race: r, priority: i === 0 ? 1 : 2, open: "show", menu: [{ label: "Remove from Featured Charts (all races)…", onClick: () => toggleChart(chart.id) }] }));
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
racePicker("pinq", "pinsuggest", { exclude: () => draft.pinnedRaceIds, onPick: toggleTicker });
racePicker("featq", "featsuggest", { exclude: () => draft.featuredRaceIds, onPick: toggleFeatured });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-feat]"); if (b) toggleFeatured(b.dataset.feat); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-pin]"); if (b) toggleTicker(b.dataset.pin); });

// ---------- Movement Overview ----------
// movementCharts holds both series; the C charts render in Movement Overview, the D charts in Broad Races Overview.
const seriesOf = (id) => id[0];
const overviewName = (chart) => (seriesOf(chart.id) === "D" ? "Races Overview" : "Movement Overview");
function renderMovement() {
  for (const [gridId, series] of [["movegrid", "C"], ["broadgrid", "D"]]) {
    const grid = $(gridId); grid.className = "cardgrid"; grid.innerHTML = "";
    for (const cid of draft.movementCharts.filter((id) => seriesOf(id) === series)) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      const params = chart.id === "D5" && draft.keyRaceIds.length ? { races: draft.keyRaceIds.map((id) => index?.byId?.get(id)?.label ?? id).join(",") } : null;
      grid.appendChild(cards.card({ chart, params, priority: 3, open: "show", menu: [{ label: `Remove from ${overviewName(chart)}…`, onClick: () => toggleChart(chart.id) }] }));
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
      <div class="btns"><span class="nums muted small">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results"}</span><button class="mini ${onTicker ? "on" : ""}" data-pin="${r.id}" title="${onTicker ? "Remove from the ticker" : "Add to the ticker"}">${onTicker ? "✓ Ticker" : "+ Ticker"}</button><button class="mini ${featured ? "on" : ""}" data-feat="${r.id}" title="${featured ? "Remove from Featured races" : "Set as a Featured race"}">${featured ? "★ Featured" : "☆ Feature"}</button></div></div>`;
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
    const el = cards.card({ chart, race: r, priority: 9, isStatic: true, open: "show" });
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
$("bg").addEventListener("change", () => { try { localStorage.setItem("studio.bg", $("bg").value); } catch {} cards.refreshLinks(); });
try { const bg = localStorage.getItem("studio.bg"); if (bg !== null) $("bg").value = bg; } catch {}
// Chart Opacity (10% steps) for opened graphics and the ticker; per browser, like the background colour.
$("opacity").addEventListener("change", () => { try { localStorage.setItem("studio.opacity", $("opacity").value); } catch {} cards.refreshLinks(); });
try { const o = localStorage.getItem("studio.opacity"); if (o !== null && [...$("opacity").options].some((x) => x.value === o)) $("opacity").value = o; } catch {}

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
    const el = cards.card({ chart, race, params: id === "A2" ? { name: st.name, title: st.title } : null, priority: 4, showRace: !!race, open: "show", menu: [{ label: "Remove from Persistent Elements…", onClick: () => toggleChart(chart.id) }] });
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
      const el = cards.card({ chart, race: kind === "race" || chart.needsRace || chart.needsState ? sample : null, priority: 6, showRace: false });
      el.classList.add("minicard"); el.classList.toggle("inuse", on);
      if (chart.retired) el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">Retired · id reserved</span>`);
      else if (chart.unavailable) el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">${esc(chart.unavailable)}</span>`);
      else if (chart.id === "A1") { el.classList.add("inuse"); el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<a class="mini on" href="#ticker">★ Managed in Ticker</a>`); }
      else if (series === "F") el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<span class="muted small">Reference page</span>`);
      else if (series === "A") el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="mini ${on ? "on" : ""} featchart" data-chart="${chart.id}" title="Shown in Persistent Elements with its inputs">${on ? "✓ In Persistent" : "+ Add to Persistent"}</button>`);
      else el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="mini ${on ? "on" : ""} featchart" data-chart="${chart.id}" title="${kind === "race" ? "Featured charts apply to every featured race" : `Shown in the ${overviewName(chart)}`}">${on ? (kind === "race" ? "★ Featured" : "✓ In overview") : (kind === "race" ? "☆ Feature" : "+ Add")}</button>`);
      grid.appendChild(el);
    }
  }
  if (sample) $("chartsRace").insertAdjacentHTML("afterbegin", `<div class="muted small" style="grid-column:1/-1">Previews use ${esc(sample.label)}, the first featured race. Gold outline = in use.</div>`);
}
$("charts").addEventListener("click", (e) => { const fc = e.target.closest(".featchart"); if (fc) toggleChart(fc.dataset.chart); });

// ---------- render everything ----------
function renderAll() {
  renderStatus();
  renderLive();
  renderPins(); renderManual(); sendPreview(); renderScreens();
  renderDetail(); renderMovement(); renderPersistent(); renderCatalog(); renderChartCatalog();
  cards.prune();
}
// highlight the section in view
const secObs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) document.querySelectorAll("#sectionnav a").forEach((a) => a.classList.toggle("here", a.getAttribute("href") === `#${e.target.id}`));
}, { rootMargin: "-120px 0px -60% 0px" });
for (const id of ["ticker", "screens", "detail", "broad", "movement", "persistent", "catalog", "charts"]) secObs.observe($(id));

// ---------- boot ----------
let timers = [];
async function boot() {
  timers.forEach(clearInterval);
  draft = readLocal() ?? normalize(DEFAULTS);
  frame.src = `/ticker?preview=1&bg=black&src=local`;   // the builder: fed by postMessage
  liveFrame.src = `/ticker?bg=black`;                   // the live ticker itself, reading what is published
  scalePreviews();
  const loadRuntime = async () => { runtime = await fetch("/api/runtime", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); };
  await loadRuntime();
  await Promise.all([loadStatus(), loadIndex(), loadLive()]);
  renderAll();
  timers = [setInterval(loadStatus, 15_000), setInterval(loadIndex, 60_000), setInterval(loadLive, 20_000), setInterval(loadRuntime, 30_000), setInterval(() => { renderStatus(); renderLive(); }, 10_000)];
}
(async () => {
  const me = await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  loginKind = me.authed ? (me.kind ?? "prod") : null;
  if (!me.authed) loginHint(false, me);
  if (me.authed) { showApp(); boot(); } else showLogin();
})();
