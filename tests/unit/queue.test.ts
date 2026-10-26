import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAdapter } from '@/lib/server/adapters/mock';
import type { Adapter, GenerateRequest } from '@/lib/server/adapters/types';
import { sleep } from '@/lib/server/adapters/types';
import { openDatabase } from '@/lib/server/db';
import type { Job } from '@/lib/server/jobs';
import { JobInputError, JobQueue, jobInputSchema } from '@/lib/server/jobs';
import { getModel } from '@/lib/server/registry';

const SAMPLE = path.resolve('public/samples/mock-clip.mp4');

function waitFor(queue: JobQueue, id: string, statuses: string[]): Promise<Job> {
  return new Promise((resolve) => {
    const current = queue.get(id);
    if (current && statuses.includes(current.status)) return resolve(current);
    const off = queue.subscribe(id, (job) => {
      if (statuses.includes(job.status)) {
        off();
        resolve(job);
      }
    });
  });
}

// Adapter that records how many generations overlap.
function trackingAdapter(lane: 'gpu' | 'cloud', ms: number) {
  const stats = { running: 0, maxConcurrent: 0, order: [] as string[] };
  const adapter: Adapter = {
    id: lane === 'gpu' ? 'mock' : 'fal',
    lane,
    async generate(req: GenerateRequest) {
      stats.running++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.running);
      stats.order.push(req.params.prompt);
      try {
        req.onProgress({ progress: 0.5, status: 'generating' });
        await sleep(ms, req.signal);
        const filePath = path.join(req.outputDir, `${req.jobId}.mp4`);
        fs.writeFileSync(filePath, 'x');
        return { filePath, mediaType: 'video' };
      } finally {
        stats.running--;
      }
    },
    async status() {
      return new Map();
    },
  };
  return { adapter, stats };
}

describe('job queue', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zf-queue-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeQueue = (adapters: ConstructorParameters<typeof JobQueue>[0]['adapters'], db = openDatabase(':memory:')) =>
    new JobQueue({ db, adapters, getModel, outputsDir: dir, resolveUpload: () => null });

  it('runs a mock job to completion and stores a relative output path', async () => {
    const queue = makeQueue({ mock: createMockAdapter({ samplePath: SAMPLE, stepMs: 0 }) });
    const updates: Job[] = [];
    const job = queue.submit({ modelId: 'mock-video', prompt: 'hello' });
    queue.subscribe(job.id, (j) => updates.push(j));
    const done = await waitFor(queue, job.id, ['succeeded', 'failed']);
    expect(done.status).toBe('succeeded');
    expect(done.outputPath).toBe(`studio/${job.id}.mp4`);
    expect(fs.existsSync(path.join(dir, done.outputPath!))).toBe(true);
    expect(updates.some((u) => u.status === 'running')).toBe(true);
    expect(queue.get(job.id)?.status).toBe('succeeded');
  });

  it('runs only one GPU job at a time, in submission order', async () => {
    const { adapter, stats } = trackingAdapter('gpu', 30);
    const queue = makeQueue({ mock: adapter });
    const jobs = ['a', 'b', 'c'].map((p) => queue.submit({ modelId: 'mock-video', prompt: p }));
    await Promise.all(jobs.map((j) => waitFor(queue, j.id, ['succeeded'])));
    expect(stats.maxConcurrent).toBe(1);
    expect(stats.order).toEqual(['a', 'b', 'c']);
  });

  it('cancels a queued job without running it', async () => {
    const { adapter, stats } = trackingAdapter('gpu', 50);
    const queue = makeQueue({ mock: adapter });
    const first = queue.submit({ modelId: 'mock-video', prompt: 'first' });
    const second = queue.submit({ modelId: 'mock-video', prompt: 'second' });
    expect(queue.cancel(second.id)).toBe(true);
    await waitFor(queue, first.id, ['succeeded']);
    expect(queue.get(second.id)?.status).toBe('cancelled');
    expect(stats.order).toEqual(['first']);
  });

  it('cancels a running job through its abort signal', async () => {
    const queue = makeQueue({ mock: createMockAdapter({ samplePath: SAMPLE, stepMs: 30 }) });
    const job = queue.submit({ modelId: 'mock-video', prompt: 'long' });
    await waitFor(queue, job.id, ['running']);
    expect(queue.cancel(job.id)).toBe(true);
    const done = await waitFor(queue, job.id, ['cancelled', 'succeeded', 'failed']);
    expect(done.status).toBe('cancelled');
  });

  it('records adapter failures as failed jobs with the error message', async () => {
    const failing: Adapter = {
      id: 'mock',
      lane: 'gpu',
      generate: async () => { throw new Error('CUDA out of memory'); },
      status: async () => new Map(),
    };
    const queue = makeQueue({ mock: failing });
    const job = queue.submit({ modelId: 'mock-video', prompt: 'x' });
    const done = await waitFor(queue, job.id, ['failed']);
    expect(done.error).toBe('CUDA out of memory');
  });

  it('validates input against the model', () => {
    const queue = makeQueue({ mock: createMockAdapter({ samplePath: SAMPLE, stepMs: 0 }) });
    expect(() => queue.submit({ modelId: 'nope', prompt: 'x' })).toThrow(JobInputError);
    expect(() => queue.submit({ modelId: 'mock-video', prompt: 'x', audioUploadId: crypto.randomUUID() })).toThrow(/does not accept an audio/);
    expect(() => queue.submit({ modelId: 'mock-video', prompt: 'x', aspectRatio: '4:3' })).toThrow(/supports/);
    // Wan 2.2 i2v needs a start frame.
    expect(() => makeQueue({ wan2gp: createMockAdapter() }).submit({ modelId: 'wan-2.2-i2v', prompt: 'x' })).toThrow(/needs a start image/);
    // Last frames only for models that support them.
    expect(() => queue.submit({ modelId: 'mock-video', prompt: 'x', endImageUploadId: crypto.randomUUID() })).toThrow(/does not accept a last-frame image/);
  });

  it('rejects malformed requests at the schema level', () => {
    expect(() => jobInputSchema.parse({ modelId: 'mock-video', prompt: '   ' })).toThrow();
    expect(() => jobInputSchema.parse({ modelId: 'mock-video', prompt: 'x', imageUploadId: '../../etc/passwd' })).toThrow();
    expect(() => jobInputSchema.parse({ modelId: 'mock-video', prompt: 'x', extra: 1 })).toThrow();
    expect(() => jobInputSchema.parse({ modelId: 'Mock Video', prompt: 'x' })).toThrow();
  });

  it('marks jobs left running by a previous process as failed on startup', async () => {
    const db = openDatabase(':memory:');
    const { adapter } = trackingAdapter('gpu', 10_000);
    const first = makeQueue({ mock: adapter }, db);
    const job = first.submit({ modelId: 'mock-video', prompt: 'x' });
    await waitFor(first, job.id, ['running']);
    const second = makeQueue({ mock: adapter }, db);
    expect(second.get(job.id)).toMatchObject({ status: 'failed', error: 'Interrupted by a server restart' });
    first.cancel(job.id);
  });
});
