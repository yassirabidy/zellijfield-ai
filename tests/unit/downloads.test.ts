import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadManager, ModelDownloadInfo } from '@/lib/server/downloads';
import { createDownloadManager } from '@/lib/server/downloads';
import type { ModelEntry } from '@/lib/server/registry';
import { modelSchema } from '@/lib/server/registry';

const HF = 'https://huggingface.co/';

function comfyModel(id: string, files: Array<{ file: string; body: string }>): ModelEntry {
  return modelSchema.parse({
    id,
    name: id,
    family: 'test',
    type: 'video',
    backend: 'comfyui',
    comfyui: {
      workflow: 'x.json',
      outputNode: '1',
      inputs: {},
      requiredFiles: files.map((f) => f.file),
      downloads: files.map((f) => ({ file: f.file, url: `${HF}org/repo/resolve/main/${path.basename(f.file)}` })),
    },
  });
}

const wanModel = modelSchema.parse({ id: 'wan-a', name: 'Wan A', family: 'wan', type: 'video', backend: 'wan2gp', wan2gp: { modelType: 't2v_2_2' } });
const wanModel2 = modelSchema.parse({ id: 'wan-b', name: 'Wan B', family: 'wan', type: 'video', backend: 'wan2gp', wan2gp: { modelType: 'i2v_2_2' } });

// Serves registry URLs from an in-memory map; supports HEAD (x-linked-size), ranges and a
// gate that holds the body open so a download can be cancelled mid-transfer.
function fakeHub(content: Record<string, string>, opts: { hold?: Promise<void> } = {}) {
  const requests: Array<{ url: string; method: string; range?: string }> = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const range = (init.headers as Record<string, string> | undefined)?.Range;
    requests.push({ url, method, range });
    const name = url.split('/').pop()!;
    const body = content[name];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (method === 'HEAD') return new Response(null, { status: 302, headers: { 'x-linked-size': String(body.length) } });
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const bytes = Buffer.from(body.slice(from));
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        if (opts.hold) await opts.hold;
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    });
    return new Response(stream, { status: range ? 206 : 200 });
  }) as typeof fetch;
  return { impl, requests };
}

async function settle(manager: DownloadManager, id: string): Promise<ModelDownloadInfo> {
  for (let i = 0; i < 200; i++) {
    const info = (await manager.overview()).find((m) => m.modelId === id)!;
    if (info.download && !['running', 'cancelling'].includes(info.download.status)) return info;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('download did not finish');
}

describe('download manager (ComfyUI files)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-dl-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sky = comfyModel('sky', [
    { file: 'diffusion_models/big.safetensors', body: 'BIG-WEIGHTS' },
    { file: 'vae/shared_vae.safetensors', body: 'VAE' },
  ]);
  const other = comfyModel('other', [{ file: 'vae/shared_vae.safetensors', body: 'VAE' }]);
  const content = { 'big.safetensors': 'BIG-WEIGHTS', 'shared_vae.safetensors': 'VAE' };

  function manager(fetchImpl: typeof fetch, models: ModelEntry[] = [sky, other], busy = false) {
    return createDownloadManager({ comfyuiDir: dir, getToolsUrl: () => 'http://tools.invalid', getModels: () => models, isBusy: () => busy, fetchImpl });
  }

  it('downloads every missing file into models/comfyui and reports progress', async () => {
    const hub = fakeHub(content);
    const m = manager(hub.impl);
    await m.start('sky');
    const info = await settle(m, 'sky');
    expect(info.download).toMatchObject({ status: 'succeeded', fileCount: 2, fileIndex: 2, received: 14 });
    expect(fs.readFileSync(path.join(dir, 'diffusion_models/big.safetensors'), 'utf8')).toBe('BIG-WEIGHTS');
    expect(info.files).toEqual({ present: 2, total: 2, bytes: 14, partialBytes: 0 });
    // Only registry URLs were contacted.
    expect(hub.requests.every((r) => r.url.startsWith(`${HF}org/repo/resolve/main/`))).toBe(true);
  });

  it('resumes a partial file with a Range request', async () => {
    fs.mkdirSync(path.join(dir, 'diffusion_models'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'diffusion_models/big.safetensors.part'), 'BIG-');
    fs.mkdirSync(path.join(dir, 'vae'));
    fs.writeFileSync(path.join(dir, 'vae/shared_vae.safetensors'), 'VAE');
    const hub = fakeHub(content);
    const m = manager(hub.impl);
    await m.start('sky');
    expect((await settle(m, 'sky')).download?.status).toBe('succeeded');
    expect(hub.requests.find((r) => r.method === 'GET')?.range).toBe('bytes=4-');
    expect(fs.readFileSync(path.join(dir, 'diffusion_models/big.safetensors'), 'utf8')).toBe('BIG-WEIGHTS');
  });

  it('cancels a running download and allows one download at a time', async () => {
    let release!: () => void;
    const hub = fakeHub(content, { hold: new Promise<void>((r) => (release = r)) });
    const m = manager(hub.impl);
    await m.start('sky');
    await expect(m.start('other')).rejects.toThrow(/Another download is running/);
    for (let i = 0; i < 100 && !hub.requests.some((r) => r.method === 'GET'); i++) await new Promise((r) => setTimeout(r, 5));
    await m.cancel('sky');
    release();
    expect((await settle(m, 'sky')).download?.status).toBe('cancelled');
    expect(fs.existsSync(path.join(dir, 'diffusion_models/big.safetensors'))).toBe(false);
  });

  it('removes a model but keeps files another installed model uses', async () => {
    fs.mkdirSync(path.join(dir, 'diffusion_models'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'vae'));
    fs.writeFileSync(path.join(dir, 'diffusion_models/big.safetensors'), 'BIG-WEIGHTS');
    fs.writeFileSync(path.join(dir, 'vae/shared_vae.safetensors'), 'VAE');
    const m = manager(fakeHub(content).impl);
    const result = await m.remove('sky');
    expect(result).toEqual({ removed: ['big.safetensors'], keptShared: ['shared_vae.safetensors'], bytesFreed: 11 });
    expect(fs.existsSync(path.join(dir, 'vae/shared_vae.safetensors'))).toBe(true);
    // The last model using the shared file removes it.
    expect((await m.remove('other')).removed).toEqual(['shared_vae.safetensors']);
  });

  it('refuses to remove a model with active jobs, and unknown or cloud models', async () => {
    const m = manager(fakeHub(content).impl, [sky, other], true);
    await expect(m.remove('sky')).rejects.toThrow(/queued or running jobs/);
    await expect(m.start('../etc')).rejects.toThrow(/Unknown local model/);
  });

  it('rejects registry entries that point outside models/comfyui or at other hosts', () => {
    const base = { id: 'bad', name: 'bad', family: 'x', type: 'video', backend: 'comfyui' };
    const block = { workflow: 'x.json', outputNode: '1', inputs: {} };
    expect(() => modelSchema.parse({ ...base, comfyui: { ...block, requiredFiles: ['../x.bin'], downloads: [{ file: '../x.bin', url: `${HF}a/b/resolve/main/x.bin` }] } })).toThrow();
    expect(() => modelSchema.parse({ ...base, comfyui: { ...block, requiredFiles: ['x.bin'], downloads: [{ file: 'x.bin', url: 'https://evil.example/x.bin' }] } })).toThrow();
    expect(() => modelSchema.parse({ ...base, comfyui: { ...block, requiredFiles: [], downloads: [{ file: 'x.bin', url: `${HF}a/b/resolve/main/x.bin` }] } })).toThrow(/not in requiredFiles/);
  });
});

