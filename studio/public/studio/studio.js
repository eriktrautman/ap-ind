// Control room: status bar and poller controls, the Default / Global / Local state model,
// and the four sections (Ticker, Race Detail, Movement Overview, Full Catalog).
import { buildQueue } from "/ticker-queue.js";
import { DEFAULTS, CHARTS, FEATURED_RACES, normalize, sameState, diffState, readLocal, saveLocal } from "/g/control.js";
import { createCardManager } from "/studio/cards.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BADGE = { S: "SENATE", H: "HOUSE", USD: "DELEGATE", G: "GOVERNOR", L: "LT GOV", A: "ATTY GEN", SS: "SEC STATE", RR: "RR COMM", I: "MEASURE", M: "MAYOR" };
const kindBadge = (r) => `<span class="kind k-${esc(r.kind ?? "federal")}" title="${esc(r.officeName ?? "")}">${esc(BADGE[r.office] ?? r.office)}</span>`;
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }) : "—";
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};
const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { cache: "no-store", headers: { "content-type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error("signed out"); }
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
function showLogin() { $("login").hidden = false; $("app").hidden = true; $("logout").hidden = true; }
function showApp() { $("login").hidden = true; $("app").hidden = false; $("logout").hidden = false; }
$("loginform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginerr").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showApp(); boot();
  } catch (err) { $("loginerr").textContent = err.message === "wrong password" ? "Wrong password." : err.message; }
});
$("logout").addEventListener("click", async () => { await fetch("/api/login", { method: "DELETE" }); showLogin(); });

// ---------- data ----------
let status = null, settings = null, index = null;
let runtime = null;           // from /api/runtime on a laptop (npm start); null on the deployment, where production is this site
let prod = null;              // production state as last read (normalized), or null if never read
let prodSeenAt = null;        // updatedAt of the production copy this page last pulled or pushed
let prodError = null;         // why production is unreadable right now, or null
let draft = normalize(DEFAULTS);   // the working copy: always Local (this browser), seeded from production on first use
const view = "local";         // thumbnails and the example ticker always show the settings on this page
const cards = createCardManager({ maxLive: 32, getBg: () => $("bg").value, getSource: () => view, getDraft: () => (view === "local" ? draft : null) });
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
    renderAll();
  } catch {}
}
/** Read production. On a laptop the runner answers from the deployment (or from itself when GLOBAL=self). */
async function loadProd() {
  try {
    const remote = normalize(await api("/api/producer"));
    prodError = null;
    const first = !prod;
    prod = remote;
    if (first && !readLocal()) { prodSeenAt = remote.updatedAt; draft = saveLocal(structuredClone(remote)); renderAll(); cards.broadcast(draft); }
    else renderStrip();
  } catch (e) { prodError = e.message; renderStrip(); }
  renderStatus();
}

