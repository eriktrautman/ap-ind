// Run the poller from any machine (if the Vercel cron is not running).
// Needs AP_API_KEY and BLOB_READ_WRITE_TOKEN in the environment (node --env-file=.env scripts/poll-local.mjs).
//   npm run poll         every 60 s
//   npm run poll:once    single cycle
import { pollOnce } from "../lib/poll.js";

const once = process.argv.includes("--once");
const INTERVAL = Number(process.env.POLL_SECONDS ?? 60) * 1000;

async function tick() {
  try {
    await pollOnce();
  } catch (e) {
    console.error(`[poll] failed: ${e.message}`);
  }
}

await tick();
if (!once) setInterval(tick, INTERVAL);
