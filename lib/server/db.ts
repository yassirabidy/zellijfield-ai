import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { getEnv } from './env';

// Node's built-in SQLite. Loaded at runtime so the bundler never tries to resolve it.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export type Database = DatabaseSyncType;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id          TEXT PRIMARY KEY,
     model_id    TEXT NOT NULL,
     backend     TEXT NOT NULL,
     status      TEXT NOT NULL,
     progress    REAL NOT NULL DEFAULT 0,
     message     TEXT,
     params      TEXT NOT NULL,
     output_path TEXT,
     media_type  TEXT,
     error       TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS jobs_created ON jobs (created_at DESC)`,
];

export function openDatabase(file: string): Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Rollback journal, not WAL: WAL's shared-memory file fails with "disk I/O error" on Docker
  // Desktop bind mounts from a Windows host (./data). One server process writes, so WAL gains nothing.
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA busy_timeout = 5000');
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}

// One connection per server process; kept on globalThis so dev-mode reloads reuse it.
const globalForDb = globalThis as unknown as { __zfDb?: Database };
export function getDb(): Database {
  globalForDb.__zfDb ??= openDatabase(path.join(getEnv().dataDir, 'zellijfield.db'));
  return globalForDb.__zfDb;
}
