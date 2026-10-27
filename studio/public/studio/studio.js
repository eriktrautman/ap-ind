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
let view = "local";           // what the thumbnails and the example ticker show: the working copy, or production
const cards = createCardManager({ maxLive: 12, getBg: () => $("bg").value, getSource: () => view, getDraft: () => (view === "local" ? draft : null) });
cards.onBudget((live, wanting) => { $("thumbbudget").textContent = wanting > live ? `${live} of ${wanting} previews live (budget ${12})` : live ? `${live} live previews` : ""; });

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
    for (const id of ["state", "cstate"]) { const sel = $(id); const cur = sel.value; sel.innerHTML = `<option value="">All states</option>${states.map((s) => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("")}`; }
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
const prodName = () => runtime?.production?.where === "self" ? "this laptop (standby)" : runtime?.production?.origin?.replace(/^https?:\/\//, "") ?? "air";

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
  const st = $("ps-state");
  st.className = d ? "dirty" : "same";
  st.textContent = !prod ? "Working copy: production unknown" : d ? `Working copy: ${changes.length} change${changes.length === 1 ? "" : "s"} vs production` : "Working copy = production";
  $("ps-sub").textContent = readLocal()?.updatedAt ? `saved ${ago(readLocal().updatedAt)}` : "";
  const p = $("ps-prod");
  const r = runtime?.production;
  const pub = prod?.updatedAt ? `published ${ago(prod.updatedAt)}${otherOperator() ? " · changed since your last pull" : ""}` : "never published (defaults)";
  if (runtime && r && !r.reachable) { p.className = "bad"; p.textContent = `Production: ${prodName()} · unreachable`; $("ps-prodsub").textContent = ""; }
  else if (prodError) { p.className = "bad"; p.textContent = `Production: ${prodName()} · unreadable`; $("ps-prodsub").textContent = ""; }
  else if (runtime && r && !r.canPush) { p.className = "warn"; p.textContent = `Production: ${prodName()} · pull only`; $("ps-prodsub").textContent = `no GLOBAL_PASSWORD · ${pub}`; }
  else { p.className = ""; p.textContent = `Production: ${prodName()}`; $("ps-prodsub").textContent = pub; }
  $("push").disabled = !canPush() || !d;
  $("push").title = !canPush() ? (r?.reason ?? "push unavailable") : !d ? "Your working copy already matches production" : `Overwrite production with your working copy (${changes.length} changes)`;
  $("pull").disabled = !canPull() || !prod;
  $("pull").title = !canPull() ? (r?.reason ?? prodError ?? "pull unavailable") : "Replace your working copy with production";
}