describe('download manager (Wan2GP model tools)', () => {
  function toolsFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (input: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return handler(String(input), init);
    }) as typeof fetch;
    return { impl, calls };
  }
  const make = (impl: typeof fetch) =>
    createDownloadManager({ comfyuiDir: os.tmpdir(), getToolsUrl: () => 'http://wan2gp:7867', getModels: () => [wanModel, wanModel2], isBusy: () => false, fetchImpl: impl });

  it('starts a download by WanGP model type and maps progress back to the model id', async () => {
    const tools = toolsFetch((url, init) =>
      init.method === 'POST'
        ? Response.json({ status: 'running' }, { status: 202 })
        : Response.json({ status: 'running', model_type: 'i2v_2_2', file: 'w.safetensors', completed: 5, total: 10, received: 7, file_index: 1, file_count: 3 }),
    );
    const m = make(tools.impl);
    await m.start('wan-b');
    expect(tools.calls[0].url).toBe('http://wan2gp:7867/download');
    expect(JSON.parse(String(tools.calls[0].init.body))).toEqual({ model_type: 'i2v_2_2' });
    const list = await m.overview();
    expect(list.find((x) => x.modelId === 'wan-b')?.download).toMatchObject({ status: 'running', completed: 5, total: 10, received: 7, fileCount: 3 });
    expect(list.find((x) => x.modelId === 'wan-a')?.download).toBeNull();
  });

  it('removes with the other Wan2GP models as keep list and reports a stopped service clearly', async () => {
    const tools = toolsFetch(() => Response.json({ event: 'removed', removed: ['a.safetensors'], kept_shared: ['t5.safetensors'], bytes_freed: 42 }));
    expect(await make(tools.impl).remove('wan-a')).toEqual({ removed: ['a.safetensors'], keptShared: ['t5.safetensors'], bytesFreed: 42 });
    expect(JSON.parse(String(tools.calls[0].init.body))).toEqual({ model_type: 't2v_2_2', keep: ['i2v_2_2'] });

    const down = make((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(down.start('wan-a')).rejects.toThrow(/Wan2GP is not running/);
    expect((await down.overview()).every((x) => x.download === null)).toBe(true);
  });
});
