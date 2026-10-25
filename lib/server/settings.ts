import { z } from 'zod';
import type { Database } from './db';
import { getDb } from './db';
import type { BackendId, ServerEnv } from './env';
import { getEnv } from './env';

// Studio settings live in SQLite under DATA_DIR. API keys are write-only from the browser's point
// of view: they can be set or cleared, but are only ever reported back as "configured: true/false".

export const KEY_NAMES = ['muapi', 'fal', 'replicate'] as const;
export type KeyName = (typeof KEY_NAMES)[number];

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http:// and https:// URLs are allowed');

// Keys: printable, no whitespace. Empty string clears the key.
const apiKey = z.union([
  z.literal(''),
  z.string().trim().min(8).max(512).regex(/^[\x21-\x7E]+$/, 'API keys cannot contain spaces or non-ASCII characters'),
]);

export const settingsUpdateSchema = z
  .object({
    // null resets to the default from the environment (docker-compose.yml / .env).
    wan2gpUrl: httpUrl.nullable().optional(),
    comfyuiUrl: httpUrl.nullable().optional(),
    defaultBackend: z.enum(['mock', 'wan2gp', 'comfyui', 'fal', 'replicate']).optional(),
    keys: z
      .object({ muapi: apiKey.optional(), fal: apiKey.optional(), replicate: apiKey.optional() })
      .strict()
      .optional(),
  })
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export interface PublicSettings {
  wan2gpUrl: string;
  comfyuiUrl: string;
  defaultBackend: BackendId;
  keys: Record<KeyName, boolean>;
}

function read(db: Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function write(db: Database, key: string, value: string | null): void {
  if (value === null || value === '') db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getPublicSettings(db: Database = getDb(), env: ServerEnv = getEnv()): PublicSettings {
  return {
    wan2gpUrl: read(db, 'wan2gpUrl') ?? env.wan2gpMcpUrl,
    comfyuiUrl: read(db, 'comfyuiUrl') ?? env.comfyuiUrl,
    defaultBackend: (read(db, 'defaultBackend') as BackendId | undefined) ?? env.defaultBackend,
    keys: Object.fromEntries(KEY_NAMES.map((k) => [k, Boolean(read(db, `key.${k}`))])) as Record<KeyName, boolean>,
  };
}

export function updateSettings(input: unknown, db: Database = getDb(), env: ServerEnv = getEnv()): PublicSettings {
  const update = settingsUpdateSchema.parse(input);
  if (update.wan2gpUrl !== undefined) write(db, 'wan2gpUrl', update.wan2gpUrl);
  if (update.comfyuiUrl !== undefined) write(db, 'comfyuiUrl', update.comfyuiUrl);
  if (update.defaultBackend !== undefined) write(db, 'defaultBackend', update.defaultBackend);
  for (const name of KEY_NAMES) {
    const value = update.keys?.[name];
    if (value !== undefined) write(db, `key.${name}`, value);
  }
  return getPublicSettings(db, env);
}

// Server-only accessor for adapters and proxies. Never pass the result to a response or a log.
export function getApiKey(name: KeyName, db: Database = getDb()): string | null {
  return read(db, `key.${name}`) ?? null;
}
