import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '@/lib/server/db';
import { loadEnv } from '@/lib/server/env';
import { resolveMediaPath } from '@/lib/server/gallery';
import { getApiKey, getPublicSettings, updateSettings } from '@/lib/server/settings';
import { resolveUpload, saveUpload, sniffMime, UploadError } from '@/lib/server/uploads';

const env = loadEnv({ DATA_DIR: os.tmpdir() });

describe('settings', () => {
  it('defaults backend URLs from the environment', () => {
    const s = getPublicSettings(openDatabase(':memory:'), env);
    expect(s.wan2gpUrl).toBe(env.wan2gpMcpUrl);
    expect(s.comfyuiUrl).toBe(env.comfyuiUrl);
    expect(s.keys).toEqual({ muapi: false, fal: false, replicate: false });
  });

  it('stores keys server-side and only reports whether they are set', () => {
    const db = openDatabase(':memory:');
    const secret = 'sk-test-1234567890abcdef';
    const result = updateSettings({ keys: { fal: secret } }, db, env);
    expect(result.keys.fal).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(getPublicSettings(db, env))).not.toContain(secret);
    expect(getApiKey('fal', db)).toBe(secret);
    updateSettings({ keys: { fal: '' } }, db, env);
    expect(getApiKey('fal', db)).toBeNull();
  });

  it('validates URLs and keys', () => {
    const db = openDatabase(':memory:');
    expect(() => updateSettings({ comfyuiUrl: 'file:///etc/passwd' }, db, env)).toThrow();
    expect(() => updateSettings({ comfyuiUrl: 'javascript:alert(1)' }, db, env)).toThrow();
    expect(() => updateSettings({ keys: { muapi: 'has spaces in it' } }, db, env)).toThrow();
    expect(() => updateSettings({ unknown: 1 }, db, env)).toThrow();
    expect(updateSettings({ comfyuiUrl: 'http://192.168.1.20:8188' }, db, env).comfyuiUrl).toBe('http://192.168.1.20:8188');
    // null resets to the environment default.
    expect(updateSettings({ comfyuiUrl: null }, db, env).comfyuiUrl).toBe(env.comfyuiUrl);
  });
});

describe('uploads', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it('detects types from content, not names', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(new TextEncoder().encode('#!/bin/sh\nrm -rf /'))).toBeNull();
  });

  it('saves by generated id and resolves only valid ids', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-up-'));
    try {
      const saved = saveUpload(dir, PNG);
      expect(saved.kind).toBe('image');
      expect(resolveUpload(dir, saved.id)).toBe(path.join(dir, `${saved.id}.png`));
      expect(resolveUpload(dir, '../secret')).toBeNull();
      expect(() => saveUpload(dir, new TextEncoder().encode('not media'))).toThrow(UploadError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('media paths', () => {
  const root = path.join(os.tmpdir(), 'zf-outputs');
  it('stays inside the outputs folder', () => {
    expect(resolveMediaPath(root, ['studio', 'a.mp4'])).toBe(path.join(root, 'studio', 'a.mp4'));
    expect(resolveMediaPath(root, ['..', 'zellijfield.db'])).toBeNull();
    expect(resolveMediaPath(root, ['studio', '..', '..', 'x.mp4'])).toBeNull();
    expect(resolveMediaPath(root, ['studio', 'notes.txt'])).toBeNull();
    expect(resolveMediaPath(root, ['studio\\..\\x.mp4'])).toBeNull();
  });
});
