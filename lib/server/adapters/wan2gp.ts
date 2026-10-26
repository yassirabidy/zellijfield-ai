import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelEntry } from '../registry';
import type { Adapter, GenerateRequest, GenerateResult, ModelStatus, ProgressEvent } from './types';
import { CancelledError, throwIfAborted } from './types';
// Shared with the Electron app (CommonJS, no Electron imports):
// MCP client for WanGP's server, the `wgp.py --process` runner, and the settings builder.
import { createMcpClient, normalizeMcpUrl } from '../../../electron/lib/wan2gpMcp';
import * as wan2gpLocal from '../../../electron/lib/wan2gpLocal';
import { buildWan2gpSettings } from '../../../electron/lib/wan2gpCatalog';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm']);

type McpClient = ReturnType<typeof createMcpClient>;

export interface Wan2gpAdapterOptions {
  mode: 'mcp' | 'spawn';
  // MCP mode: resolved per call so a URL change in Settings takes effect immediately.
  getUrl: () => string;
  // Spawn mode (non-Docker): local Wan2GP folder and optional python path.
  dir?: string;
  python?: string;
  fetchImpl?: typeof fetch;
}

// Shape expected by buildWan2gpSettings (electron/lib/wan2gpCatalog.js).
function catalogModel(model: ModelEntry) {
  if (!model.wan2gp) throw new Error(`${model.id} has no wan2gp block`);
  return {
    name: model.name,
    type: model.type,
    modelType: model.wan2gp.modelType,
    resolutions: model.wan2gp.resolutions,
    aspectRatios: model.aspectRatios,
    needsImage: model.inputs.image === 'required',
  };
}

function settingsParams(req: GenerateRequest) {
  const p = req.params;
  return {
    prompt: p.prompt,
    negative_prompt: p.negativePrompt,
    aspect_ratio: p.aspectRatio,
    steps: p.steps,
    video_length: p.frames,
    seed: p.seed,
  };
}