// ---------- state model: the working copy is Local; production is pushed to or pulled from ----------
const dirty = () => !prod || !sameState(draft, prod);
const otherOperator = () => prod && prodSeenAt !== prod.updatedAt;
const canPush = () => runtime ? !!runtime.production?.canPush : true;
const canPull = () => runtime ? !!runtime.production?.canPull : !prodError;
// The shared version is always named by its web address, never by a word like "production": on the
// website that is this site; on a laptop it is the website it points at, or the laptop itself (GLOBAL=self).
const prodHost = () => runtime ? (runtime.production?.where === "self" ? `${location.host} (this laptop)` : runtime.production?.origin?.replace(/^https?:\/\//, "") ?? "the website") : location.host;
// Wording: on the website itself the pushed settings are "live"; from a laptop they are "the settings at <host>".
// What is edited here is "the settings on this page" (saved in this browser), never "your settings".
const onSite = () => !runtime;
const LIVE = () => (onSite() ? "the live settings" : `the settings at ${prodHost()}`);
const SETTINGS = "the settings on this page (ticker races and order, manual items, idle text, featured races and charts, overview charts)";

/** Every edit comes through here: the working copy saves to this browser at once. */
function commit() {
  draft = saveLocal(normalize(draft));
  renderAll();
  cards.broadcast(draft);
}

function renderStrip() {
  $("prodstrip").hidden = false;
  const d = dirty();
  const changes = prod ? diffState(prod, draft) : [];
  const host = prodHost();
  const st = $("ps-state");
  st.className = d ? "dirty" : "same";
  st.textContent = !prod ? "Not pushed" : d ? `${changes.length} change${changes.length === 1 ? "" : "s"} on this page not pushed` : `Same as ${onSite() ? "live" : host}`;
  $("ps-sub").textContent = "";
  $("ps-work").title = `${readLocal()?.updatedAt ? `The settings on this page were saved in this browser ${ago(readLocal().updatedAt)}. ` : ""}${onSite() ? "Nothing goes live until you push." : `Nothing at ${host} changes until you push.`}${changes.length ? "\n\n" + changes.map((c) => "• " + withLabels(c.text)).join("\n") : ""}`;
  const p = $("ps-prod");
  const r = runtime?.production;
  const sent = prod?.updatedAt ? `pushed ${ago(prod.updatedAt)}` : "nothing pushed yet";
  const since = otherOperator() ? " · changed since you last pulled" : "";
  let cls = "", text, tip;
  if (runtime && r && !r.reachable) { cls = "bad"; text = `${host} · not answering`; tip = `${host} is not responding, so you can neither pull its settings nor push. ${r.reason ?? ""}`; }
  else if (prodError) { cls = "bad"; text = `${onSite() ? "Live settings" : host} · can't read`; tip = `${onSite() ? "The live settings" : `The settings at ${host}`} could not be read: ${prodError}`; }
  else if (runtime && r && !r.canPush) { cls = "warn"; text = `${host} · pull only · ${sent}`; tip = `This laptop has no password for ${host}, so you can pull its settings but not push. ${r.reason ?? ""}${prod?.updatedAt ? "" : "\n\nNothing has been pushed there yet, so it shows the defaults."}`; }
  else if (onSite()) { text = `Live on this site · ${sent}${since}`; tip = `The live settings are what this site's ticker and graphics show: whatever was last pushed, by anyone.${prod?.updatedAt ? ` Last push ${fmtTime(prod.updatedAt)}.` : " Nothing has been pushed yet, so the defaults are live."}${since ? " Someone pushed after you last pulled." : ""}`; }
  else { text = `${host} · ${sent}${since}`; tip = `${host} is the site everyone uses: its ticker and graphics show whatever was last pushed there, by anyone.${prod?.updatedAt ? ` Last push ${fmtTime(prod.updatedAt)}.` : " Nothing has been pushed yet, so it shows the defaults."}${since ? " Someone pushed after you last pulled." : ""}`; }
  p.className = cls; p.textContent = text; $("ps-prodsub").textContent = ""; $("ps-prod").title = tip;
  $("push").disabled = !canPush() || !d;
  $("push").title = !canPush() ? (r?.reason ?? "pushing is not possible from here") : !d ? `Nothing to push: this page already matches ${onSite() ? "live" : host}` : `${onSite() ? "Push the settings on this page live" : `Push the settings on this page to ${host}`} (${changes.length} change${changes.length === 1 ? "" : "s"})`;
  $("pull").disabled = !canPull() || !prod;
  $("pull").title = !canPull() ? (r?.reason ?? prodError ?? "pulling is not possible right now") : `Replace the settings on this page with ${LIVE()}`;
}

async function pushToProduction() {
  if (!canPush()) return;
  let latest = prod;
  try { latest = normalize(await api("/api/producer")); prod = latest; prodError = null; } catch (e) { prodError = e.message; }
  const changes = diffState(latest ?? DEFAULTS, draft);
  const someoneElse = latest && latest.updatedAt !== prodSeenAt;
  const host = prodHost();
  const ok = await ask({
    title: onSite() ? "Push live?" : `Push to ${host}?`,
    body: `<p><b>All</b> of ${SETTINGS} replace <b>${esc(LIVE())}</b>, including anything someone else set. The ${onSite() ? "live" : ""} ticker and every graphic ${onSite() ? "on this site" : `at ${esc(host)}`} change to match: the ticker within 5 seconds, the graphics within 10.</p>
      ${changeList(changes)}
      <p class="small muted">Last push${onSite() ? "" : ` to ${esc(host)}`}: ${latest?.updatedAt ? esc(fmtTime(latest.updatedAt)) + " (" + esc(ago(latest.updatedAt)) + ")" : "none yet"}.</p>
      ${someoneElse ? `<div class="warnline bad">Someone else pushed${onSite() ? "" : ` to ${esc(host)}`} at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or pushed. Pushing now throws their settings away. Press Cancel and Pull if you want to see them first.</div>` : ""}
      ${!changes.length ? `<div class="warnline">This page already matches ${onSite() ? "live" : esc(host)}.</div>` : ""}`,
    ok: onSite() ? "Push live" : `Push to ${host}`, danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify(draft) }));
    prod = saved; prodSeenAt = saved.updatedAt; prodError = null;
    draft = saveLocal(structuredClone(saved));
    renderAll(); cards.broadcast(draft);
  } catch (e) {
    await ask({ title: "Push failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>Nothing changed ${onSite() ? "live" : `at ${esc(host)}`}. The settings on this page are still saved here.</p>`, ok: "OK" });
  }
}
async function pullFromProduction() {
  let latest;
  const host = prodHost();
  try { latest = normalize(await api("/api/producer")); prod = latest; prodError = null; }
  catch (e) { prodError = e.message; renderStrip(); await ask({ title: onSite() ? "Can't read the live settings" : `Can't read ${host}`, body: `<div class="warnline bad">${esc(e.message)}</div><p>The settings on this page are unchanged.</p>`, ok: "OK" }); return; }
  const changes = diffState(draft, latest);
  const ok = await ask({
    title: onSite() ? "Pull the live settings onto this page?" : `Pull from ${host} onto this page?`,
    body: `<p><b>All</b> of ${SETTINGS} are replaced by <b>${esc(LIVE())}</b> (last pushed ${latest.updatedAt ? esc(ago(latest.updatedAt)) : "never, so they are the defaults"}). Nothing ${onSite() ? "live" : `at ${esc(host)}`} changes.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">This page already matches ${onSite() ? "live" : esc(host)}.</div>` : ""}`,
    ok: onSite() ? "Pull the live settings" : `Pull from ${host}`, danger: changes.length > 0,
  });
  if (!ok) return;
  prodSeenAt = latest.updatedAt;
  draft = saveLocal(structuredClone(latest));
  renderAll(); cards.broadcast(draft);
}
async function restoreDefaults() {
  const changes = diffState(draft, DEFAULTS);
  const ok = await ask({ title: "Reset this page to the defaults?", body: `<p><b>All</b> of ${SETTINGS} are replaced by the defaults the app came with. Nothing ${onSite() ? "goes live" : `at ${esc(prodHost())} changes`} until you push.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">This page is already on the defaults.</div>` : ""}`, ok: "Reset to defaults", danger: changes.length > 0 });
  if (!ok) return;
  draft = saveLocal(normalize(DEFAULTS));
  renderAll(); cards.broadcast(draft);
}
$("push").addEventListener("click", pushToProduction);
$("pull").addEventListener("click", pullFromProduction);
$("defaults").addEventListener("click", restoreDefaults);

// ---------- status bar + poller ----------
function renderStatus() {
  const s = status;
  const age = s?.lastApSuccess ? (Date.now() - Date.parse(s.lastApSuccess)) / 1000 : Infinity;
  const paused = settings?.pollEnabled === false;
  const cls = paused ? "warn" : !s ? "bad" : age < 180 ? "ok" : age < 600 ? "warn" : "bad";
  const feedLabel = paused ? "Polling paused" : !s ? "No poller status yet" : age < 180 ? "AP feed live" : age < 600 ? `AP data ${Math.round(age / 60)} min old` : "AP feed stale";
  const rt = settings?.resultsType ?? settings?.envResultsType ?? s?.resultsType ?? "t";
  const apOk = s && !(s.lastError && (s.consecutiveFailures ?? 0) > 0);
  const st = (id, html) => `<span class="st" id="${id}">${html}</span>`;
  $("statusbar").innerHTML =
    st("st-feed", `<span class="dot ${cls === "ok" ? "" : cls}"></span><b>${esc(feedLabel)}</b>`) +
    st("st-refresh", `<span class="k">Last refresh</span><b>${esc(ago(s?.lastApSuccess))}</b>`) +
    st("st-asof", `<span class="k">AP data as of</span><b>${esc(s?.apTimestamp ? fmtTime(s.apTimestamp) : "—")}</b>`) +
    st("st-rt", `<span class="k">Results</span><b style="color:${rt === "l" ? "#ff8a8a" : "#ffd166"}">${rt === "l" ? "LIVE" : "TEST"}</b>`) +
    st("st-api", `<span class="k">AP access</span><b>${!s ? "unknown" : apOk ? "working" : "failing"}</b>`) +
    st("st-air", `<span class="k">A push ${onSite() ? "goes live in" : `reaches ${esc(prodHost())} in`}</span><b>≤ 5 s ticker · ≤ 10 s graphics</b>`);
  $("testbanner").hidden = rt !== "t";

  $("rtype").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.rt === rt));
  $("pause").textContent = paused ? "Resume polling" : "Pause polling";
  $("pause").classList.toggle("danger", !paused);
  $("pollersummary").textContent = s ? `${s.raceCount ?? "?"} races · ${s.called ?? "?"} called · last run ${ago(s.generated)} (${s.durationMs ?? "?"} ms)${(s.consecutiveFailures ?? 0) > 0 ? ` · ${s.consecutiveFailures} failures in a row` : ""}` : "no status yet";

  const problems = [];
  if (!index && runtime && !runtime.polling) problems.push({ warn: true, title: "No results on this laptop yet.", text: "The app was started with --no-poll and the local store holds no index. Start it without --no-poll, or run npm run poll, and the lists fill in within a minute." });
  if (paused) problems.push({ warn: true, title: "Polling is paused.", text: "No new AP data is being fetched. Everything keeps showing the last data. Open AP poller and press Resume polling." });
  else if (!s) problems.push({ title: "The poller has never written a status file.", text: "Open AP poller and press Poll now. If that fails, the error appears here in plain English." });
  else if (s.lastError && (s.consecutiveFailures ?? 0) > 0) problems.push({ title: `Last poll failed (${ago(s.lastError.at)}).`, text: s.lastError.text, fix: fixFor(s.lastError.code) });
  else if (age >= 180) problems.push({ warn: age < 600, title: `No successful poll for ${Math.round(age / 60)} minutes.`, text: "The cron should run every minute. Open AP poller and press Poll now: if it succeeds, the cron is not firing (check the Vercel project's Cron Jobs tab). If it fails, the error appears here." });
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
const raceLine = (r) => `<span class="lab">${esc(r.label)}</span>${kindBadge(r)}${esc(r.title)}${r.called ? ' <span class="pill call">AP CALL</span>' : ""}${draft.featuredRaceIds.includes(r.id) ? ICON_FEAT : ""}${draft.pinnedRaceIds.includes(r.id) ? ICON_TICK : ""}`;
function raceBand(r, { featured, position = null }) {
  const who = indName(r);
  return `<div class="raceband">${position ? `<span class="pos" title="Position ${position} in the Featured races list">${position}</span>` : ""}<span class="lab">${esc(r.label)}</span><span class="ttl">${esc(r.stateName)} · ${esc(r.title)}</span>${who ? `<span class="who">${esc(who)}</span>` : ""}
    <span class="meta">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results yet"}${r.called ? " · AP CALL" : ""}${r.rankedChoice ? " · ranked choice" : ""}</span>
    <button class="featbtn" data-pin="${r.id}">${draft.pinnedRaceIds.includes(r.id) ? "Remove from ticker" : "Add to ticker"}</button><button class="featbtn" data-feat="${r.id}">${featured ? "Remove from Featured" : "Set as Featured race"}</button></div>`;
}
const raceName = (id) => { const r = index?.byId?.get(id); return r ? `${r.label} (${r.stateName}, ${r.title})` : `race ${id}`; };
/** Adding or removing a race or chart is a real action: confirm it, then commit. Reorders need no confirmation. */
async function confirmThen(title, body, fn) {
  const ok = await ask({ title, body: `<p>${body}</p><p class="small muted">This changes only this page. Nothing ${onSite() ? "goes live" : `at ${esc(prodHost())} changes`} until you push.</p>`, ok: title.replace(/\?$/, "") });
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
const frame = $("preview");
function scalePreview() { frame.style.transform = `scale(${frame.parentElement.clientWidth / 1920})`; }
function sendPreview() {
  renderTickerOpen();
  if (view !== "local") return;
  frame.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  if (index) { const q = buildQueue(index.races, draft); $("previewnote").textContent = `${q.items.length} item${q.items.length === 1 ? "" : "s"}${q.missing.length ? ` · ${q.missing.length} not in the AP feed, skipped` : ""}`; }
}
frame.addEventListener("load", sendPreview);
window.addEventListener("resize", scalePreview);
function renderTickerNote() {
  $("tickernote").innerHTML = onSite()
    ? `This is a preview. The live ticker is <a href="/ticker?bg=black" target="_blank" rel="noopener">${esc(location.host)}/ticker</a> (add <code>?bg=green</code> for the key); to change it, Push with the buttons above. It re-reads the live settings every 5 seconds.`
    : `This is a local preview. The ticker everyone uses is <a href="${esc(runtime?.production?.origin ?? "")}/ticker?bg=black" target="_blank" rel="noopener">${esc(prodHost())}/ticker</a> (add <code>?bg=green</code> for the key); to change that one, Push with the buttons above. It re-reads what was last pushed every 5 seconds.`;
}
/** The ticker opens like any chart: at full size, showing whatever the previews show. */
function tickerOpenUrl() { const bg = $("bg").value; return `/ticker?src=${view}${bg ? `&bg=${bg}` : ""}`; }
function renderTickerOpen() {
  renderTickerNote();
  $("tickeropen").href = tickerOpenUrl();
}
$("previewframe").addEventListener("click", () => window.open(tickerOpenUrl(), "_blank", "noopener"));
$("bg").addEventListener("change", renderTickerOpen);

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
    box.innerHTML = rows.length ? rows.map((c) => `<div class="row" data-id="${c.id}"><div><div class="nm"><span class="lab">${esc(c.id)}</span>${esc(c.name)}${c.built ? "" : ' <span class="muted small">not built yet</span>'}</div></div><div class="btns"><button>+ Add</button></div></div>`).join("") : `<div class="empty">${q ? "No charts match." : "Every per-race chart is already featured."}</div>`;
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
const overviewName = (chart) => (seriesOf(chart.id) === "D" ? "Broad Races Overview" : "Movement Overview");
function renderMovement() {
  for (const [gridId, series] of [["movegrid", "C"], ["broadgrid", "D"]]) {
    const grid = $(gridId); grid.className = "cardgrid"; grid.innerHTML = "";
    for (const cid of draft.movementCharts.filter((id) => seriesOf(id) === series)) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      grid.appendChild(cards.card({ chart, priority: 3, open: "show", menu: [{ label: `Remove from ${overviewName(chart)}…`, onClick: () => toggleChart(chart.id) }] }));
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
  clearTimeout(pformTimer); pformTimer = setTimeout(() => { draft = saveLocal(normalize(draft)); renderStrip(); renderPersistent(); cards.prune(); cards.broadcast(draft); }, i.tagName === "SELECT" ? 0 : 600);
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
  renderStrip();
  renderPins(); renderManual(); sendPreview();
  renderDetail(); renderMovement(); renderPersistent(); renderCatalog(); renderChartCatalog();
  cards.prune();
}
// highlight the section in view
const secObs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) document.querySelectorAll("#sectionnav a").forEach((a) => a.classList.toggle("here", a.getAttribute("href") === `#${e.target.id}`));
}, { rootMargin: "-120px 0px -60% 0px" });
for (const id of ["ticker", "detail", "broad", "movement", "persistent", "catalog", "charts"]) secObs.observe($(id));

// ---------- boot ----------
let timers = [];
async function boot() {
  timers.forEach(clearInterval);
  draft = readLocal() ?? normalize(DEFAULTS);
  frame.src = `/ticker?preview=1&bg=black&src=local`;
  scalePreview();
  const loadRuntime = async () => { runtime = await fetch("/api/runtime", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); };
  await loadRuntime();
  await Promise.all([loadStatus(), loadIndex(), loadProd()]);
  renderAll();
  timers = [setInterval(loadStatus, 15_000), setInterval(loadIndex, 60_000), setInterval(loadProd, 20_000), setInterval(loadRuntime, 30_000), setInterval(() => { renderStatus(); renderStrip(); }, 10_000)];
}
(async () => {
  const me = await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  if (me.authed) { showApp(); boot(); } else showLogin();
})();
