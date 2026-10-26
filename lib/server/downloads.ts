import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ClientError } from './http';
import type { EngineAction, EngineId, EngineState } from './engines';
import type { ModelEntry } from './registry';

// Downloads and removes local model weights from the Models page.
// - ComfyUI models: the studio fetches the Hugging Face files listed under comfyui.downloads in
//   models.json into models/comfyui (resumable, one download at a time).
// - Wan2GP models: the model-tools service in the wan2gp container runs WanGP's own downloader
//   (docker/wan2gp/zf_model_server.py), so the files are exactly those a generation would fetch.
// Sources come only from models.json; the browser just names a model id.

// waiting-engine: the model's engine is being installed or started first (engine manager).
export type DownloadStatus = 'waiting-engine' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';

export interface DownloadState {
  modelId: string;
  status: DownloadStatus;
  file?: string | null;
  fileIndex?: number | null;
  fileCount?: number | null;
  // Bytes of the current file written so far, and its size.
  completed?: number | null;
  total?: number | null;
  // All bytes received by this download so far.
  received?: number | null;
  error?: string | null;
}

export interface LocalFiles {
  present: number;
  total: number;
  bytes: number;
  // Unfinished downloads (.part files), resumed by the next download or deleted by remove.
  partialBytes: number;
}

export interface ModelDownloadInfo {
  modelId: string;
  backend: 'wan2gp' | 'comfyui';
  downloadable: boolean;
  download: DownloadState | null;
  // ComfyUI only: required files present in models/comfyui (no ComfyUI service needed).
  files?: LocalFiles;
}

export interface RemoveResult {
  removed: string[];
  keptShared: string[];
  bytesFreed: number;
}

export interface DownloadManagerOptions {
  // models/comfyui
  comfyuiDir: string;
  getToolsUrl: () => string;
  getModels: () => ModelEntry[];
  // True while the model has queued or running jobs.
  isBusy: (modelId: string) => boolean;
  fetchImpl?: typeof fetch;
  // Engine manager: lets a download install or start the model's engine first.
  engines?: {
    snapshot: () => { managerOnline: boolean; engines: EngineState[] };
    request: (id: EngineId, action: EngineAction) => void;
  };
  // How often a waiting download checks whether its engine is ready.
  engineCheckMs?: number;
  // Attempts per step for ComfyUI downloads, and the base wait between them.
  retries?: number;
  retryDelayMs?: number;
}

const HF = 'https://huggingface.co/';
const TOOLS_TIMEOUT_MS = 4000;
// WanGP needs about a minute to start before it can measure or delete anything.
const TOOLS_REMOVE_TIMEOUT_MS = 15 * 60_000;
const MAX_TREE_PAGES = 50;

interface PlannedFile {
  url: string;
  target: string;
  size: number | null;
}

interface ToolsDownload {
  status?: string;
  model_type?: string;
  file?: string | null;
  completed?: number | null;
  total?: number | null;
  received?: number | null;
  file_index?: number | null;
  file_count?: number | null;
  error?: string | null;
}

