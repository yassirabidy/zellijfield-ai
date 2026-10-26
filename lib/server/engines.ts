import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ClientError } from './http';

// Engines (Wan2GP, ComfyUI) are installed, started, stopped and deleted by the engine manager
// on the Windows side (scripts/engine-manager.ps1, started by start.bat). The studio never
// touches Docker: it reads <data>/engines/status.json and drops request files that name one of
// the fixed engines and actions below.

export const engineIdSchema = z.enum(['wan2gp', 'comfyui']);
export const engineActionSchema = z.enum(['install', 'start', 'stop', 'delete']);
export type EngineId = z.infer<typeof engineIdSchema>;
export type EngineAction = z.infer<typeof engineActionSchema>;

export const ENGINE_INFO: Record<EngineId, { name: string; sizeEstimate: string }> = {
  // Disk usage reported by Docker for the built images (CUDA 12.8, PyTorch 2.10).
  wan2gp: { name: 'Wan2GP', sizeEstimate: '≈ 34 GB' },
  comfyui: { name: 'ComfyUI', sizeEstimate: '≈ 16 GB' },
};

// The manager rewrites status.json every second; older than this means it is not running.
const STALE_MS = 15_000;

const opSchema = z
  .object({
    action: engineActionSchema,
    status: z.enum(['running', 'succeeded', 'failed']),
    progress: z.number().min(0).max(1).catch(0),
    message: z.string().nullable().catch(null),
    error: z.string().nullable().catch(null),
    startedAt: z.number().nullable().catch(null),
    finishedAt: z.number().nullable().catch(null),
  })
  .nullable()
  .catch(null);

const engineStatusSchema = z.object({
  installed: z.boolean(),
  sizeLabel: z.string().nullable().catch(null),
  sizeBytes: z.number().nullable().catch(null),
  container: z.string().catch('none'),
  health: z.string().catch(''),
  busy: z.boolean().catch(false),
  op: opSchema,
});

const statusFileSchema = z.object({
  updatedAt: z.number(),
  dockerOk: z.boolean(),
  engines: z.object({ wan2gp: engineStatusSchema, comfyui: engineStatusSchema }),
});

export interface EngineState {
  id: EngineId;
  name: string;
  sizeEstimate: string;
  installed: boolean;
  sizeLabel: string | null;
  sizeBytes: number | null;
  // Docker container state: running, exited, created, restarting, none, ...
  container: string;
  health: string;
  // Container up and, when it has a healthcheck, healthy.
  ready: boolean;
  busy: boolean;
  op: z.infer<typeof opSchema>;
}

export interface EnginesSnapshot {
  managerOnline: boolean;
  dockerOk: boolean;
  engines: EngineState[];
}

export function createEngineManager(options: { dir: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const requestsDir = path.join(options.dir, 'requests');

  function snapshot(): EnginesSnapshot {
    let parsed: z.infer<typeof statusFileSchema> | null = null;
    try {
      parsed = statusFileSchema.parse(JSON.parse(fs.readFileSync(path.join(options.dir, 'status.json'), 'utf8')));
    } catch {
      parsed = null;
    }
    const managerOnline = parsed !== null && now() - parsed.updatedAt < STALE_MS;
    return {
      managerOnline,
      dockerOk: managerOnline && parsed!.dockerOk,
      engines: engineIdSchema.options.map((id) => {
        const s = managerOnline ? parsed!.engines[id] : null;
        const container = s?.container ?? 'none';
        return {
          id,
          ...ENGINE_INFO[id],
          installed: s?.installed ?? false,
          sizeLabel: s?.sizeLabel ?? null,
          sizeBytes: s?.sizeBytes ?? null,
          container,
          health: s?.health ?? '',
          ready: container === 'running' && (s?.health === '' || s?.health === 'healthy'),
          busy: s?.busy ?? false,
          op: s?.op ?? null,
        };
      }),
    };
  }

  function get(id: EngineId): EngineState {
    return snapshot().engines.find((e) => e.id === id)!;
  }

  // Writes a request file for the manager (write + rename, so it never reads a partial file).
  function request(id: EngineId, action: EngineAction): void {
    const snap = snapshot();
    if (!snap.managerOnline) throw new ClientError('The engine manager is not running. Start Zellijfield AI with start.bat, then try again.');
    if (!snap.dockerOk) throw new ClientError('Docker Desktop is not running. Start it, then try again.');
    const engine = snap.engines.find((e) => e.id === id)!;
    if (engine.busy || engine.op?.status === 'running') throw new ClientError(`${engine.name} is busy (${engine.op?.action ?? 'working'}); wait for it to finish.`);
    if (action !== 'install' && !engine.installed) throw new ClientError(`${engine.name} is not installed.`);
    fs.mkdirSync(requestsDir, { recursive: true });
    const file = path.join(requestsDir, `${crypto.randomUUID()}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ engine: id, action, requestedAt: now() }));
    fs.renameSync(`${file}.tmp`, file);
  }

  return { snapshot, get, request };
}

export type EngineManager = ReturnType<typeof createEngineManager>;
