import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Adapter, GenerationParams } from './adapters/types';
import { CancelledError } from './adapters/types';
import type { Database } from './db';
import type { ModelEntry } from './registry';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  modelId: string;
  backend: ModelEntry['backend'];
  status: JobStatus;
  progress: number;
  message: string | null;
  params: JobInput;
  // Relative to OUTPUTS_DIR, forward slashes (e.g. "studio/<id>.mp4").
  outputPath: string | null;
  mediaType: 'video' | 'image' | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const uuid = z.string().uuid();

export const jobInputSchema = z
  .object({
    modelId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(80),
    prompt: z.string().trim().min(1, 'Prompt is required').max(4000),
    negativePrompt: z.string().trim().max(2000).optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional(),
    seed: z.number().int().min(0).max(4_294_967_295).optional(),
    steps: z.number().int().min(1).max(200).optional(),
    frames: z.number().int().min(1).max(2000).optional(),
    imageUploadId: uuid.optional(),
    audioUploadId: uuid.optional(),
  })
  .strict();

export type JobInput = z.infer<typeof jobInputSchema>;

// Checks the input against what the chosen model accepts. Returns an error message or null.
export function validateForModel(input: JobInput, model: ModelEntry): string | null {
  for (const kind of ['image', 'audio'] as const) {
    const provided = Boolean(kind === 'image' ? input.imageUploadId : input.audioUploadId);
    const mode = model.inputs[kind];
    if (mode === 'required' && !provided) return `${model.name} needs an ${kind} input.`;
    if (mode === 'none' && provided) return `${model.name} does not accept an ${kind} input.`;
  }
  if (input.aspectRatio && model.aspectRatios.length > 0 && !model.aspectRatios.includes(input.aspectRatio)) {
    return `${model.name} supports ${model.aspectRatios.join(', ')} only.`;
  }
  return null;
}

