import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDownloadManager } from '@/lib/server/downloads';
import type { EngineState } from '@/lib/server/engines';
import { createEngineManager } from '@/lib/server/engines';
import { modelSchema } from '@/lib/server/registry';

const engineStatus = (over: Record<string, unknown> = {}) => ({
  installed: false, sizeLabel: null, sizeBytes: null, container: 'none', health: '', busy: false, op: null, ...over,
});

describe('engine manager bridge', () => {
  let dir: string;
  let now = 1_000_000;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-eng-'));
    now = 1_000_000;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const writeStatus = (engines: Record<string, unknown>, updatedAt = now) =>
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ updatedAt, dockerOk: true, engines: { wan2gp: engineStatus(), comfyui: engineStatus(), ...engines } }));
  const manager = () => createEngineManager({ dir, now: () => now });
  const requests = () => (fs.existsSync(path.join(dir, 'requests')) ? fs.readdirSync(path.join(dir, 'requests')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'requests', f), 'utf8'))) : []);

  it('reports the manager offline without a fresh status file and refuses requests', () => {
    expect(manager().snapshot().managerOnline).toBe(false);
    writeStatus({}, now - 60_000);
    expect(manager().snapshot().managerOnline).toBe(false);
    expect(() => manager().request('wan2gp', 'install')).toThrow(/engine manager is not running/);
    expect(requests()).toEqual([]);
  });

  it('reads engine state and marks a healthy running container ready', () => {
    writeStatus({ wan2gp: engineStatus({ installed: true, sizeLabel: '34.2GB', sizeBytes: 34_200_000_000, container: 'running', health: 'healthy' }) });
    const snap = manager().snapshot();
    expect(snap.managerOnline).toBe(true);
    expect(snap.engines.find((e) => e.id === 'wan2gp')).toMatchObject({ installed: true, sizeLabel: '34.2GB', ready: true });
    expect(snap.engines.find((e) => e.id === 'comfyui')).toMatchObject({ installed: false, ready: false, sizeEstimate: '≈ 16 GB' });
  });

  it('writes only fixed engine/action requests and refuses impossible ones', () => {
    writeStatus({ comfyui: engineStatus({ busy: true, op: { action: 'install', status: 'running', progress: 0.2 } }) });
    const m = manager();
    m.request('wan2gp', 'install');
    expect(requests()).toEqual([{ engine: 'wan2gp', action: 'install', requestedAt: now }]);
    expect(() => m.request('wan2gp', 'start')).toThrow(/not installed/);
    expect(() => m.request('comfyui', 'delete')).toThrow(/busy/);
  });

  it('cancels only a running operation, even while the engine is busy', () => {
    writeStatus({ comfyui: engineStatus({ busy: true, op: { action: 'install', status: 'running', progress: 0.2 } }) });
    const m = manager();
    expect(() => m.request('wan2gp', 'cancel')).toThrow(/nothing to cancel/);
    m.request('comfyui', 'cancel');
    expect(requests()).toEqual([{ engine: 'comfyui', action: 'cancel', requestedAt: now }]);
  });

  it('reads a cancelled operation', () => {
    writeStatus({ wan2gp: engineStatus({ op: { action: 'install', status: 'cancelled', progress: 0, message: 'Cancelled', error: null, startedAt: 1, finishedAt: 2 } }) });
    expect(manager().get('wan2gp').op).toMatchObject({ action: 'install', status: 'cancelled' });
  });
});

describe('downloads install the engine first', () => {
  const wan = modelSchema.parse({ id: 'wan-a', name: 'Wan A', family: 'wan', type: 'video', backend: 'wan2gp', wan2gp: { modelType: 't2v_2_2' } });

  it('requests an install when Wan2GP is missing, then starts the download once it answers', async () => {
    let engine: EngineState = { id: 'wan2gp', name: 'Wan2GP', sizeEstimate: '≈ 34 GB', installed: false, sizeLabel: null, sizeBytes: null, container: 'none', health: '', ready: false, busy: false, op: null };
    const asked: string[] = [];
    let toolsUp = false;
    const posted: unknown[] = [];
    const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
      if (!toolsUp) throw new TypeError('fetch failed');
      const url = String(input);
      if (url.endsWith('/health')) return Response.json({ ok: true });
      if (init.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return Response.json({ status: 'running' }, { status: 202 });
      }
      return Response.json({ status: 'running', model_type: 't2v_2_2' });
    }) as typeof fetch;
    const m = createDownloadManager({
      comfyuiDir: os.tmpdir(), getToolsUrl: () => 'http://wan2gp:7867', getModels: () => [wan], isBusy: () => false, fetchImpl,
      engineCheckMs: 5,
      engines: { snapshot: () => ({ managerOnline: true, engines: [engine] }), request: (id, action) => asked.push(`${action} ${id}`) },
    });

    await m.start('wan-a');
    expect(asked).toEqual(['install wan2gp']);
    expect((await m.overview())[0].download).toMatchObject({ status: 'waiting-engine' });

    // The engine manager finishes the install and the model-tools service comes up.
    engine = { ...engine, installed: true, container: 'running', ready: true };
    toolsUp = true;
    for (let i = 0; i < 100 && posted.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(posted).toEqual([{ model_type: 't2v_2_2' }]);
    expect((await m.overview())[0].download).toMatchObject({ status: 'running' });
  });

  it('stops waiting when the engine install is cancelled', async () => {
    let engine: EngineState = { id: 'wan2gp', name: 'Wan2GP', sizeEstimate: '≈ 34 GB', installed: false, sizeLabel: null, sizeBytes: null, container: 'none', health: '', ready: false, busy: false, op: null };
    const m = createDownloadManager({
      comfyuiDir: os.tmpdir(), getToolsUrl: () => 'http://wan2gp:7867', getModels: () => [wan], isBusy: () => false,
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
      engineCheckMs: 5,
      engines: { snapshot: () => ({ managerOnline: true, engines: [engine] }), request: () => {} },
    });

    await m.start('wan-a');
    expect((await m.overview())[0].download).toMatchObject({ status: 'waiting-engine' });

    engine = { ...engine, op: { action: 'install', status: 'cancelled', progress: 0, message: 'Cancelled', error: null, startedAt: 1, finishedAt: 2 } };
    for (let i = 0; i < 100 && (await m.overview())[0].download; i++) await new Promise((r) => setTimeout(r, 5));
    expect((await m.overview())[0].download).toBeNull();
  });

  it('keeps the plain "not running" error without an engine manager', async () => {
    const m = createDownloadManager({
      comfyuiDir: os.tmpdir(), getToolsUrl: () => 'http://wan2gp:7867', getModels: () => [wan], isBusy: () => false,
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
      engines: { snapshot: () => ({ managerOnline: false, engines: [] }), request: () => { throw new Error('not called'); } },
    });
    await expect(m.start('wan-a')).rejects.toThrow(/Wan2GP is not running/);
  });
});
