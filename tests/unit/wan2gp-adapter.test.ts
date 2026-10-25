import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@/lib/server/adapters/types';
import { createWan2gpAdapter } from '@/lib/server/adapters/wan2gp';
import { getModel } from '@/lib/server/registry';

// Minimal fake of WanGP's MCP server (Streamable HTTP, JSON responses, API v1 tools).
function fakeWanGP(opts: { availability?: string; fail?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let polls = 0;
  const json = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/download/abc')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    const msg = JSON.parse(String(init?.body ?? '{}'));
    if (!('id' in msg)) return json('', 202);
    const result = (r: unknown) => json({ jsonrpc: '2.0', id: msg.id, result: r });
    const tool = (payload: unknown) => result({ structuredContent: payload, content: [] });
    if (msg.method === 'initialize') return result({ serverInfo: { name: 'WanGP', version: 'test' }, capabilities: {} });
    if (msg.method === 'tools/list') return result({ tools: [{ name: 'wangp_generate' }, { name: 'wangp_get_job' }] });
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      calls.push({ name, args });
      switch (name) {
        case 'wangp_get_model_availability':
          return tool({ status: opts.availability ?? 'available' });
        case 'wangp_generate':
          return tool({ job_id: 'w1', done: false });
        case 'wangp_get_job':
          polls += 1;
          if (polls < 2) return tool({ done: false, events: [{ kind: 'progress', data: { progress: 40, phase: 'inference', current_step: 4, total_steps: 10 } }] });
          return tool(opts.fail
            ? { done: true, result: { success: false, errors: [{ message: 'CUDA out of memory' }] } }
            : { done: true, result: { success: true, gallery_items: [{ media_id: 'abc', media_type: 'video' }] } });
        case 'wangp_create_gallery_download':
          return tool({ download_url: '/download/abc', filename: 'wan_out.mp4' });
      }
    }
    return json({ jsonrpc: '2.0', id: msg.id, error: { message: 'unexpected' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('wan2gp adapter (MCP)', () => {
  let outputDir: string;
  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-wan-'));
  });
  afterEach(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  it('submits real Wan2GP settings, reports progress and saves the download', async () => {
    const server = fakeWanGP();
    const adapter = createWan2gpAdapter({ mode: 'mcp', getUrl: () => 'http://wan2gp:7866', fetchImpl: server.fetchImpl });
    const events: ProgressEvent[] = [];
    const result = await adapter.generate({
      jobId: 'j1',
      model: getModel('wan-2.2-t2v')!,
      params: { prompt: 'a lighthouse at dusk', aspectRatio: '9:16', seed: 5, frames: 81 },
      outputDir,
      signal: new AbortController().signal,
      onProgress: (e) => events.push(e),
    });
    const submitted = server.calls.find((c) => c.name === 'wangp_generate')!.args.source as Record<string, unknown>;
    expect(submitted).toMatchObject({ model_type: 't2v_2_2', prompt: 'a lighthouse at dusk', resolution: '480x832', seed: 5, video_length: 81 });
    expect(result.filePath).toBe(path.join(outputDir, 'j1.mp4'));
    expect([...fs.readFileSync(result.filePath)]).toEqual([1, 2, 3, 4]);
    expect(events.some((e) => e.status === 'generating' && e.progress === 0.4)).toBe(true);
  }, 15_000);

  it('surfaces WanGP errors', async () => {
    const server = fakeWanGP({ fail: true });
    const adapter = createWan2gpAdapter({ mode: 'mcp', getUrl: () => 'http://wan2gp:7866', fetchImpl: server.fetchImpl });
    await expect(adapter.generate({
      jobId: 'j2', model: getModel('ltx-2.5')!, params: { prompt: 'x' }, outputDir,
      signal: new AbortController().signal, onProgress: () => {},
    })).rejects.toThrow(/CUDA out of memory/);
  }, 15_000);

  it('maps availability to installed / missing / unreachable', async () => {
    const models = [getModel('minimax-h3')!];
    const ok = createWan2gpAdapter({ mode: 'mcp', getUrl: () => 'http://w', fetchImpl: fakeWanGP().fetchImpl });
    expect((await ok.status(models)).get('minimax-h3')?.status).toBe('installed');
    const missing = createWan2gpAdapter({ mode: 'mcp', getUrl: () => 'http://w', fetchImpl: fakeWanGP({ availability: 'missing' }).fetchImpl });
    expect((await missing.status(models)).get('minimax-h3')).toMatchObject({ status: 'missing' });
    const down = createWan2gpAdapter({ mode: 'mcp', getUrl: () => 'http://127.0.0.1:9' });
    expect((await down.status(models)).get('minimax-h3')?.status).toBe('unreachable');
  });
});