function insideDir(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes the models folder: ${rel}`);
  return resolved;
}

async function sizeOf(target: string): Promise<number | null> {
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) return null;
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of await fsp.readdir(target, { withFileTypes: true })) total += (await sizeOf(path.join(target, entry.name))) ?? 0;
  return total;
}

function comfyTargets(model: ModelEntry): string[] {
  return model.comfyui?.requiredFiles ?? [];
}

export function createDownloadManager(input: DownloadManagerOptions) {
  const options = { retries: 5, retryDelayMs: 3000, engineCheckMs: 5000, ...input };
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = options.comfyuiDir;
  const comfyStates = new Map<string, DownloadState>();
  // Wan2GP downloads waiting for the engine to be installed / started.
  const waiting = new Map<string, DownloadState>();
  let waitTimer: NodeJS.Timeout | null = null;
  let active: { modelId: string; controller: AbortController } | null = null;

  function localModel(id: string): ModelEntry {
    const model = options.getModels().find((m) => m.id === id);
    if (!model || (model.backend !== 'wan2gp' && model.backend !== 'comfyui')) throw new ClientError('Unknown local model');
    return model;
  }

  // ---- Wan2GP (model-tools service) ----

  async function tools<T>(pathname: string, init: RequestInit = {}, timeoutMs = TOOLS_TIMEOUT_MS): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetchImpl(new URL(pathname, options.getToolsUrl()), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw Object.assign(new ClientError('Wan2GP is not running. Start it with the "wan2gp" or "full" profile, then try again.'), { unreachable: true });
    }
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }

  const postJson = (data: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  function wan2gpState(models: ModelEntry[], raw: ToolsDownload): DownloadState | null {
    const model = models.find((m) => m.wan2gp?.modelType === raw.model_type);
    const status = raw.status as DownloadStatus;
    if (!model || !['running', 'cancelling', 'succeeded', 'failed', 'cancelled'].includes(status)) return null;
    return {
      modelId: model.id,
      status,
      file: raw.file ?? null,
      fileIndex: raw.file_index ?? null,
      fileCount: raw.file_count ?? null,
      completed: raw.completed ?? null,
      total: raw.total ?? null,
      received: raw.received ?? null,
      error: raw.error ?? null,
    };
  }

  // ---- ComfyUI (downloaded by the studio) ----

  async function remoteSize(url: string, signal: AbortSignal): Promise<number | null> {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal });
    const size = Number(res.headers.get('x-linked-size') ?? res.headers.get('content-length'));
    return Number.isFinite(size) && size > 0 ? size : null;
  }

  async function plan(model: ModelEntry, signal: AbortSignal): Promise<PlannedFile[]> {
    const files: PlannedFile[] = [];
    for (const d of model.comfyui?.downloads ?? []) {
      if ('file' in d) {
        const target = insideDir(root, d.file);
        if (fs.existsSync(target)) continue;
        files.push({ url: d.url, target, size: await remoteSize(d.url, signal) });
        continue;
      }
      // Whole repository: list it with the Hugging Face API (paginated through the Link header).
      let next: string | null = `${HF}api/models/${d.repo}/tree/${encodeURIComponent(d.revision)}?recursive=true`;
      for (let page = 0; next && page < MAX_TREE_PAGES; page++) {
        const res: Response = await fetchImpl(next, { signal });
        if (!res.ok) throw new Error(`Hugging Face listing of ${d.repo} failed: HTTP ${res.status}`);
        const entries = (await res.json()) as Array<{ type: string; path: string; size?: number; lfs?: { size?: number } }>;
        for (const entry of entries) {
          if (entry.type !== 'file') continue;
          const target = insideDir(root, path.posix.join(d.dir, entry.path));
          const size = entry.lfs?.size ?? entry.size ?? null;
          if (size !== null && (await sizeOf(target)) === size) continue;
          const encoded = entry.path.split('/').map(encodeURIComponent).join('/');
          files.push({ url: `${HF}${d.repo}/resolve/${encodeURIComponent(d.revision)}/${encoded}`, target, size });
        }
        const link: string | null = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
        next = link && link.startsWith(HF) ? link : null;
      }
    }
    return files;
  }

  async function fetchFile(file: PlannedFile, state: DownloadState, signal: AbortSignal): Promise<void> {
    const part = `${file.target}.part`;
    await fsp.mkdir(path.dirname(file.target), { recursive: true });
    // Resume an interrupted download when the server supports ranges.
    let start = (await fsp.stat(part).catch(() => null))?.size ?? 0;
    if (file.size !== null && start > file.size) start = 0;
    const res = await fetchImpl(file.url, { signal, headers: start > 0 ? { Range: `bytes=${start}-` } : {} });
    if (start > 0 && res.status !== 206) start = 0;
    if (!res.ok || !res.body) throw new Error(`Download of ${path.basename(file.target)} failed: HTTP ${res.status}`);
    state.completed = start;
    state.total = file.size;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        state.completed = (state.completed ?? 0) + chunk.length;
        state.received = (state.received ?? 0) + chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' }), { signal });
    const written = (await fsp.stat(part)).size;
    if (file.size !== null && written !== file.size) throw new Error(`Download of ${path.basename(file.target)} is incomplete (${written} of ${file.size} bytes); try again to resume.`);
    await fsp.rename(part, file.target);
  }

  // Brief network drops (DNS hiccups, resets) are retried; each retry resumes the .part file.
  async function withRetries<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        if (signal.aborted || attempt >= options.retries) throw err;
        console.warn(`[downloads] attempt ${attempt} failed (${(err as Error).message}); retrying`);
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs * attempt));
      }
    }
  }

  async function runComfy(model: ModelEntry, state: DownloadState, controller: AbortController): Promise<void> {
    try {
      const files = await withRetries(controller.signal, () => plan(model, controller.signal));
      state.fileCount = files.length;
      for (const [index, file] of files.entries()) {
        state.fileIndex = index + 1;
        state.file = path.basename(file.target);
        await withRetries(controller.signal, () => fetchFile(file, state, controller.signal));
      }
      state.status = 'succeeded';
    } catch (err) {
      if (controller.signal.aborted) state.status = 'cancelled';
      else {
        state.status = 'failed';
        state.error = (err as Error).message;
        console.error(`[downloads] ${model.id}: ${state.error}`);
      }
    } finally {
      active = null;
    }
  }

  async function localFiles(model: ModelEntry): Promise<LocalFiles> {
    let present = 0;
    let bytes = 0;
    let partialBytes = 0;
    for (const rel of comfyTargets(model)) {
      const target = insideDir(root, rel);
      const size = await sizeOf(target);
      if (size !== null) {
        present++;
        bytes += size;
      }
      partialBytes += (await sizeOf(`${target}.part`)) ?? 0;
    }
    return { present, total: comfyTargets(model).length, bytes, partialBytes };
  }

  // ---- engines ----

  // Asks the engine manager to install (or start) an engine. Returns false when there is no
  // manager to ask, so the caller reports the usual "not running" message.
  function prepareEngine(id: EngineId, opts: { installOnly?: boolean } = {}): boolean {
    const snap = options.engines?.snapshot();
    if (!snap?.managerOnline) return false;
    const engine = snap.engines.find((e) => e.id === id);
    if (!engine) return false;
    if (engine.busy || engine.op?.status === 'running') return true;
    if (!engine.installed) options.engines!.request(id, 'install');
    else if (!opts.installOnly && engine.container !== 'running') options.engines!.request(id, 'start');
    return true;
  }

  function scheduleWait() {
    if (waitTimer || waiting.size === 0) return;
    waitTimer = setInterval(() => void waitTick(), options.engineCheckMs);
    waitTimer.unref?.();
  }

  // Starts waiting Wan2GP downloads once the engine's model-tools service answers.
  async function waitTick() {
    const engine = options.engines?.snapshot().engines.find((e) => e.id === 'wan2gp');
    for (const [modelId, state] of waiting) {
      if (state.status === 'failed') continue;
      if (engine?.op?.status === 'failed' && (engine.op.action === 'install' || engine.op.action === 'start')) {
        Object.assign(state, { status: 'failed', error: `Wan2GP could not be ${engine.op.action === 'install' ? 'installed' : 'started'}: ${engine.op.error ?? 'see the engine manager'}` });
        continue;
      }
      const ready = await tools('/health').then((r) => r.status === 200, () => false);
      if (!ready) continue;
      const model = options.getModels().find((m) => m.id === modelId);
      const res = await tools<{ error?: string }>('/download', postJson({ model_type: model?.wan2gp?.modelType })).catch((err: Error) => ({ status: 0, body: { error: err.message } }));
      if (res.status === 202) waiting.delete(modelId);
      else if (res.status !== 409) Object.assign(state, { status: 'failed', error: res.body.error ?? `Wan2GP refused the download (HTTP ${res.status})` });
    }
    if ([...waiting.values()].every((s) => s.status === 'failed') && waitTimer) {
      clearInterval(waitTimer);
      waitTimer = null;
    }
  }

  // ---- public API ----

  async function overview(): Promise<ModelDownloadInfo[]> {
    const models = options.getModels().filter((m) => m.backend === 'wan2gp' || m.backend === 'comfyui');
    let wan2gp: DownloadState | null = null;
    if (models.some((m) => m.backend === 'wan2gp')) {
      wan2gp = await tools<ToolsDownload>('/download').then((r) => wan2gpState(models, r.body), () => null);
    }
    return Promise.all(
      models.map(async (m): Promise<ModelDownloadInfo> => {
        if (m.backend === 'wan2gp') {
          const pending = waiting.get(m.id);
          return { modelId: m.id, backend: 'wan2gp', downloadable: true, download: pending ? { ...pending } : wan2gp?.modelId === m.id ? wan2gp : null };
        }
        const state = comfyStates.get(m.id);
        return {
          modelId: m.id,
          backend: 'comfyui',
          downloadable: (m.comfyui?.downloads.length ?? 0) > 0,
          download: state ? { ...state } : null,
          files: await localFiles(m),
        };
      }),
    );
  }

  async function start(modelId: string): Promise<void> {
    const model = localModel(modelId);
    if (model.backend === 'wan2gp') {
      let res: { status: number; body: { error?: string } };
      try {
        res = await tools<{ error?: string }>('/download', postJson({ model_type: model.wan2gp!.modelType }));
      } catch (err) {
        // Engine not running: install or start it first, then download (checked by waitTick).
        if (!(err as { unreachable?: boolean }).unreachable || !prepareEngine('wan2gp')) throw err;
        waiting.set(modelId, { modelId, status: 'waiting-engine' });
        scheduleWait();
        return;
      }
      if (res.status !== 202) throw new ClientError(res.body.error ?? `Wan2GP refused the download (HTTP ${res.status})`);
      waiting.delete(modelId);
      return;
    }
    if (!model.comfyui?.downloads.length) throw new ClientError('This model has no download source in models.json');
    // ComfyUI files are fetched by the studio; install the engine alongside so the model can run.
    prepareEngine('comfyui', { installOnly: true });
    if (active) throw new ClientError(`Another download is running (${active.modelId}); wait for it or cancel it first`);
    const controller = new AbortController();
    const state: DownloadState = { modelId, status: 'running', received: 0 };
    comfyStates.set(modelId, state);
    active = { modelId, controller };
    void runComfy(model, state, controller);
  }

  async function cancel(modelId: string): Promise<void> {
    const model = localModel(modelId);
    if (model.backend === 'wan2gp') {
      if (waiting.delete(modelId)) return;
      const res = await tools<{ error?: string }>('/download', { method: 'DELETE' });
      if (res.status !== 202) throw new ClientError(res.body.error ?? 'No download is running');
      return;
    }
    if (active?.modelId !== modelId) throw new ClientError('No download is running for this model');
    comfyStates.get(modelId)!.status = 'cancelling';
    active.controller.abort();
  }

  async function remove(modelId: string): Promise<RemoveResult> {
    const model = localModel(modelId);
    if (options.isBusy(modelId)) throw new ClientError('This model has queued or running jobs; wait for them or cancel them first');
    const models = options.getModels();
    if (model.backend === 'wan2gp') {
      const keep = models.filter((m) => m.backend === 'wan2gp' && m.id !== modelId).map((m) => m.wan2gp!.modelType);
      const res = await tools<{ event?: string; removed?: string[]; kept_shared?: string[]; bytes_freed?: number; error?: string; message?: string }>(
        '/remove', postJson({ model_type: model.wan2gp!.modelType, keep }), TOOLS_REMOVE_TIMEOUT_MS);
      if (res.body.event !== 'removed') throw new ClientError(res.body.error ?? res.body.message ?? `Wan2GP could not remove the model (HTTP ${res.status})`);
      return { removed: res.body.removed ?? [], keptShared: res.body.kept_shared ?? [], bytesFreed: res.body.bytes_freed ?? 0 };
    }
    if (active?.modelId === modelId) throw new ClientError('This model is being downloaded; cancel the download first');
    // Files another ComfyUI model still uses stay. That model counts as installed when it has a
    // file of its own on disk, not just files it shares with this one.
    const shared = new Set<string>();
    const mine = new Set(comfyTargets(model));
    for (const other of models) {
      if (other.backend !== 'comfyui' || other.id === modelId) continue;
      const own = comfyTargets(other).filter((rel) => !mine.has(rel));
      const installed = own.length === 0 || own.some((rel) => fs.existsSync(insideDir(root, rel)));
      if (installed) for (const rel of comfyTargets(other)) shared.add(rel);
    }
    const result: RemoveResult = { removed: [], keptShared: [], bytesFreed: 0 };
    for (const rel of comfyTargets(model)) {
      const target = insideDir(root, rel);
      if (shared.has(rel)) {
        if (fs.existsSync(target)) result.keptShared.push(path.basename(rel));
        continue;
      }
      for (const candidate of [target, `${target}.part`]) {
        const size = await sizeOf(candidate);
        if (size === null) continue;
        await fsp.rm(candidate, { recursive: true, force: true });
        result.bytesFreed += size;
        if (candidate === target) result.removed.push(path.basename(rel));
      }
    }
    comfyStates.delete(modelId);
    return result;
  }

  return { overview, start, cancel, remove };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;
