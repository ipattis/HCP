import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return db;
}

/** Override the DB instance (for testing with in-memory databases). */
export function setDb(instance: Database.Database): void {
  db = instance;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
