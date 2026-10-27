// Headless Chrome driver for checking pages without a browser extension: opens a URL, collects
// console errors and failed requests, runs JavaScript snippets in the page and prints results.
//   node scripts/browse.mjs <url> [--wait ms] [--eval "expr"]... [--shot file.png] [--size 1400x2000] [--clip 1400x300]
// Each --eval runs in order (awaited if it returns a promise) and prints its JSON result.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const url = args.shift();
const evals = [], opts = { wait: 4000, shot: null, size: "1400x1800", clip: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--eval") evals.push(args[++i]);
  else if (args[i] === "--wait") opts.wait = Number(args[++i]);
  else if (args[i] === "--shot") opts.shot = args[++i];
  else if (args[i] === "--size") opts.size = args[++i];
  else if (args[i] === "--clip") opts.clip = args[++i];   // WxH: screenshot only the top-left region
}
const [w, h] = opts.size.split("x").map(Number);
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "browse-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); }
  }
  throw new Error("chrome did not start");
}
const list = await targets();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
const errors = [], failed = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) errors.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") errors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  if (m.method === "Network.loadingFailed") failed.push(`${m.params.errorText} ${reqUrls.get(m.params.requestId) ?? m.params.requestId}`);
  if (m.method === "Network.requestWillBeSent") reqUrls.set(m.params.requestId, m.params.request.url);
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400) failed.push(`${m.params.response.status} ${m.params.response.url}`);
};
const reqUrls = new Map();
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(opts.wait);
for (const expr of evals) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log(`EVAL ERROR: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  else console.log(JSON.stringify(r.result?.result?.value ?? null));
}
if (opts.shot) {
  // --clip WxH[+Y]: a region of the page starting Y px down (page coordinates), default the top.
  const clip = opts.clip ? (([wh, y]) => { const [cw, ch] = wh.split("x").map(Number); return { x: 0, y: Number(y ?? 0), width: cw, height: ch, scale: 1 }; })(opts.clip.split("+")) : undefined;
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !clip, clip });
  writeFileSync(opts.shot, Buffer.from(r.result.data, "base64"));
  console.log(`screenshot: ${opts.shot}`);
}
console.log(`errors: ${errors.length}`); for (const e of errors) console.log("  " + e.slice(0, 400));
console.log(`failed requests: ${failed.length}`); for (const f of failed) console.log("  " + f.slice(0, 200));
ws.close(); chrome.kill();
