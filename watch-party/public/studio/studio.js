// Studio: poller status and controls, ticker producer with live preview.
import { esc, kindBadge, fmtTime, testBanner } from "/app.js";
import { buildQueue } from "/ticker-queue.js";

const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { cache: "no-store", headers: { "content-type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error("signed out"); }
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
};
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};

// ---------- auth ----------
function showLogin() { $("login").hidden = false; $("app").hidden = true; $("logout").hidden = true; }
function showApp() { $("login").hidden = true; $("app").hidden = false; $("logout").hidden = false; }
$("loginform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginerr").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showApp();
    boot();
  } catch (err) {
    $("loginerr").textContent = err.message === "wrong password" ? "Wrong password." : err.message;
  }
});
$("logout").addEventListener("click", async () => { await fetch("/api/login", { method: "DELETE" }); showLogin(); });

// ---------- poller status ----------
let status = null, settings = null;
function renderStatus() {
  const s = status;
  const age = s?.lastApSuccess ? (Date.now() - Date.parse(s.lastApSuccess)) / 1000 : Infinity;
  const paused = settings?.pollEnabled === false;
  const cls = paused ? "warn" : !s ? "bad" : age < 180 ? "ok" : age < 600 ? "warn" : "bad";
  const label = paused ? "Polling paused" : !s ? "No status yet" : age < 180 ? "AP live" : age < 600 ? `AP data ${Math.round(age / 60)} min old` : "AP feed stale";
  $("status").innerHTML = `<span class="dot ${cls === "ok" ? "" : cls === "warn" ? "warn" : "bad"}"></span><span>${esc(label)}</span>`;
  testBanner(s);

  const rt = settings?.resultsType ?? settings?.envResultsType ?? s?.resultsType ?? "t";
  $("rtype").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.rt === rt));
  $("pause").textContent = paused ? "Resume polling" : "Pause polling";
  $("pause").classList.toggle("danger", !paused);

  const facts = [
    ["Last successful poll", ago(s?.lastApSuccess), cls],
    ["AP data as of", s?.apTimestamp ? fmtTime(s.apTimestamp) : "—"],
    ["Results type", rt === "l" ? "LIVE" : "TEST (AP simulation)", rt === "l" ? "bad" : "warn"],
    ["Races in feed", s?.raceCount ?? "—"],
    ["Called", s?.called ?? "—"],
    ["Last run", s?.generated ? `${ago(s.generated)} · ${s.durationMs ?? "?"} ms` : "—"],
    ["Failures in a row", s?.consecutiveFailures ?? 0, (s?.consecutiveFailures ?? 0) > 0 ? "bad" : ""],
  ];
  $("facts").innerHTML = facts.map(([k, v, c]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v ${c ?? ""}">${esc(String(v))}</div></div>`).join("");

  const p = $("problem");
  const problems = [];
  if (paused) problems.push({ warn: true, title: "Polling is paused.", text: "No new AP data is being fetched. Pages keep showing the last data. Press Resume polling." });
  else if (!s) problems.push({ title: "The poller has never written a status file.", text: "Press Poll now. If that fails, the error will appear here." });
  else if (s.lastError && (s.consecutiveFailures ?? 0) > 0) problems.push({ title: `Last poll failed (${ago(s.lastError.at)}).`, text: s.lastError.text, fix: fixFor(s.lastError.code) });
  else if (age >= 180) problems.push({ warn: age < 600, title: `No successful poll for ${Math.round(age / 60)} minutes.`, text: "The cron should run every minute. Press Poll now: if it succeeds, the cron is not firing (check the Vercel project's Cron Jobs tab). If it fails, the error will appear here." });
  if (s?.errors?.length && !(s.lastError && (s.consecutiveFailures ?? 0) > 0)) problems.push({ warn: true, title: "Last run finished with warnings.", list: s.errors });
  p.hidden = problems.length === 0;
  p.className = `problem ${problems.every((x) => x.warn) ? "warn" : ""}`;
  p.innerHTML = problems.map((x) => `<b>${esc(x.title)}</b>${x.text ? esc(x.text) : ""}${x.fix ? ` <span class="muted">${esc(x.fix)}</span>` : ""}${x.list ? `<ul>${x.list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`).join("");
}
function fixFor(code) {
  return {
    "ap-auth": "If the key was just changed in Vercel, the project needs a redeploy for functions to see it.",
    "ap-rate": "Do not press Poll now repeatedly.",
    "ap-timeout": "Try Poll now once more.",
    "ap-down": "Try Poll now in a minute.",
    "blob": "Nothing you can fix from here; the engineer needs to check the Blob store token.",
    "network": "Try Poll now once more.",
    "unknown": "Try Poll now + reset caches. If it persists, send this message to the engineer.",
  }[code] ?? "";
}
async function loadStatus() {
  try { status = await (await fetch(`/data/status.json?t=${Math.floor(Date.now() / 15_000)}`, { cache: "no-store" })).json(); } catch {}
  try { settings = await api("/api/settings"); } catch {}
  renderStatus();
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
    renderStatus();
    loadIndex();
  } catch (e) {
    msg.className = "note bad"; msg.textContent = `Poll request failed: ${e.message}`;
  } finally {
    for (const id of ["pollnow", "pollfresh"]) $(id).disabled = false;
  }
}
$("pollnow").addEventListener("click", () => runPoll(false));
$("pollfresh").addEventListener("click", () => runPoll(true));
$("pause").addEventListener("click", async () => {
  const paused = settings?.pollEnabled === false;
  if (!paused && !confirm("Pause polling? The ticker and watch party will stop getting new AP data until you resume.")) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, pollEnabled: paused }) });
  renderStatus();
  if (!paused) $("pollmsg").textContent = "Paused. Resume polling when ready.";
  else { $("pollmsg").textContent = "Resumed. Polling now…"; runPoll(false); }
});
$("rtype").querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
  const rt = b.dataset.rt;
  const cur = settings?.resultsType ?? settings?.envResultsType ?? "t";
  if (rt === cur) return;
  const warn = rt === "l" ? "Switch to LIVE results? The ticker and the public watch party will show real AP results from the next poll." : "Switch to AP TEST data? Real results will be replaced by AP's simulation on the next poll.";
  if (!confirm(warn)) return;
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ ...settings, resultsType: rt }) });
  renderStatus();
  runPoll(false);
}));

// ---------- ticker producer ----------
let index = null;
let published = null;        // last state read from or written to the server
let draft = { pinnedRaceIds: [], manualItems: [], idleText: "" };
let filter = "ind";
const dirty = () => JSON.stringify(norm(draft)) !== JSON.stringify(norm(published ?? {}));
const norm = (p) => ({ pinnedRaceIds: p.pinnedRaceIds ?? [], manualItems: (p.manualItems ?? []).map((m) => ({ id: m.id, text: m.text })), idleText: p.idleText ?? "" });

async function loadIndex() {
  try {
    index = await (await fetch(`/data/index.json?t=${Math.floor(Date.now() / 15_000)}`, { cache: "no-store" })).json();
    const states = [...new Set(index.races.map((r) => r.state))].sort();
    const sel = $("state"); const cur = sel.value;
    sel.innerHTML = `<option value="">All states</option>${states.map((s) => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("")}`;
    renderAvailable(); renderPins(); sendPreview();
  } catch {}
}
async function loadProducer() {
  try {
    const remote = await api("/api/producer");
    const changed = published && remote.updatedAt !== published.updatedAt;
    if (!published || !dirty()) { published = remote; draft = structuredClone(norm(remote)); renderPins(); renderManual(); $("idletext").value = draft.idleText; sendPreview(); }
    else if (changed) { published = remote; $("otherop").hidden = false; $("otherop").textContent = `Another operator published at ${fmtTime(remote.updatedAt)}. Your draft is not saved. Publish to overwrite theirs, or Discard changes to load it.`; }
    renderPubState();
  } catch {}
}
function renderPubState() {
  const d = dirty();
  $("publish").disabled = !d;
  $("discard").hidden = !d;
  $("pubstate").textContent = d ? "Unsaved changes" : published?.updatedAt ? `Published ${ago(published.updatedAt)}` : "Nothing published yet (ticker shows featured races)";
}
function matches(r) {
  const q = $("q").value.trim().toLowerCase();
  const st = $("state").value;
  if (st && r.state !== st) return false;
  if (filter === "ind" && !r.hasIndependent) return false;
  if (filter === "featured" && !r.featured) return false;
  if ((filter === "S" || filter === "H") && r.office !== filter) return false;
  if (filter === "governor" && r.kind !== "governor") return false;
  if (filter === "other" && ["federal", "governor"].includes(r.kind)) return false;
  if (q) {
    const hay = `${r.label} ${r.state} ${r.stateName} ${r.title} ${r.officeName} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
const cands = (r) => r.candidates.slice(0, 3).map((c) => `${esc(c.last ?? c.name)} ${c.independent ? "(I)" : c.party === "Dem" ? "(D)" : c.party === "GOP" ? "(R)" : ""}${r.totalVotes ? ` ${Number(c.pct).toFixed(1)}%` : ""}`).join(" · ");
function renderAvailable() {
  if (!index) return;
  const rows = index.races.filter(matches).sort((a, b) => a.label.localeCompare(b.label));
  $("count").textContent = `${rows.length} of ${index.races.length}`;
  const pinned = new Set(draft.pinnedRaceIds);
  $("available").innerHTML = rows.length ? rows.slice(0, 400).map((r) => `
    <div class="row ${pinned.has(r.id) ? "on" : ""}" data-id="${r.id}">
      <div><div class="nm"><span class="lab">${esc(r.label)}</span>${kindBadge(r)}${esc(r.title)}${r.called ? ' <span class="pill call">AP CALL</span>' : ""}</div><div class="sub">${esc(r.stateName)} · ${cands(r)}</div></div>
      <div class="btns"><button class="add">${pinned.has(r.id) ? "Added" : "+ Add"}</button></div>
    </div>`).join("") + (rows.length > 400 ? `<div class="empty">Showing 400. Narrow the search.</div>` : "") : `<div class="empty">No races match.</div>`;
}
function renderPins() {
  if (!index) return;
  const byId = new Map(index.races.map((r) => [r.id, r]));
  $("pincount").textContent = draft.pinnedRaceIds.length ? `${draft.pinnedRaceIds.length}` : "";
  $("pins").innerHTML = draft.pinnedRaceIds.length ? draft.pinnedRaceIds.map((id, i) => {
    const r = byId.get(id);
    return `<div class="row" data-id="${id}">
      <div><div class="nm"><span class="ord">${i + 1}</span>${r ? `<span class="lab">${esc(r.label)}</span>${esc(r.title)}` : `<span class="lab">${esc(id)}</span><span class="muted">not in the current AP feed; skipped on air</span>`}</div>${r ? `<div class="sub">${cands(r)}</div>` : ""}</div>
      <div class="btns"><button class="up" ${i === 0 ? "disabled" : ""}>▲</button><button class="down" ${i === draft.pinnedRaceIds.length - 1 ? "disabled" : ""}>▼</button><button class="rm">✕</button></div>
    </div>`;
  }).join("") : `<div class="empty">Nothing pinned. The ticker shows featured races until you add some.</div>`;
  renderPubState();
}
function renderManual() {
  $("manual").innerHTML = draft.manualItems.length ? draft.manualItems.map((m) => `<div class="row manual" data-id="${esc(m.id)}"><div class="nm">${esc(m.text)}</div><div class="btns"><button class="rm">✕</button></div></div>`).join("") : "";
  renderPubState();
}
function changed() { renderAvailable(); renderPins(); renderManual(); sendPreview(); }
$("available").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row || !e.target.closest("button")) return;
  const id = row.dataset.id;
  if (draft.pinnedRaceIds.includes(id)) draft.pinnedRaceIds = draft.pinnedRaceIds.filter((x) => x !== id);
  else draft.pinnedRaceIds.push(id);
  changed();
});
$("pins").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); const b = e.target.closest("button"); if (!row || !b) return;
  const i = draft.pinnedRaceIds.indexOf(row.dataset.id); if (i < 0) return;
  if (b.classList.contains("rm")) draft.pinnedRaceIds.splice(i, 1);
  else if (b.classList.contains("up") && i > 0) [draft.pinnedRaceIds[i - 1], draft.pinnedRaceIds[i]] = [draft.pinnedRaceIds[i], draft.pinnedRaceIds[i - 1]];
  else if (b.classList.contains("down") && i < draft.pinnedRaceIds.length - 1) [draft.pinnedRaceIds[i + 1], draft.pinnedRaceIds[i]] = [draft.pinnedRaceIds[i], draft.pinnedRaceIds[i + 1]];
  changed();
});
$("manual").addEventListener("click", (e) => {
  const row = e.target.closest(".row"); if (!row || !e.target.closest(".rm")) return;
  draft.manualItems = draft.manualItems.filter((m) => m.id !== row.dataset.id);
  changed();
});
$("addmanual").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("manualtext").value.trim(); if (!text) return;
  draft.manualItems.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text });
  $("manualtext").value = "";
  changed();
});
$("idletext").addEventListener("input", () => { draft.idleText = $("idletext").value; renderPubState(); sendPreview(); });
$("q").addEventListener("input", renderAvailable);
$("state").addEventListener("change", renderAvailable);
document.querySelectorAll(".filters .chip").forEach((c) => c.addEventListener("click", () => {
  filter = c.dataset.f === filter ? "all" : c.dataset.f;
  document.querySelectorAll(".filters .chip").forEach((x) => x.classList.toggle("on", x.dataset.f === filter));
  renderAvailable();
}));
$("publish").addEventListener("click", async () => {
  $("publish").disabled = true; $("pubstate").textContent = "Publishing…";
  try {
    published = await api("/api/producer", { method: "PUT", body: JSON.stringify(draft) });
    draft = structuredClone(norm(published));
    $("otherop").hidden = true;
    changed();
  } catch (e) {
    $("pubstate").textContent = `Publish failed: ${e.message}`; $("publish").disabled = false;
  }
});
$("discard").addEventListener("click", () => {
  draft = structuredClone(norm(published ?? {})); $("idletext").value = draft.idleText; $("otherop").hidden = true; changed();
});

// ---------- preview ----------
const frame = $("preview");
function scalePreview() {
  const w = frame.parentElement.clientWidth;
  frame.style.transform = `scale(${w / 1920})`;
}
function sendPreview() {
  frame.contentWindow?.postMessage({ type: "producer", state: draft }, "*");
  if (index) {
    const q = buildQueue(index.races, draft);
    $("previewnote").textContent = q.source === "pins" ? `${q.items.length} items` : q.source === "default" ? "nothing pinned: showing featured races" : "nothing pinned and no featured races: idle crawl";
  }
}
frame.addEventListener("load", sendPreview);
window.addEventListener("resize", scalePreview);
$("tickerurl").textContent = `${location.origin}/ticker`;

// ---------- boot ----------
let timers = [];
async function boot() {
  timers.forEach(clearInterval);
  scalePreview();
  await Promise.all([loadStatus(), loadIndex(), loadProducer()]);
  timers = [setInterval(loadStatus, 15_000), setInterval(loadIndex, 60_000), setInterval(loadProducer, 20_000), setInterval(renderPubState, 10_000)];
}
(async () => {
  const me = await fetch("/api/login", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  if (me.authed) { showApp(); boot(); } else showLogin();
})();