interface JobRow {
  id: string;
  model_id: string;
  backend: string;
  status: string;
  progress: number;
  message: string | null;
  params: string;
  output_path: string | null;
  media_type: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function fromRow(r: JobRow): Job {
  return {
    id: r.id,
    modelId: r.model_id,
    backend: r.backend as Job['backend'],
    status: r.status as JobStatus,
    progress: r.progress,
    message: r.message,
    params: JSON.parse(r.params) as JobInput,
    outputPath: r.output_path,
    mediaType: r.media_type as Job['mediaType'],
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const LANE_CONCURRENCY = { gpu: 1, cloud: 2 } as const;
const PROGRESS_WRITE_MS = 250;

export interface JobQueueOptions {
  db: Database;
  adapters: Partial<Record<ModelEntry['backend'], Adapter>>;
  getModel: (id: string) => ModelEntry | undefined;
  outputsDir: string;
  // Upload id -> absolute path, or null when unknown.
  resolveUpload: (id: string) => string | null;
  now?: () => number;
}

export class JobQueue extends EventEmitter {
  private readonly opts: JobQueueOptions;
  private readonly now: () => number;
  private readonly running = new Map<string, AbortController>();
  private readonly active = { gpu: 0, cloud: 0 };
  private readonly lastWrite = new Map<string, number>();

  constructor(opts: JobQueueOptions) {
    super();
    this.setMaxListeners(0);
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.recover();
  }

  // Jobs that were queued or running when the server stopped cannot resume.
  private recover(): void {
    this.opts.db
      .prepare(`UPDATE jobs SET status = 'failed', error = 'Interrupted by a server restart', updated_at = ? WHERE status IN ('queued', 'running')`)
      .run(this.now());
  }

  get(id: string): Job | null {
    const row = this.opts.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? fromRow(row) : null;
  }

  list(limit = 50): Job[] {
    const rows = this.opts.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as unknown as JobRow[];
    return rows.map(fromRow);
  }

  submit(input: JobInput): Job {
    const model = this.opts.getModel(input.modelId);
    if (!model) throw new JobInputError(`Unknown model "${input.modelId}"`);
    const problem = validateForModel(input, model);
    if (problem) throw new JobInputError(problem);
    if (!this.opts.adapters[model.backend]) throw new JobInputError(`Backend "${model.backend}" is not available`);
    for (const id of [input.imageUploadId, input.audioUploadId]) {
      if (id && !this.opts.resolveUpload(id)) throw new JobInputError('Uploaded file not found — upload it again.');
    }

    const t = this.now();
    const job: Job = {
      id: crypto.randomUUID(),
      modelId: model.id,
      backend: model.backend,
      status: 'queued',
      progress: 0,
      message: 'Waiting in queue',
      params: input,
      outputPath: null,
      mediaType: null,
      error: null,
      createdAt: t,
      updatedAt: t,
    };
    this.opts.db
      .prepare(`INSERT INTO jobs (id, model_id, backend, status, progress, message, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(job.id, job.modelId, job.backend, job.status, job.progress, job.message, JSON.stringify(input), t, t);
    this.emitJob(job);
    queueMicrotask(() => this.pump());
    return job;
  }

  cancel(id: string): boolean {
    const job = this.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      this.finish(job.id, { status: 'cancelled', message: 'Cancelled' });
      return true;
    }
    const controller = this.running.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  // Calls `listener` with every update of one job; returns an unsubscribe function.
  subscribe(id: string, listener: (job: Job) => void): () => void {
    const event = `job:${id}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }

  private emitJob(job: Job): void {
    this.emit(`job:${job.id}`, job);
    this.emit('job', job);
  }

  private update(id: string, fields: Partial<Pick<Job, 'status' | 'progress' | 'message' | 'outputPath' | 'mediaType' | 'error'>>, force = false): void {
    const t = this.now();
    const last = this.lastWrite.get(id) ?? 0;
    const current = this.get(id);
    if (!current) return;
    const next: Job = { ...current, ...fields, updatedAt: t };
    if (force || t - last >= PROGRESS_WRITE_MS) {
      this.lastWrite.set(id, t);
      this.opts.db
        .prepare(`UPDATE jobs SET status = ?, progress = ?, message = ?, output_path = ?, media_type = ?, error = ?, updated_at = ? WHERE id = ?`)
        .run(next.status, next.progress, next.message, next.outputPath, next.mediaType, next.error, t, id);
    }
    this.emitJob(next);
  }

  private finish(id: string, fields: Parameters<JobQueue['update']>[1]): void {
    this.update(id, fields, true);
    this.lastWrite.delete(id);
  }

  private pump(): void {
    const queued = this.opts.db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC`).all() as unknown as JobRow[];
    for (const row of queued) {
      const job = fromRow(row);
      const adapter = this.opts.adapters[job.backend];
      if (!adapter) {
        this.finish(job.id, { status: 'failed', error: `Backend "${job.backend}" is not available`, message: null });
        continue;
      }
      if (this.active[adapter.lane] >= LANE_CONCURRENCY[adapter.lane]) continue;
      this.active[adapter.lane] += 1;
      void this.run(job, adapter).finally(() => {
        this.active[adapter.lane] -= 1;
        this.pump();
      });
    }
  }

  private async run(job: Job, adapter: Adapter): Promise<void> {
    const model = this.opts.getModel(job.modelId);
    const controller = new AbortController();
    this.running.set(job.id, controller);
    this.update(job.id, { status: 'running', progress: 0, message: 'Starting' }, true);
    try {
      if (!model) throw new Error(`Model "${job.modelId}" is no longer in models.json`);
      const outputDir = path.join(this.opts.outputsDir, 'studio');
      fs.mkdirSync(outputDir, { recursive: true });
      const p = job.params;
      const params: GenerationParams = {
        prompt: p.prompt,
        negativePrompt: p.negativePrompt,
        aspectRatio: p.aspectRatio,
        seed: p.seed,
        steps: p.steps,
        frames: p.frames,
        imagePath: p.imageUploadId ? this.opts.resolveUpload(p.imageUploadId) ?? undefined : undefined,
        audioPath: p.audioUploadId ? this.opts.resolveUpload(p.audioUploadId) ?? undefined : undefined,
      };
      const result = await adapter.generate({
        jobId: job.id,
        model,
        params,
        outputDir,
        signal: controller.signal,
        onProgress: (e) => {
          if (controller.signal.aborted) return;
          this.update(job.id, { progress: Math.max(0, Math.min(1, e.progress)), message: e.message ?? e.status });
        },
      });
      const rel = path.relative(this.opts.outputsDir, result.filePath).split(path.sep).join('/');
      this.finish(job.id, { status: 'succeeded', progress: 1, message: 'Done', outputPath: rel, mediaType: result.mediaType, error: null });
    } catch (err) {
      if (err instanceof CancelledError || controller.signal.aborted) {
        this.finish(job.id, { status: 'cancelled', message: 'Cancelled' });
      } else {
        this.finish(job.id, { status: 'failed', message: null, error: (err as Error).message || String(err) });
      }
    } finally {
      this.running.delete(job.id);
    }
  }
}

export class JobInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobInputError';
  }
}
