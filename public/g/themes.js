// Stylesheets (themes): every colour and face the outputs can draw from, by id, in one place.
//   - The published one is `theme` in producer.json (pushed from the Studio by a producer); every graphic, the ticker and
//     the live screens read it and repaint within seconds, with no redeploy.
//   - ?theme=<id> on any output's address overrides the published one for that page: the Studio's previews use it, and a
//     producer can look at any stylesheet on any output before pushing it.
//   - /styleguide draws every component from these tokens and lets you switch between them.
// Token names are the style guide's. AIR_VARS maps them onto the variables the graphics (public/g/g.css) and the ticker
// (studio/public/ticker.html) are actually written against, so a theme never has to know those names.
// Adding a stylesheet is adding an entry here: the same keys, new values; a key left out keeps the shipped default. `font` is
// the address of a web font's stylesheet, for a theme whose face isn't on every machine.
// Every output page loads /g/theme-boot.js first thing in <head>: a classic script the build generates from this file
// (studio/scripts/theme-boot.mjs) that applies ?theme=, else the last published stylesheet this browser saw, else the
// default, before the first paint, so a page never flashes from its written-in colours to the live ones.

export const DEFAULT_THEME = "election-night-v1";   // the stylesheet a fresh state and an unpushed site use

export const THEMES = {
  "election-producer": { name: "Election Producer", tokens: {} },   // empty: the stylesheets' own values, the look the pages are written in
  "election-night-v1": {
    name: "geniots, v1, 10.30.26",
    tokens: {
      // Air, from the brand guide: the background gradient, the party colours, Helvetica Neue throughout. Independents
      // are gold in this guide (the product's default is purple); anything written on gold uses --ind-fg (dark), never
      // white. The accent blue is the production sheet's #9FAEF6. The ticker's layout under this stylesheet (the logo
      // block, uppercase crawl, bullet separators) is in ticker.html, keyed on html[data-theme].
      "--panel": "#1B1362", "--panel-edge": "#090E40", "--band-edge": "#090E40", "--fg": "#FFFFFF", "--fg-muted": "#9FAEF6", "--rule": "#2b2f72",
      "--dem": "#344FF5", "--gop": "#ED3C3C", "--ind": "#F9C515", "--ind-fg": "#1a1600", "--call": "#F9C515", "--air-font": "'Helvetica Neue', Helvetica, Arial, sans-serif",
      // Studio: the guide defines no daylight page; its navy and its deck's gold are carried over, and the serif gives way.
      "--navy": "#090E40", "--navy-deep": "#02102f", "--gold": "#ae955e", "--local": "#344FF5",
      "--serif": "'Helvetica Neue', Helvetica, Arial, sans-serif",
    },
  },
  "democracy-dashboard": {
    name: "Democracy Dashboard",
    // From democracy-dashboard's lib/design/tokens.ts: light stone surfaces (nothing pure black or grey), its party series, and violet independents.
    // Geist is its face. Amber, its one warning family, stands in for the gold accent, since yellow can't be read on white.
    font: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;700&display=swap",
    tokens: {
      "--panel": "#ffffff", "--panel-edge": "#fafaf9", "--band-edge": "#f5f5f4", "--fg": "#1c1917", "--fg-muted": "#78716c", "--rule": "#e7e5e4",
      "--dem": "#2A56BF", "--gop": "#C4442E", "--ind": "#8A78EE", "--ind-fg": "#ffffff", "--call": "#D97706", "--air-font": "Geist, ui-sans-serif, system-ui, sans-serif",
      "--none": "#f5f5f4", "--behind": "#a8a29e", "--well": "#f5f5f4", "--who-ind": "#6D5BD0", "--behind-text": "#78716c", "--soft": "#44403c", "--hatch": "#d6d3d1", "--map-line": "#a8a29e", "--tile-none": "#a8a29e",
      "--navy": "#292524", "--navy-deep": "#1c1917", "--gold": "#D97706", "--cream": "#fafaf9", "--sand": "#e7e5e4", "--ink": "#1c1917", "--muted": "#78716c",
      "--local": "#2F7BB0", "--ok": "#52A86B", "--warn": "#D97706", "--bad": "#C4442E",
      "--serif": "Geist, ui-sans-serif, system-ui, sans-serif", "--mono": "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      "--r-chip": "4px", "--r-field": "6px", "--r-panel": "8px", "--r-card": "8px",
    },
  },
  "slate-demo": {
    name: "Slate",
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

// Shareable: charts meant to be posted, on Democracy Dashboard's light colours and face. What sets it apart is in g.css: the byline shows, the
// source dot is gray, the source is AP alone, the Updated stamp carries date and time, and a page that names no background is black.
THEMES.shareable = { ...THEMES["democracy-dashboard"], name: "Shareable" };

/** Style-guide token → the variables the outputs are written against (graphics first, then the ticker's names). */
export const AIR_VARS = {
  "--panel": ["--panel", "--band"], "--panel-edge": ["--panel-edge"], "--band-edge": ["--band-edge"],
  "--fg": ["--fg"], "--fg-muted": ["--muted"], "--rule": ["--rule"],
  "--dem": ["--dem"], "--gop": ["--gop"], "--ind": ["--ind"], "--ind-fg": ["--ind-fg"], "--call": ["--gold", "--call"],
  "--air-font": ["--font"], "--none": ["--none"], "--behind": ["--behind"],
  // Colours the graphics wrote in for a dark panel, for a theme that isn't one. A theme without them keeps what's written.
  "--well": ["--well"], "--who-ind": ["--who-ind"], "--behind-text": ["--behind-text"], "--soft": ["--soft"], "--hatch": ["--hatch"], "--map-line": ["--map-line"], "--tile-none": ["--tile-none"],
};

export const themeIds = () => Object.keys(THEMES);
export const themeName = (id) => THEMES[id]?.name ?? id;
/** The name for a dropdown: the default one says so. */
export const themeLabel = (id) => `${themeName(id)}${id === DEFAULT_THEME ? " (default)" : ""}`;
/** A known id, else the default. */
export const themeId = (id) => (id && THEMES[id] ? id : DEFAULT_THEME);

/** A stylesheet's own typeface, when it names one. The page's font stack carries on with its fallback until this loads, and if it never does. */
function loadThemeFont(href, doc) {
  doc?.getElementById("ep-theme-font")?.remove();
  if (!href || !doc?.head) return;
  const l = doc.createElement("link"); l.id = "ep-theme-font"; l.rel = "stylesheet"; l.href = href; doc.head.append(l);
}

/** Paint an output with a stylesheet: set its variables on the root (the default stylesheet is the absence of overrides). */
export function applyAirTheme(id, root = typeof document === "undefined" ? null : document.documentElement) {
  if (!root) return;
  const t = THEMES[themeId(id)];
  try { if (!urlTheme()) localStorage.setItem("ep.theme", themeId(id)); } catch {}   // what /g/theme-boot.js paints with before the first paint next time
  for (const outs of Object.values(AIR_VARS)) for (const v of outs) root.style.removeProperty(v);
  for (const [k, outs] of Object.entries(AIR_VARS)) { const val = t.tokens[k]; if (val) for (const v of outs) root.style.setProperty(v, val); }
  root.dataset.theme = themeId(id);
  loadThemeFont(t.font, root.ownerDocument);
  root.ownerDocument?.dispatchEvent(new Event("ep-theme"));   // this just rewrote the panel colours; control.js puts ?opacity= back before the next paint
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
