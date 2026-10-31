// Stylesheets (themes): every colour and face the outputs can draw from, by id, in one place.
//   - The published one is `theme` in producer.json (pushed from the Studio by a producer); every graphic, the ticker and
//     the live screens read it and repaint within seconds, with no redeploy.
//   - ?theme=<id> on any output's address overrides the published one for that page: the Studio's previews use it, and a
//     producer can look at any stylesheet on any output before pushing it.
//   - /styleguide draws every component from these tokens and lets you switch between them.
// Token names are the style guide's. AIR_VARS maps them onto the variables the graphics (public/g/g.css) and the ticker
// (studio/public/ticker.html) are actually written against, so a theme never has to know those names.
// Adding a stylesheet is adding an entry here: the same keys, new values; a key left out keeps the shipped default.

export const DEFAULT_THEME = "election-producer";

export const THEMES = {
  "election-producer": { name: "Election Producer (current)", tokens: {} },   // empty: the stylesheets' own defaults
  "election-night-v1": {
    name: "Election Night · Independent Edition (geniots, v1, 10.30.26)",
    tokens: {
      // Air, from the brand guide: the background gradient, the party colours, Helvetica Neue throughout. Independents
      // are gold in this guide (the product's default is purple). The accent blue is the production sheet's #9FAEF6.
      "--panel": "#1B1362", "--panel-edge": "#090E40", "--band-edge": "#090E40", "--fg": "#FFFFFF", "--fg-muted": "#9FAEF6", "--rule": "#2b2f72",
      "--dem": "#344FF5", "--gop": "#ED3C3C", "--ind": "#F9C515", "--call": "#F9C515", "--air-font": "'Helvetica Neue', Helvetica, Arial, sans-serif",
      // Studio: the guide defines no daylight page; its navy and its deck's gold are carried over, and the serif gives way.
      "--navy": "#090E40", "--navy-deep": "#02102f", "--gold": "#ae955e", "--local": "#344FF5",
      "--serif": "'Helvetica Neue', Helvetica, Arial, sans-serif",
    },
  },
  "slate-demo": {
    name: "Slate (demonstration)",
    tokens: {
      "--navy": "#1f2933", "--navy-deep": "#111827", "--gold": "#f59e0b", "--cream": "#f8fafc", "--sand": "#e2e8f0", "--ink": "#0f172a", "--muted": "#64748b",
      "--local": "#0e7490", "--ok": "#15803d", "--warn": "#d97706", "--bad": "#b91c1c",
      "--serif": "'Iowan Old Style', 'Palatino Linotype', Palatino, serif",
      "--panel": "#111827", "--panel-edge": "#1f2937", "--band-edge": "#273449", "--rule": "#334155", "--fg-muted": "#94a3b8",
      "--ind": "#8b5cf6", "--gop": "#dc2626", "--dem": "#2563eb", "--call": "#fbbf24",
      "--r-chip": "2px", "--r-field": "4px", "--r-panel": "4px", "--r-card": "6px",
    },
  },
};

/** Style-guide token → the variables the outputs are written against (graphics first, then the ticker's names). */
export const AIR_VARS = {
  "--panel": ["--panel", "--band"], "--panel-edge": ["--panel-edge"], "--band-edge": ["--band-edge"],
  "--fg": ["--fg"], "--fg-muted": ["--muted"], "--rule": ["--rule"],
  "--dem": ["--dem"], "--gop": ["--gop"], "--ind": ["--ind"], "--call": ["--gold", "--call"],
  "--air-font": ["--font"],
};

export const themeIds = () => Object.keys(THEMES);
export const themeName = (id) => THEMES[id]?.name ?? id;
/** A known id, else the default. */
export const themeId = (id) => (id && THEMES[id] ? id : DEFAULT_THEME);

/** Paint an output with a stylesheet: set its variables on the root (the default stylesheet is the absence of overrides). */
export function applyAirTheme(id, root = typeof document === "undefined" ? null : document.documentElement) {
  if (!root) return;
  const t = THEMES[themeId(id)];
  for (const outs of Object.values(AIR_VARS)) for (const v of outs) root.style.removeProperty(v);
  for (const [k, outs] of Object.entries(AIR_VARS)) { const val = t.tokens[k]; if (val) for (const v of outs) root.style.setProperty(v, val); }
  root.dataset.theme = themeId(id);
}

/** The stylesheet an address asks for (?theme=<id>), or null. */
export function urlTheme(search = typeof location === "undefined" ? "" : location.search) {
  const q = new URLSearchParams(search).get("theme");
  return q && THEMES[q] ? q : null;
}

let timer = null;
/** Keep this page on the right stylesheet: the address's if it names one, else the published one, re-read every 10 s
 *  from the CDN-cached producer.json (the same bucketed address the ticker and graphics already poll). */
export function watchTheme({ intervalMs = 10_000, onTheme } = {}) {
  if (typeof document === "undefined") return;
  const set = (id) => { applyAirTheme(id); onTheme?.(themeId(id)); };
  const fixed = urlTheme();
  if (fixed) { set(fixed); return; }
  const tick = async () => {
    try {
      const r = await fetch(`/data/producer.json?t=${Math.floor(Date.now() / 5000)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.status === 404) { set(DEFAULT_THEME); return; }
      if (r.ok) set((await r.json()).theme);
    } catch {}
  };
  tick();
  if (!timer) timer = setInterval(tick, intervalMs);
}
