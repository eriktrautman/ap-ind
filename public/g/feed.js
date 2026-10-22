// Shared data feed for graphics pages: WebSocket with automatic reconnect and a
// polling fallback, plus a freshness indicator every page can show.
// Usage: const feed = connectFeed({ onSnapshot, onUpdate, onTicker, onStatus });

export function connectFeed(handlers) {
  const state = { races: new Map(), status: null, ticker: [], connected: false };
  let ws = null;
  let pollTimer = null;

  function apply(msg) {
    if (msg.type === "snapshot") {
      state.races = new Map(msg.races.map((r) => [r.id, r]));
      state.status = msg.status;
      state.ticker = msg.ticker;
      handlers.onSnapshot?.(state, msg);
    } else if (msg.type === "update") {
      for (const r of msg.changed) state.races.set(r.id, r);
      state.status = msg.status;
      state.ticker = msg.ticker;
      handlers.onUpdate?.(state, msg);
    } else if (msg.type === "ticker") {
      state.ticker = msg.ticker;
      handlers.onTicker?.(state, msg);
    } else if (msg.type === "status") {
      state.status = msg.status;
    }
    handlers.onStatus?.(state);
  }

  async function pollOnce() {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) apply(await res.json());
    } catch {}
  }

  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      state.connected = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      handlers.onStatus?.(state);
    };
    ws.onmessage = (e) => apply(JSON.parse(e.data));
    ws.onclose = () => {
      state.connected = false;
      handlers.onStatus?.(state);
      if (!pollTimer) pollTimer = setInterval(pollOnce, 5000);
      setTimeout(open, 2000);
    };
    ws.onerror = () => ws.close();
  }
  // Demo mode (?demo=1): render an embedded sample snapshot and never touch the network.
  // Used by the docs site, where no server runs.
  if (new URLSearchParams(location.search).get("demo")) {
    import("./sample-data.js").then(({ SAMPLE }) => {
      const now = new Date().toISOString();
      apply({ ...SAMPLE, status: { ...SAMPLE.status, lastSuccess: now, lastAttempt: now } });
      state.connected = true;
      handlers.onStatus?.(state);
      // keep the freshness dot green while the demo is open
      setInterval(() => { state.status.lastSuccess = new Date().toISOString(); handlers.onStatus?.(state); }, 30_000);
    });
    return state;
  }
  // Render from a plain fetch first so the page is populated before the socket is up.
  pollOnce().then(open);
  return state;
}

/** "fresh" | "stale" | "dead" from the server's last successful AP poll. */
export function freshness(status) {
  if (!status?.lastSuccess) return "dead";
  const age = Date.now() - Date.parse(status.lastSuccess);
  return age < 60_000 ? "fresh" : age < 180_000 ? "stale" : "dead";
}

export function partyClass(party) {
  if (party === "Dem") return "dem";
  if (party === "GOP") return "gop";
  return "ind";
}

export function fmt(n) {
  return n.toLocaleString("en-US");
}