type Wan2gpSettings = Record<string, unknown> & { seed: number };

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function imageMime(filePath: string): string {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// The JS builder always sets model_type, prompt and seed.
// image_start / image_end: WanGP's API infers image_prompt_type (S, E) from them (shared/api.py).
function buildSettings(req: GenerateRequest, imageStart: string | undefined, imageEnd: string | undefined): Wan2gpSettings {
  return buildWan2gpSettings(catalogModel(req.model), settingsParams(req), { imageStart, imageEnd }) as unknown as Wan2gpSettings;
}

function mediaType(filePath: string): 'video' | 'image' {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? 'video' : 'image';
}

function toProgress(event: { status?: string; progress?: number; message?: string; step?: number; totalSteps?: number }): ProgressEvent {
  const stepText = event.step && event.totalSteps ? `step ${event.step}/${event.totalSteps}` : undefined;
  return {
    progress: typeof event.progress === 'number' ? event.progress : 0,
    status: event.status || 'working',
    message: event.message || stepText,
  };
}

export function createWan2gpAdapter(options: Wan2gpAdapterOptions): Adapter {
  const clients = new Map<string, McpClient>();
  const clientFor = (): McpClient => {
    const endpoint = normalizeMcpUrl(options.getUrl());
    let client = clients.get(endpoint);
    if (!client) {
      client = createMcpClient(endpoint, options.fetchImpl ? { fetchImpl: options.fetchImpl } : undefined);
      clients.set(endpoint, client);
    }
    return client;
  };

  async function generateMcp(req: GenerateRequest): Promise<GenerateResult> {
    const client = clientFor();
    let wanJobId: string | null = null;
    const onAbort = () => {
      if (wanJobId) client.cancel(wanJobId).catch(() => {});
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    try {
      req.onProgress({ progress: 0, status: 'starting', message: 'Sending job to Wan2GP' });
      const uploadImage = async (filePath: string | undefined) => {
        if (!filePath) return undefined;
        const bytes = await fs.readFile(filePath);
        return client.uploadImage({ name: path.basename(filePath), bytes, mime: imageMime(filePath) }) as Promise<string>;
      };
      const imageStart = await uploadImage(req.params.imagePath);
      const imageEnd = await uploadImage(req.params.endImagePath);
      throwIfAborted(req.signal);
      const settings = buildSettings(req, imageStart, imageEnd);
      const item = await client.generate(settings, {
        onProgress: (e: Parameters<typeof toProgress>[0]) => req.onProgress(toProgress(e)),
        onJobId: (id: string) => { wanJobId = id; },
        signal: req.signal,
      });
      throwIfAborted(req.signal);
      req.onProgress({ progress: 0.99, status: 'saving', message: 'Downloading result' });
      const { filename, bytes } = await client.download(item.media_id);
      const ext = path.extname(filename || '') || '.mp4';
      const filePath = path.join(req.outputDir, `${req.jobId}${ext.toLowerCase()}`);
      await fs.writeFile(filePath, bytes);
      return { filePath, mediaType: mediaType(filePath), seed: settings.seed };
    } catch (err) {
      if (req.signal.aborted || /cancelled/i.test(String((err as Error)?.message))) throw new CancelledError();
      throw err;
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  async function generateSpawn(req: GenerateRequest): Promise<GenerateResult> {
    const install = wan2gpLocal.resolveInstall({ dir: options.dir, python: options.python });
    const check = wan2gpLocal.checkInstall(install);
    if (!check.ok) throw new Error(check.error);
    const settings = buildSettings(req, req.params.imagePath, req.params.endImagePath);
    const runDir = path.join(req.outputDir, '.runs', req.jobId);
    await fs.mkdir(runDir, { recursive: true });
    const { child, done } = wan2gpLocal.runGeneration({
      install,
      settings,
      runDir,
      onProgress: (e: Parameters<typeof toProgress>[0]) => req.onProgress(toProgress(e)),
    });
    const onAbort = () => wan2gpLocal.killTree(child);
    req.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const produced: string = await done;
      const filePath = path.join(req.outputDir, `${req.jobId}${path.extname(produced).toLowerCase()}`);
      await fs.copyFile(produced, filePath);
      return { filePath, mediaType: mediaType(filePath), seed: settings.seed };
    } catch (err) {
      if (req.signal.aborted) throw new CancelledError();
      throw err;
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  async function statusMcp(models: ModelEntry[]): Promise<Map<string, ModelStatus>> {
    const result = new Map<string, ModelStatus>();
    const client = clientFor();
    try {
      await client.probe();
    } catch (err) {
      clients.clear();
      for (const m of models) result.set(m.id, { status: 'unreachable', detail: `Wan2GP MCP server not reachable: ${(err as Error).message}` });
      return result;
    }
    for (const m of models) {
      try {
        const availability = await client.modelAvailability(m.wan2gp!.modelType);
        if (availability === 'available') result.set(m.id, { status: 'installed' });
        else if (availability === 'unknown-model') result.set(m.id, { status: 'missing', detail: 'This Wan2GP version does not define the model.' });
        else result.set(m.id, { status: 'missing', detail: 'Weights not downloaded yet; Wan2GP downloads them on first use.' });
      } catch (err) {
        result.set(m.id, { status: 'unreachable', detail: (err as Error).message });
      }
    }
    return result;
  }

  async function statusSpawn(models: ModelEntry[]): Promise<Map<string, ModelStatus>> {
    const result = new Map<string, ModelStatus>();
    const install = wan2gpLocal.resolveInstall({ dir: options.dir, python: options.python });
    const check = wan2gpLocal.checkInstall(install);
    if (!check.ok) {
      for (const m of models) result.set(m.id, { status: 'unreachable', detail: check.error });
      return result;
    }
    const local: Map<string, string> = wan2gpLocal.localModelStatus(install, models.map((m) => m.wan2gp!.modelType));
    for (const m of models) {
      const s = local.get(m.wan2gp!.modelType);
      if (s === 'available' || s === 'installed') result.set(m.id, { status: 'installed' });
      else if (s === 'missing') result.set(m.id, { status: 'missing', detail: 'Weights not downloaded yet; Wan2GP downloads them on first use.' });
      else result.set(m.id, { status: 'missing', detail: 'This Wan2GP version does not define the model.' });
    }
    return result;
  }

  return {
    id: 'wan2gp',
    lane: 'gpu',
    generate: (req) => (options.mode === 'spawn' ? generateSpawn(req) : generateMcp(req)),
    status: (models) => (options.mode === 'spawn' ? statusSpawn(models) : statusMcp(models)),
  };
}
