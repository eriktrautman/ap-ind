// Gallup's party identification trend, from its own public tables, committed as config/gallup-party-id.json (copied to /g by the build) for C11.
// Run it again when Gallup publishes a new quarter:  node scripts/fetch-gallup-party-id.mjs
import { writeFileSync } from "node:fs";

const ANNUAL = "https://news.gallup.com/poll/15370/party-affiliation.aspx", QUARTERLY = "https://news.gallup.com/poll/654560/quarterly-party-affiliation.aspx";
const page = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
};
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, " ").trim();
/** Each table's data rows as {head, cells}; the column order comes from the table's own first row, so a reordered table cannot swap the parties. */
const tables = (html) => [...html.matchAll(/<table.*?<\/table>/gs)].map(([t]) => {
  const rows = [...t.matchAll(/<tr.*?<\/tr>/gs)].map(([r]) => [...r.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((c) => text(c[1])));
  return { cols: rows[0].slice(1), rows: rows.filter((r) => /^(19|20)\d\d/.test(r[0])) };
});
const num = (s) => { const n = Number(s); if (!Number.isFinite(n)) throw new Error(`not a number: ${s}`); return n; };
const named = (t, row) => Object.fromEntries(t.cols.map((c, i) => [/democrat/i.test(c) ? "dem" : /republican/i.test(c) ? "gop" : "ind", num(row[i + 1])]));
function checked(t, what) {
  const keys = t.cols.map((c) => /democrat/i.test(c) ? "dem" : /republican/i.test(c) ? "gop" : "ind").sort().join();
  if (keys !== what) throw new Error(`columns changed: ${t.cols}`);
  return t;
}
const [annual, annualLean] = tables(await page(ANNUAL)), [quarterly, quarterlyLean] = tables(await page(QUARTERLY));
const series = (t, what) => checked(t, what).rows.map((r) => ({ when: r[0], ...named(t, r) }));
const out = {
  source: "Gallup, party identification trend", fetched: new Date().toISOString().slice(0, 10), urls: [ANNUAL, QUARTERLY],
  annual: series(annual, "dem,gop,ind"), annualLean: series(annualLean, "dem,gop"),
  quarterly: series(quarterly, "dem,gop,ind"), quarterlyLean: series(quarterlyLean, "dem,gop"),
};
for (const r of [...out.annual, ...out.quarterly]) { const sum = r.dem + r.gop + r.ind; if (sum < 94 || sum > 103) throw new Error(`${r.when} adds up to ${sum}`); }
writeFileSync(new URL("../config/gallup-party-id.json", import.meta.url), JSON.stringify(out));
console.log(`annual ${out.annual[0].when}-${out.annual.at(-1).when} (${out.annual.length}), lean ${out.annualLean[0].when}-${out.annualLean.at(-1).when}, quarterly ${out.quarterly[0].when}-${out.quarterly.at(-1).when} (${out.quarterly.length})`);