async function pushToProduction() {
  if (!canPush()) return;
  let latest = prod;
  try { latest = normalize(await api("/api/producer")); prod = latest; prodError = null; } catch (e) { prodError = e.message; }
  const changes = diffState(latest ?? DEFAULTS, draft);
  const someoneElse = latest && latest.updatedAt !== prodSeenAt;
  const ok = await ask({
    title: `Push to production (${prodName()})? This goes on air.`,
    body: `<p>Production is overwritten with your working copy. The on-air ticker re-reads it within 5 seconds; graphics within 10.</p>
      ${changeList(changes)}
      <p class="small muted">Production last published: ${latest?.updatedAt ? esc(fmtTime(latest.updatedAt)) + " (" + esc(ago(latest.updatedAt)) + ")" : "never"}.</p>
      ${someoneElse ? `<div class="warnline bad">Production changed at ${esc(fmtTime(latest.updatedAt))}, after you last pulled or pushed. Pushing now overwrites that. Pull first if you want to see it.</div>` : ""}
      ${!changes.length ? `<div class="warnline">Nothing differs from production.</div>` : ""}`,
    ok: "Push to production", danger: true,
  });
  if (!ok) return;
  try {
    const saved = normalize(await api("/api/producer", { method: "PUT", body: JSON.stringify(draft) }));
    prod = saved; prodSeenAt = saved.updatedAt; prodError = null;
    draft = saveLocal(structuredClone(saved));
    renderAll(); cards.broadcast(draft);
  } catch (e) {
    await ask({ title: "Push failed", body: `<div class="warnline bad">${esc(e.message)}</div><p>Nothing changed on production. Your working copy is still saved here.</p>`, ok: "OK" });
  }
}
async function pullFromProduction() {
  let latest;
  try { latest = normalize(await api("/api/producer")); prod = latest; prodError = null; }
  catch (e) { prodError = e.message; renderStrip(); await ask({ title: "Production is unreadable", body: `<div class="warnline bad">${esc(e.message)}</div><p>Your working copy is unchanged.</p>`, ok: "OK" }); return; }
  const changes = diffState(draft, latest);
  const ok = await ask({
    title: `Pull from production (${prodName()})? Your working copy is overwritten.`,
    body: `<p>Production, last published ${latest.updatedAt ? esc(ago(latest.updatedAt)) : "never (the defaults)"}, replaces what you have here. Nothing on air changes.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">Your working copy already matches production.</div>` : ""}`,
    ok: "Pull from production", danger: changes.length > 0,
  });
  if (!ok) return;
  prodSeenAt = latest.updatedAt;
  draft = saveLocal(structuredClone(latest));
  renderAll(); cards.broadcast(draft);
}
async function restoreDefaults() {
  const changes = diffState(draft, DEFAULTS);
  const ok = await ask({ title: "Restore the shipped defaults? Your working copy is overwritten.", body: `<p>Nothing on air changes until you push.</p>${changeList(changes)}${!changes.length ? `<div class="warnline">Your working copy already matches the defaults.</div>` : ""}`, ok: "Restore defaults", danger: changes.length > 0 });
  if (!ok) return;
  draft = saveLocal(normalize(DEFAULTS));
  renderAll(); cards.broadcast(draft);
}
$("push").addEventListener("click", pushToProduction);
$("pull").addEventListener("click", pullFromProduction);
$("defaults").addEventListener("click", restoreDefaults);
$("previewsel").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  $("previewsel").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  frame.contentWindow?.postMessage({ type: "producer-source", source: view }, "*");
  if (view === "local") sendPreview();
  cards.refreshSource();
  if (view === "local") cards.broadcast(draft);
}));

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
    st("st-air", `<span class="k">Push reaches air in</span><b>≤ 5 s ticker · ≤ 10 s graphics</b>`);
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
  if (!paused && !(await ask({ title: "Pause polling?", body: "<p>The ticker, every graphic and the watch party stop getting new AP data until you resume.</p>", ok: "Pause", danger: true }))) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, pollEnabled: paused }) });
  renderStatus();
  if (!paused) $("pollmsg").textContent = "Paused. Resume polling when ready.";
  else { $("pollmsg").textContent = "Resumed. Polling now…"; runPoll(false); }
});
$("rtype").querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
  const rt = b.dataset.rt;
  const cur = settings?.resultsType ?? settings?.envResultsType ?? "t";
  if (rt === cur) return;
  const body = rt === "l" ? "<p>The ticker, every graphic and the public watch party show real AP results from the next poll.</p>" : "<p>Real results are replaced by AP's simulation on the next poll.</p>";
  if (!(await ask({ title: rt === "l" ? "Switch to LIVE results?" : "Switch to AP TEST data?", body, ok: rt === "l" ? "Go live" : "Use test data", danger: rt === "l" }))) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, resultsType: rt }) });
  renderStatus(); runPoll(false);
}));

// ---------- shared race rendering ----------
const cands = (r) => r.candidates.slice(0, 3).map((c) => `${esc(c.last ?? c.name)} ${c.independent || c.featured ? "(I)" : c.party === "Dem" ? "(D)" : c.party === "GOP" ? "(R)" : ""}${r.totalVotes ? ` ${Number(c.pct).toFixed(1)}%` : ""}`).join(" · ");
const indName = (r) => FEATURED_RACES.find((f) => f.id === r.id)?.who ?? r.candidates.find((c) => c.featured)?.name ?? r.candidates.find((c) => c.independent)?.name ?? null;
const raceLine = (r) => `<span class="lab">${esc(r.label)}</span>${kindBadge(r)}${esc(r.title)}${r.called ? ' <span class="pill call">AP CALL</span>' : ""}${r.featured ? ' <span class="pill feat">FEATURED</span>' : ""}`;
function raceBand(r, { featured }) {
  const who = indName(r);
  return `<div class="raceband"><span class="lab">${esc(r.label)}</span><span class="ttl">${esc(r.stateName)} · ${esc(r.title)}</span>${who ? `<span class="who">${esc(who)}</span>` : ""}
    <span class="meta">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results yet"}${r.called ? " · AP CALL" : ""}${r.rankedChoice ? " · ranked choice" : ""}</span>
    <button class="featbtn" data-feat="${r.id}">${featured ? "Remove from Featured" : "Set as Featured race"}</button></div>`;
}
function toggleFeatured(id) {
  draft.featuredRaceIds = draft.featuredRaceIds.includes(id) ? draft.featuredRaceIds.filter((x) => x !== id) : [...draft.featuredRaceIds, id];
  commit();
}

// ---------- Ticker section ----------
let filter = "ind";
function matches(r) {
  const q = $("q").value.trim().toLowerCase();
  const st = $("state").value;
  if (st && r.state !== st) return false;
  if (filter === "ind" && !r.hasIndependent) return false;
  if (filter === "featured" && !draft.featuredRaceIds.includes(r.id)) return false;
  if ((filter === "S" || filter === "H") && r.office !== filter) return false;
  if (filter === "governor" && r.kind !== "governor") return false;
  if (filter === "other" && ["federal", "governor"].includes(r.kind)) return false;
  if (q) { const hay = `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.officeName} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase(); if (!hay.includes(q)) return false; }
  return true;
}
function renderAvailable() {
  if (!index) return;
  const rows = index.races.filter(matches).sort((a, b) => a.label.localeCompare(b.label));
  $("count").textContent = `${rows.length} of ${index.races.length}`;
  const pinned = new Set(draft.pinnedRaceIds);
  $("available").innerHTML = rows.length ? rows.slice(0, 400).map((r) => `
    <div class="row ${pinned.has(r.id) ? "on" : ""}" data-id="${r.id}">
      <div><div class="nm">${raceLine(r)}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div>
      <div class="btns"><button class="add">${pinned.has(r.id) ? "On ticker" : "+ Add"}</button></div>
    </div>`).join("") + (rows.length > 400 ? `<div class="empty">Showing 400. Narrow the search.</div>` : "") : `<div class="empty">No races match.</div>`;
}
function renderPins() {
  if (!index) return;
  $("pincount").textContent = `${draft.pinnedRaceIds.length}`;
  $("pins").innerHTML = draft.pinnedRaceIds.map((id, i) => {
    const r = index.byId.get(id);
    return `<div class="row" data-id="${id}">
      <div><div class="nm"><span class="ord">${i + 1}</span>${r ? raceLine(r) : `<span class="lab">${esc(id)}</span><span class="muted">not in the current AP feed; skipped on air</span>`}</div>${r ? `<div class="sub">${cands(r)}</div>` : ""}</div>
      <div class="btns"><button class="up" ${i === 0 ? "disabled" : ""}>▲</button><button class="down" ${i === draft.pinnedRaceIds.length - 1 ? "disabled" : ""}>▼</button><button class="rm" ${draft.pinnedRaceIds.length === 1 ? 'title="At least one race stays on the ticker"' : ""}>✕</button></div>
    </div>`;
  }).join("");
}
function renderManual() {
  $("manual").innerHTML = draft.manualItems.length ? draft.manualItems.map((m) => `<div class="row manual" data-id="${esc(m.id)}"><div class="nm">${esc(m.text)}</div><div class="btns"><button class="rm">✕</button></div></div>`).join("") : "";
  if (document.activeElement !== $("idletext")) $("idletext").value = draft.idleText;
  $("callhl").checked = draft.callHighlight;
}
$("available").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row || !e.target.closest("button")) return;
  const id = row.dataset.id;
  if (draft.pinnedRaceIds.includes(id)) { if (draft.pinnedRaceIds.length > 1) draft.pinnedRaceIds = draft.pinnedRaceIds.filter((x) => x !== id); }
  else draft.pinnedRaceIds.push(id);
  commit();
});
$("pins").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!row || !b) return;
  const a = draft.pinnedRaceIds; const i = a.indexOf(row.dataset.id); if (i < 0) return;
  if (b.classList.contains("rm")) { if (a.length > 1) a.splice(i, 1); else { a.splice(0, a.length, ...DEFAULTS.pinnedRaceIds); } }
  else if (b.classList.contains("up") && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
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
$("q").addEventListener("input", renderAvailable);
$("state").addEventListener("change", renderAvailable);
document.querySelectorAll("#ticker .filters .chip").forEach((c) => c.addEventListener("click", () => {
  filter = c.dataset.f === filter ? "all" : c.dataset.f;
  document.querySelectorAll("#ticker .filters .chip").forEach((x) => x.classList.toggle("on", x.dataset.f === filter));
  renderAvailable();
}));
const frame = $("preview");
function scalePreview() { frame.style.transform = `scale(${frame.parentElement.clientWidth / 1920})`; }
function sendPreview() {
  if (view !== "local") return;
  frame.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  if (index) { const q = buildQueue(index.races, draft); $("previewnote").textContent = `${q.items.length} items · ${q.source === "idle" ? "idle crawl" : q.source === "default" ? "default races" : "your race list"}${q.missing.length ? ` · ${q.missing.length} not in feed` : ""}`; }
}
frame.addEventListener("load", sendPreview);
window.addEventListener("resize", scalePreview);
$("tickerurl").textContent = `${location.origin}/ticker`;

// ---------- Race Detail section ----------
function renderDetail() {
  if (!index) return;
  $("featcount").textContent = `${draft.featuredRaceIds.length}`;
  $("featured").innerHTML = draft.featuredRaceIds.length ? draft.featuredRaceIds.map((id, i) => {
    const r = index.byId.get(id);
    return `<div class="row" data-id="${id}"><div><div class="nm"><span class="ord">${i + 1}</span>${r ? raceLine(r) : `<span class="lab">${esc(id)}</span><span class="muted">not in the current AP feed</span>`}</div>${r ? `<div class="sub">${esc(r.stateName)}${indName(r) ? " · " + esc(indName(r)) : ""} · ${cands(r)}</div>` : ""}</div>
      <div class="btns"><button class="up" ${i === 0 ? "disabled" : ""}>▲</button><button class="down" ${i === draft.featuredRaceIds.length - 1 ? "disabled" : ""}>▼</button><button class="rm">✕</button></div></div>`;
  }).join("") : `<div class="empty">No featured races. Add one below or from the catalog.</div>`;
  const raceCharts = CHARTS.filter((c) => c.kind === "race");
  $("racecharts").innerHTML = raceCharts.map((c) => `<label class="${draft.featuredCharts.includes(c.id) ? "on" : ""} ${c.built ? "" : "unbuilt"}"><input type="checkbox" data-chart="${c.id}" ${draft.featuredCharts.includes(c.id) ? "checked" : ""}><span class="cid">${c.id}</span>${esc(c.name)}${c.built ? "" : ' <span class="soon">not built yet</span>'}</label>`).join("");
  const grid = $("racegrid");
  grid.innerHTML = "";
  draft.featuredRaceIds.forEach((id, i) => {
    const r = index.byId.get(id);
    const row = document.createElement("div"); row.className = "racerow";
    if (!r) { row.innerHTML = `<div class="raceband"><span class="lab">${esc(id)}</span><span class="ttl">Not in the current AP feed</span><button class="featbtn" data-feat="${esc(id)}">Remove from Featured</button></div>`; grid.appendChild(row); return; }
    row.innerHTML = raceBand(r, { featured: true });
    const cg = document.createElement("div"); cg.className = "cardgrid";
    for (const cid of draft.featuredCharts) {
      const chart = CHARTS.find((c) => c.id === cid); if (!chart) continue;
      if (chart.only && !chart.only(r)) continue;
      cg.appendChild(cards.card({ chart, race: r, priority: i === 0 ? 1 : 2 }));
    }
    if (!cg.children.length) cg.innerHTML = `<div class="empty">No featured charts selected.</div>`;
    row.appendChild(cg); grid.appendChild(row);
  });
}
$("featured").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!row || !b) return;
  const a = draft.featuredRaceIds; const i = a.indexOf(row.dataset.id); if (i < 0) return;
  if (b.classList.contains("rm")) a.splice(i, 1);
  else if (b.classList.contains("up") && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  else if (b.classList.contains("down") && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  commit();
});
$("racecharts").addEventListener("change", (e) => {
  const id = e.target.dataset.chart; if (!id) return;
  draft.featuredCharts = e.target.checked ? [...draft.featuredCharts, id] : draft.featuredCharts.filter((x) => x !== id);
  draft.featuredCharts = CHARTS.filter((c) => draft.featuredCharts.includes(c.id)).map((c) => c.id);
  commit();
});
$("featq").addEventListener("input", () => {
  const q = $("featq").value.trim().toLowerCase(); const box = $("featsuggest");
  if (!q || !index) { box.hidden = true; return; }
  const rows = index.races.filter((r) => !draft.featuredRaceIds.includes(r.id) && `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q)).slice(0, 12);
  box.hidden = false;
  box.innerHTML = rows.length ? rows.map((r) => `<div class="row" data-id="${r.id}"><div><div class="nm">${raceLine(r)}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div><div class="btns"><button>+ Feature</button></div></div>`).join("") : `<div class="empty">No races match.</div>`;
});
$("featsuggest").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row) return;
  draft.featuredRaceIds.push(row.dataset.id); $("featq").value = ""; $("featsuggest").hidden = true; commit();
});
document.addEventListener("click", (e) => { if (!e.target.closest(".addfeat")) $("featsuggest").hidden = true; });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-feat]"); if (b) toggleFeatured(b.dataset.feat); });

// ---------- Movement Overview ----------
function renderMovement() {
  const moveCharts = CHARTS.filter((c) => c.kind === "movement");
  $("movecharts").innerHTML = moveCharts.map((c) => `<label class="${draft.movementCharts.includes(c.id) ? "on" : ""} ${c.built ? "" : "unbuilt"}"><input type="checkbox" data-chart="${c.id}" ${draft.movementCharts.includes(c.id) ? "checked" : ""}><span class="cid">${c.id}</span>${esc(c.name)}${c.built ? "" : ' <span class="soon">not built yet</span>'}</label>`).join("");
  const grid = $("movegrid"); grid.className = "cardgrid"; grid.innerHTML = "";
  for (const cid of draft.movementCharts) { const chart = CHARTS.find((c) => c.id === cid); if (chart) grid.appendChild(cards.card({ chart, priority: 3 })); }
  if (!grid.children.length) grid.innerHTML = `<div class="empty">No movement charts selected.</div>`;
}
$("movecharts").addEventListener("change", (e) => {
  const id = e.target.dataset.chart; if (!id) return;
  const set = new Set(draft.movementCharts); e.target.checked ? set.add(id) : set.delete(id);
  draft.movementCharts = CHARTS.filter((c) => set.has(c.id)).map((c) => c.id);
  commit();
});

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
    crow.innerHTML = `<div class="row"><div><div class="nm">${raceLine(r)}${featured && !r.featured ? ' <span class="pill feat">FEATURED</span>' : ""}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div><div class="btns nums muted small">${r.totalVotes ? `${Math.round(r.eevp || r.precinctsPct)}% in` : "no results"}</div></div>`;
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
    const el = cards.card({ chart, race: r, priority: 9, isStatic: true });
    const on = draft.featuredCharts.includes(chart.id);
    el.querySelector(".gfoot").insertAdjacentHTML("afterbegin", `<button class="featchart" data-chart="${chart.id}" title="Featured charts apply to every featured race">${on ? "★ Featured chart" : "☆ Make featured chart"}</button>`);
    cg.appendChild(el);
  }
  body.appendChild(cg);
  return body;
}
$("catalogList").addEventListener("click", (e) => {
  const fc = e.target.closest(".featchart");
  if (fc) {
    const id = fc.dataset.chart; const set = new Set(draft.featuredCharts); set.has(id) ? set.delete(id) : set.add(id);
    draft.featuredCharts = CHARTS.filter((c) => set.has(c.id)).map((c) => c.id); commit(); return;
  }
  if (e.target.closest("[data-feat]") || e.target.closest(".gcard")) return;
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

// ---------- render everything ----------
function renderAll() {
  renderStatus();
  renderStrip();
  renderAvailable(); renderPins(); renderManual(); sendPreview();
  renderDetail(); renderMovement(); renderCatalog();
  cards.prune();
}
// highlight the section in view
const secObs = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) document.querySelectorAll("#sectionnav a").forEach((a) => a.classList.toggle("here", a.getAttribute("href") === `#${e.target.id}`));
}, { rootMargin: "-120px 0px -60% 0px" });
for (const id of ["ticker", "detail", "movement", "catalog"]) secObs.observe($(id));

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
