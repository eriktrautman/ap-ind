// Writes dist/version.json: the commit the build came from, so a deployment can say what it is running. The
// workflow's production check waits for the commit it pushed to answer here before testing the site.
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
let sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
if (!sha) { try { sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { sha = "unknown"; } }
writeFileSync("dist/version.json", JSON.stringify({ sha, builtAt: new Date().toISOString() }));
