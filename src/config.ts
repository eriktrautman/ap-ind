// All runtime configuration comes from the environment (.env in dev, container env in prod).
// The AP key is read here once and never exported beyond the ap module.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  apKey: required("AP_API_KEY"),
  electionDate: process.env.AP_ELECTION_DATE ?? "2026-11-03",
  // "l" = live, "t" = AP test data
  resultsType: process.env.AP_RESULTS_TYPE ?? "t",
  pollIntervalMs: Number(process.env.AP_POLL_INTERVAL_SECONDS ?? 20) * 1000,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  dbPath: process.env.DB_PATH ?? "data/ap-ind.sqlite",
};
