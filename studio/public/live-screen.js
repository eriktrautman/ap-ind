// A Live Screen: /live-screen-a or /live-screen-b. Reads the published screen definition (chart id, race,
// state, parameters) every 5 seconds and shows that chart through its chart-id address (/g/B5?race=...), so
// the switcher points at one address forever and the producer changes what it shows by publishing.
// A change cross-fades: the new chart loads in a second frame underneath, and only once it has had time to
// draw does it fade in and the old frame go, so nothing flashes on air.
import { watchState, screenAddress } from "/g/control.js";

const which = /live-screen-b/.test(location.pathname) ? "screenB" : "screenA";
const q = new URLSearchParams(location.search);
if (q.get("bg")) document.body.classList.add(`bg-${q.get("bg")}`);
const display = { bg: q.get("bg") ?? "", opacity: q.get("opacity") ?? "", sample: q.get("sample") ?? "", src: q.get("src") ?? "" };
if (q.get("fit") === "1") {   // Preview from the control room: the 1920x1080 page scaled to the window
  const fit = () => { const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080, 1); document.body.style.transformOrigin = "0 0"; document.body.style.transform = `scale(${k})`; document.documentElement.style.overflow = "hidden"; };
  window.addEventListener("resize", fit); fit();
}

let current = null, currentAddr = null, pending = null;
function show(addr) {
  if (addr === currentAddr || addr === pending?.dataset.addr) return;
  if (pending) pending.remove();
  const f = document.createElement("iframe");
  f.title = "Live screen"; f.dataset.addr = addr; f.src = addr;
  pending = f;
  document.body.appendChild(f);
  f.addEventListener("load", () => setTimeout(() => {   // the router inside resolves and draws; give it a moment before the fade
    if (pending !== f) return;
    f.classList.add("on");
    const old = current; current = f; currentAddr = addr; pending = null;
    if (old) { old.classList.remove("on"); setTimeout(() => old.remove(), 400); }
    document.title = `Live Screen ${which.slice(-1)} · ${addr.replace(/^\/g\//, "").split("?")[0]}`;
  }, 1500));
}
watchState({ intervalMs: 5_000, onState: (s) => { const def = s[which]; if (def) show(screenAddress(def, display)); } });
