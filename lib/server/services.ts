import path from 'node:path';
import { createFalAdapter, createReplicateAdapter } from './adapters/cloud';
import { createComfyuiAdapter } from './adapters/comfyui';
import { createMockAdapter } from './adapters/mock';
import type { Adapter, ModelStatus } from './adapters/types';
import { createWan2gpAdapter } from './adapters/wan2gp';
import { getDb } from './db';
import { getEnv } from './env';
import { JobQueue } from './jobs';
import type { ModelEntry } from './registry';
import { getModel, getRegistry } from './registry';
import { getApiKey, getPublicSettings } from './settings';
import { resolveUpload } from './uploads';

// Process-wide singletons (adapters + job queue). Kept on globalThis so Next's dev reloads and
// separate route bundles share one queue — required for the one-GPU-job-at-a-time guarantee.

interface Services {
  adapters: Partial<Record<ModelEntry['backend'], Adapter>>;
  queue: JobQueue;
  uploadsDir: string;
}

function build(): Services {
  const env = getEnv();
  const db = getDb();
  const uploadsDir = path.join(env.dataDir, 'uploads');
  const adapters: Services['adapters'] = {
    mock: createMockAdapter({ stepMs: env.mockStepMs }),
    wan2gp: createWan2gpAdapter({
      mode: env.wan2gpMode,
      getUrl: () => getPublicSettings().wan2gpUrl,
      dir: env.wan2gpDir,
      python: env.wan2gpPython,
    }),
    comfyui: createComfyuiAdapter({
      getUrl: () => getPublicSettings().comfyuiUrl,
      workflowsDir: env.workflowsDir,
      modelsDir: path.join(env.modelsDir, 'comfyui'),
    }),
    fal: createFalAdapter({ getKey: () => getApiKey('fal') }),
    replicate: createReplicateAdapter({ getKey: () => getApiKey('replicate') }),
  };
  const queue = new JobQueue({
    db,
    adapters,
    getModel,
    outputsDir: env.outputsDir,
    resolveUpload: (id) => resolveUpload(uploadsDir, id),
  });
  return { adapters, queue, uploadsDir };
}

const globalForServices = globalThis as unknown as { __zfServices?: Services };
export function getServices(): Services {
  globalForServices.__zfServices ??= build();
  return globalForServices.__zfServices;
}

// A running backend answers in milliseconds; a stopped one (e.g. in the mock profile, where the
// service name does not resolve) should not hold up the model list.
const STATUS_TIMEOUT_MS = 3000;

const BACKEND_LABEL: Record<ModelEntry['backend'], string> = {
  mock: 'Mock', wan2gp: 'Wan2GP', comfyui: 'ComfyUI', fal: 'fal', replicate: 'Replicate',
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface ModelWithStatus extends ModelEntry {
  availability: ModelStatus;
}

// Registry entries with live status, one status call per backend, run in parallel.
export async function listModelsWithStatus(): Promise<ModelWithStatus[]> {
  const { adapters } = getServices();
  const models = getRegistry().models;
  const byBackend = new Map<ModelEntry['backend'], ModelEntry[]>();
  for (const m of models) byBackend.set(m.backend, [...(byBackend.get(m.backend) ?? []), m]);
  const statuses = new Map<string, ModelStatus>();
  await Promise.all(
    [...byBackend].map(async ([backend, list]) => {
      const adapter = adapters[backend];
      if (!adapter) {
        for (const m of list) statuses.set(m.id, { status: 'unreachable', detail: `Backend ${backend} not configured` });
        return;
      }
      try {
        const res = await withTimeout(
          adapter.status(list),
          STATUS_TIMEOUT_MS,
          `${BACKEND_LABEL[backend]} is not running or not reachable (no answer within ${STATUS_TIMEOUT_MS / 1000}s). Start it with the "${backend}" or "full" profile, or check its URL in Settings.`,
        );
        for (const [id, s] of res) statuses.set(id, s);
      } catch (err) {
        for (const m of list) statuses.set(m.id, { status: 'unreachable', detail: (err as Error).message });
      }
    }),
  );
  return models.map((m) => ({ ...m, availability: statuses.get(m.id) ?? { status: 'unreachable' } }));
}
