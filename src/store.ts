// SQLite persistence via node:sqlite (no native build). Three concerns:
//   raw_responses  every AP body, for replay and post-mortem
//   races          latest normalized snapshot per race
//   events         things worth telling the audience about
//   kv             poller cursor and producer state

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Race } from "./model.ts";
import type { ElectionEvent } from "./events.ts";

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS raw_responses (
        id INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL, url TEXT NOT NULL,
        status INTEGER NOT NULL, race_count INTEGER, body_gz BLOB
      );
      CREATE TABLE IF NOT EXISTS races (
        id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL, race_id TEXT,
        priority INTEGER NOT NULL, text TEXT NOT NULL, json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  logRaw(url: string, status: number, raceCount: number | null, body: string | null): void {
    this.db
      .prepare("INSERT INTO raw_responses (fetched_at, url, status, race_count, body_gz) VALUES (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), url, status, raceCount, body ? gzipSync(body) : null);
  }

  rawResponses(): { id: number; fetched_at: string; url: string; status: number; race_count: number | null }[] {
    return this.db
      .prepare("SELECT id, fetched_at, url, status, race_count FROM raw_responses ORDER BY id")
      .all() as never;
  }

  rawBody(id: number): string | null {
    const row = this.db.prepare("SELECT body_gz FROM raw_responses WHERE id = ?").get(id) as { body_gz: Uint8Array | null } | undefined;
    return row?.body_gz ? gunzipSync(row.body_gz).toString("utf8") : null;
  }

  getRace(id: string): Race | null {
    const row = this.db.prepare("SELECT json FROM races WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Race) : null;
  }

  allRaces(): Race[] {
    const rows = this.db.prepare("SELECT json FROM races").all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Race);
  }

  upsertRaces(races: Race[]): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO races (id, updated_at, json) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const r of races) stmt.run(r.id, now, JSON.stringify(r));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  addEvents(events: ElectionEvent[]): ElectionEvent[] {
    const stmt = this.db.prepare(
      "INSERT INTO events (ts, type, race_id, priority, text, json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    return events.map((e) => {
      const res = stmt.run(e.ts, e.type, e.raceId, e.priority, e.text, JSON.stringify(e));
      return { ...e, id: Number(res.lastInsertRowid) };
    });
  }

  recentEvents(limit = 50): ElectionEvent[] {
    const rows = this.db.prepare("SELECT id, json FROM events ORDER BY id DESC LIMIT ?").all(limit) as { id: number; json: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.json) as ElectionEvent), id: r.id }));
  }

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, value);
  }

  getJson<T>(key: string, fallback: T): T {
    const v = this.get(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }
}
