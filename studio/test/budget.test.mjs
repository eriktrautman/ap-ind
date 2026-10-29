// The whole suite is capped at 100 tests, for its whole life: small enough to read, fast enough to run on every
// push. Over the cap, this test fails; replace an old check rather than adding to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("./", import.meta.url).pathname;
export const BUDGET = 100;

test(`the suite stays within its budget of ${BUDGET} tests`, () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".test.mjs"));
  const counts = files.map((f) => [f, (readFileSync(DIR + f, "utf8").match(/^\s*test\(/gm) ?? []).length]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  assert.ok(total <= BUDGET, `${total} tests across ${files.length} files; the budget is ${BUDGET}: ${counts.map(([f, c]) => `${f} ${c}`).join(", ")}`);
});
