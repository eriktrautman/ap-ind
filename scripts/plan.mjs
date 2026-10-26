// Update the build plan's data block in docs/producer-plan.html from the command line.
//   node scripts/plan.mjs done S01 S02 --log "what landed" [--phase "E1 Shell"] [--note "..."]
//   node scripts/plan.mjs doing S10 S11
//   node scripts/plan.mjs todo S10 | blocked S33
//   node scripts/plan.mjs note S02 "new note text"
// Edits only the status/doneAt of the named stories, META.phase/note/updated and LOG.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../docs/producer-plan.html", import.meta.url);
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const log = opt("--log"), phase = opt("--phase"), note = opt("--note");
const [cmd, ...ids] = args;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let s = readFileSync(FILE, "utf8");

const story = (id) => {
  const re = new RegExp(`\\{ id: "${id}", epic: "(E\\d)", pts: (\\d+), status: "(\\w+)"(.*?) \\},\\n`, "s");
  const m = s.match(re);
  if (!m) throw new Error(`no story ${id}`);
  return { m, re };
};
const setStatus = (id, status) => {
  const { m, re } = story(id);
  let rest = m[4].replace(/, doneAt: "[^"]*"/, "");
  if (status === "done") rest += `, doneAt: "${now}"`;
  s = s.replace(re, `{ id: "${id}", epic: "${m[1]}", pts: ${m[2]}, status: "${status}"${rest} },\n`);
};

if (cmd === "note") {
  const [id, text] = ids;
  const { m, re } = story(id);
  let rest = m[4];
  rest = /note: "/.test(rest) ? rest.replace(/note: "(?:[^"\\]|\\.)*"/, `note: ${JSON.stringify(text)}`) : rest.replace(/(title: "(?:[^"\\]|\\.)*")/, `$1, note: ${JSON.stringify(text)}`);
  s = s.replace(re, `{ id: "${id}", epic: "${m[1]}", pts: ${m[2]}, status: "${m[3]}"${rest} },\n`);
} else if (["done", "doing", "todo", "blocked"].includes(cmd)) {
  for (const id of ids) setStatus(id, cmd);
} else if (cmd) {
  throw new Error(`unknown command ${cmd}`);
}
if (phase) s = s.replace(/phase: "[^"]*",/, `phase: ${JSON.stringify(phase)},`);
if (note) s = s.replace(/note: "[^"]*",\n  updated:/, `note: ${JSON.stringify(note)},\n  updated:`);
if (log) s = s.replace("const LOG = [\n", `const LOG = [\n  { t: "${now}", what: ${JSON.stringify(log)} },\n`);
s = s.replace(/updated: "[^"]+",/, `updated: "${now}",`);
writeFileSync(FILE, s);

// recount for the console
const stories = [...s.matchAll(/\{ id: "(\w+)", epic: "(E\d)", pts: (\d+), status: "(\w+)"/g)].map((m) => ({ id: m[1], pts: +m[3], status: m[4] }));
const done = stories.filter((x) => x.status === "done");
console.log(`${done.length}/${stories.length} stories done, ${done.reduce((a, x) => a + x.pts, 0)}/${stories.reduce((a, x) => a + x.pts, 0)} points; doing: ${stories.filter((x) => x.status === "doing").map((x) => x.id).join(" ") || "none"}`);
