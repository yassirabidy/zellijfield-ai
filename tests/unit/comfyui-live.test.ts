import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createComfyuiAdapter } from '@/lib/server/adapters/comfyui';
import type { ProgressEvent } from '@/lib/server/adapters/types';
import { modelSchema } from '@/lib/server/registry';

// Runs against a real ComfyUI when COMFYUI_TEST_URL is set (CPU mode is enough):
//   docker run -d -p 127.0.0.1:18188:8188 zellijfield-ai/comfyui:local --cpu
//   COMFYUI_TEST_URL=http://127.0.0.1:18188 npx vitest run tests/unit/comfyui-live.test.ts
const url = process.env.COMFYUI_TEST_URL;

// Core nodes only, so no model files are needed.
const WORKFLOW = {
  '1': { class_type: 'EmptyImage', inputs: { width: 64, height: 64, batch_size: 1, color: 0 } },
  '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'zf-live-test', images: ['1', 0] } },
};

describe.skipIf(!url)('ComfyUI adapter against a live server', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-comfy-'));
    fs.mkdirSync(path.join(dir, 'workflows'));
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'workflows', 'live.json'), JSON.stringify(WORKFLOW));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const model = modelSchema.parse({
    id: 'live-test',
    name: 'Live test',
    family: 'test',
    type: 'image',
    backend: 'comfyui',
    comfyui: {
      workflow: 'live.json',
      outputNode: '2',
      inputs: { width: { node: '1', input: 'width' }, height: { node: '1', input: 'height' } },
      resolutions: { '1:1': '96x96' },
      requiredNodes: ['EmptyImage', 'SaveImage'],
    },
    aspectRatios: ['1:1'],
  });

  it('reports the model installed', async () => {
    const adapter = createComfyuiAdapter({ getUrl: () => url!, workflowsDir: path.join(dir, 'workflows'), modelsDir: dir });
    expect((await adapter.status([model])).get('live-test')).toEqual({ status: 'installed' });
  });

  it('queues the prompt, follows progress and downloads the result', async () => {
    const adapter = createComfyuiAdapter({ getUrl: () => url!, workflowsDir: path.join(dir, 'workflows'), modelsDir: dir, pollMs: 300 });
    const events: ProgressEvent[] = [];
    const result = await adapter.generate({
      jobId: 'live1',
      model,
      params: { prompt: 'unused', aspectRatio: '1:1' },
      outputDir: path.join(dir, 'out'),
      signal: new AbortController().signal,
      onProgress: (e) => events.push(e),
    });
    expect(result.mediaType).toBe('image');
    const png = fs.readFileSync(result.filePath);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    // The width/height mapping was applied: 96x96 from the 1:1 resolution.
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    expect(events.map((e) => e.status)).toContain('queued');
  });

  it('reports unreachable for a dead URL', async () => {
    const adapter = createComfyuiAdapter({ getUrl: () => 'http://127.0.0.1:9', workflowsDir: dir, modelsDir: dir });
    expect((await adapter.status([model])).get('live-test')?.status).toBe('unreachable');
  });
});
