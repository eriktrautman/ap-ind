// Polls AP on an interval, persists raw bodies, normalizes, diffs, and notifies listeners.
// Serves last-good data through outages; status is exposed for the control panel.

import { EventEmitter } from "node:events";
import { fetchAp, initialUrl, ApHttpError } from "./ap.ts";
import { normalizeRace, type Race } from "./model.ts";
import { diffRace, type ElectionEvent } from "./events.ts";
import type { Store } from "./store.ts";

export interface PollerStatus {
  running: boolean;
  intervalMs: number;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  raceCount: number;
  lastChangedCount: number;
  apTimestamp: string | null;
  resultsType: string;
}

export interface PollUpdate {
  changed: Race[];
  events: ElectionEvent[];
  status: PollerStatus;
}

export class Poller extends EventEmitter {
  status: PollerStatus;
  private store: Store;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(store: Store, intervalMs: number, resultsType: string) {
    super();
    this.store = store;
    this.status = {
      running: false, intervalMs, lastAttempt: null, lastSuccess: null, lastError: null,
      consecutiveErrors: 0, raceCount: store.allRaces().length, lastChangedCount: 0,
      apTimestamp: null, resultsType,
    };
  }

  start(): void {
    this.status.running = true;
    void this.tick();
  }

  stop(): void {
    this.status.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  setInterval(ms: number): void {
    this.status.intervalMs = ms;
  }

  /** Current cursor: AP's nextrequest URL from the last successful poll, or the initial URL. */
  private nextUrl(): string {
    return this.store.get("ap:nextrequest") ?? initialUrl();
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.status.lastAttempt = new Date().toISOString();
    try {
      await this.pollOnce();
      this.status.consecutiveErrors = 0;
      this.status.lastError = null;
    } catch (err) {
      this.status.consecutiveErrors++;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof ApHttpError) this.store.logRaw(this.nextUrl(), err.status, null, err.body);
      console.error(`[poller] ${this.status.lastError} (${this.status.consecutiveErrors} in a row)`);
      // If the cursor itself is bad (e.g. 400 on a stale minDateTime), start over from scratch.
      if (err instanceof ApHttpError && err.status === 400) this.store.set("ap:nextrequest", initialUrl());
    } finally {
      this.inFlight = false;
      this.emit("status", this.status);
      if (this.status.running) {
        // exponential backoff capped at 5 minutes
        const backoff = Math.min(this.status.intervalMs * 2 ** this.status.consecutiveErrors, 300_000);
        this.timer = setTimeout(() => void this.tick(), backoff);
      }
    }
  }

  private async pollOnce(): Promise<void> {
    const url = this.nextUrl();
    const { data, raw } = await fetchAp(url);
    this.store.logRaw(url, 200, data.races.length, raw);
    this.ingest(data.races, data.timestamp);
    if (data.nextrequest) this.store.set("ap:nextrequest", data.nextrequest);
    this.status.lastSuccess = new Date().toISOString();
  }

  /** Shared by live polling and replay. */
  ingest(apRaces: import("./ap.ts").ApRace[], apTimestamp: string | null): PollUpdate {
    const changed: Race[] = [];
    const events: ElectionEvent[] = [];
    for (const ar of apRaces) {
      const next = normalizeRace(ar);
      if (!next) continue;
      const prev = this.store.getRace(next.id);
      changed.push(next);
      // A race we have never seen is a baseline, not news (cold start mid-evening would
      // otherwise announce every call already made).
      if (prev) events.push(...diffRace(prev, next));
    }
    this.store.upsertRaces(changed);
    const stored = this.store.addEvents(events);
    this.status.raceCount = this.store.allRaces().length;
    this.status.lastChangedCount = changed.length;
    this.status.apTimestamp = apTimestamp;
    const update: PollUpdate = { changed, events: stored, status: this.status };
    if (changed.length) this.emit("update", update);
    console.log(`[poller] ${changed.length} races updated, ${events.length} events`);
    return update;
  }
}
