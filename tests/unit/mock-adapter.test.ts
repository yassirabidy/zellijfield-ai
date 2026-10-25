import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAdapter } from '@/lib/server/adapters/mock';
import type { ProgressEvent } from '@/lib/server/adapters/types';
import { CancelledError } from '@/lib/server/adapters/types';
import { getModel } from '@/lib/server/registry';

const SAMPLE = path.resolve('public/samples/mock-clip.mp4');

describe('mock adapter', () => {
  let outputDir: string;
  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-mock-'));
  });
  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('reports monotonic progress and writes the sample clip', async () => {
    const adapter = createMockAdapter({ samplePath: SAMPLE, stepMs: 0 });
    const events: ProgressEvent[] = [];
    const result = await adapter.generate({
      jobId: 'job1',
      model: getModel('mock-video')!,
      params: { prompt: 'a red fox in snow', seed: 7 },
      outputDir,
      signal: new AbortController().signal,
      onProgress: (e) => events.push(e),
    });
    expect(result.mediaType).toBe('video');
    expect(result.seed).toBe(7);
    expect(fs.statSync(result.filePath).size).toBe(fs.statSync(SAMPLE).size);
    expect(events.length).toBeGreaterThan(10);
    for (let i = 1; i < events.length; i++) expect(events[i].progress).toBeGreaterThanOrEqual(events[i - 1].progress);
    expect(events.at(-1)).toMatchObject({ progress: 1, status: 'done' });
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['loading', 'encoding', 'generating', 'decoding', 'saving', 'done']));
  });

  it('stops with CancelledError when aborted', async () => {
    const adapter = createMockAdapter({ samplePath: SAMPLE, stepMs: 20 });
    const controller = new AbortController();
    const run = adapter.generate({
      jobId: 'job2',
      model: getModel('mock-video')!,
      params: { prompt: 'x' },
      outputDir,
      signal: controller.signal,
      onProgress: () => {},
    });
    setTimeout(() => controller.abort(), 50);
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(fs.existsSync(path.join(outputDir, 'job2.mp4'))).toBe(false);
  });

  it('reports installed when the sample exists, missing otherwise', async () => {
    const model = getModel('mock-video')!;
    expect((await createMockAdapter({ samplePath: SAMPLE }).status([model])).get(model.id)?.status).toBe('installed');
    expect((await createMockAdapter({ samplePath: path.join(outputDir, 'nope.mp4') }).status([model])).get(model.id)?.status).toBe('missing');
  });
});
