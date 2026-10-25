import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelEntry } from '../registry';
import type { Adapter, GenerateRequest, GenerateResult, GenerationParams, ModelStatus } from './types';
import { CancelledError, sleep, throwIfAborted } from './types';

// Optional cloud backends using the user's own keys (stored server-side, see settings.ts).
// fal: queue API (queue.fal.run). Replicate: predictions API. Inputs use the common field names
// (prompt, negative_prompt, seed, aspect_ratio, image); models with other schemas need their own
// mapping before being added to models.json.

export interface CloudAdapterOptions {
  getKey: () => string | null;
  fetchImpl?: typeof fetch;
  pollMs?: number;
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

async function dataUri(filePath: string): Promise<string> {
  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${(await fs.readFile(filePath)).toString('base64')}`;
}

async function commonInput(p: GenerationParams, imageField: string): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = { prompt: p.prompt };
  if (p.negativePrompt) input.negative_prompt = p.negativePrompt;
  if (p.seed !== undefined) input.seed = p.seed;
  if (p.aspectRatio) input.aspect_ratio = p.aspectRatio;
  if (p.imagePath) input[imageField] = await dataUri(p.imagePath);
  return input;
}

// First https URL found in a result payload (string, array, or { url } objects).
export function findOutputUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') return /^https:\/\//.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const u = findOutputUrl(v, depth + 1);
      if (u) return u;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['url', 'video', 'videos', 'output', 'images', 'image']) {
      if (key in obj) {
        const u = findOutputUrl(obj[key], depth + 1);
        if (u) return u;
      }
    }
    for (const v of Object.values(obj)) {
      const u = findOutputUrl(v, depth + 1);
      if (u) return u;
    }
  }
  return null;
}

async function download(fetchImpl: typeof fetch, url: string, req: GenerateRequest): Promise<GenerateResult> {
  const res = await fetchImpl(url, { signal: req.signal });
  if (!res.ok) throw new Error(`Downloading the result failed: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  const ext = urlExt || (type.includes('video') ? '.mp4' : type.includes('png') ? '.png' : '.jpg');
  const filePath = path.join(req.outputDir, `${req.jobId}${ext}`);
  await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  const mediaType = type.startsWith('video') || /\.(mp4|webm|mov)$/.test(ext) ? 'video' : 'image';
  return { filePath, mediaType, seed: req.params.seed };
}

function keyStatus(models: ModelEntry[], hasKey: boolean, name: string): Map<string, ModelStatus> {
  const s: ModelStatus = hasKey ? { status: 'installed' } : { status: 'needs-key', detail: `Add your ${name} API key in Settings.` };
  return new Map(models.map((m) => [m.id, s]));
}

export function createFalAdapter(options: CloudAdapterOptions): Adapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 2000;
  return {
    id: 'fal',
    lane: 'cloud',
    async generate(req) {
      const key = options.getKey();
      if (!key) throw new Error('No fal API key configured — add it in Settings.');
      const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
      const endpoint = req.model.fal!.endpoint;
      const submit = await fetchImpl(`https://queue.fal.run/${endpoint}`, {
        method: 'POST', headers, body: JSON.stringify(await commonInput(req.params, 'image_url')), signal: req.signal,
      });
      if (!submit.ok) throw new Error(`fal rejected the request: HTTP ${submit.status} ${(await submit.text()).slice(0, 300)}`);
      const queued = (await submit.json()) as { status_url: string; response_url: string; cancel_url?: string };
      const onAbort = () => {
        if (queued.cancel_url) fetchImpl(queued.cancel_url, { method: 'PUT', headers }).catch(() => {});
      };
      req.signal.addEventListener('abort', onAbort, { once: true });
      try {
        req.onProgress({ progress: 0.05, status: 'queued', message: 'Queued at fal' });
        for (;;) {
          await sleep(pollMs, req.signal);
          const s = await fetchImpl(queued.status_url, { headers });
          const body = (await s.json()) as { status?: string; queue_position?: number };
          if (body.status === 'COMPLETED') break;
          if (body.status === 'IN_QUEUE') req.onProgress({ progress: 0.05, status: 'queued', message: `Queue position ${body.queue_position ?? '?'}` });
          else if (body.status === 'IN_PROGRESS') req.onProgress({ progress: 0.5, status: 'generating', message: 'Generating at fal' });
          else throw new Error(`fal returned status ${body.status ?? s.status}`);
        }
        const r = await fetchImpl(queued.response_url, { headers });
        if (!r.ok) throw new Error(`fal result failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
        const url = findOutputUrl(await r.json());
        if (!url) throw new Error('fal finished without a media URL');
        throwIfAborted(req.signal);
        return await download(fetchImpl, url, req);
      } catch (err) {
        if (req.signal.aborted) throw new CancelledError();
        throw err;
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    },
    async status(models) {
      return keyStatus(models, Boolean(options.getKey()), 'fal');
    },
  };
}

export function createReplicateAdapter(options: CloudAdapterOptions): Adapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 2000;
  return {
    id: 'replicate',
    lane: 'cloud',
    async generate(req) {
      const key = options.getKey();
      if (!key) throw new Error('No Replicate API token configured — add it in Settings.');
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      const { model, version } = req.model.replicate!;
      const input = await commonInput(req.params, 'image');
      const url = version ? 'https://api.replicate.com/v1/predictions' : `https://api.replicate.com/v1/models/${model}/predictions`;
      const submit = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(version ? { version, input } : { input }), signal: req.signal });
      if (!submit.ok) throw new Error(`Replicate rejected the request: HTTP ${submit.status} ${(await submit.text()).slice(0, 300)}`);
      let prediction = (await submit.json()) as { status: string; output?: unknown; error?: string; urls: { get: string; cancel: string } };
      const onAbort = () => {
        fetchImpl(prediction.urls.cancel, { method: 'POST', headers }).catch(() => {});
      };
      req.signal.addEventListener('abort', onAbort, { once: true });
      try {
        while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
          req.onProgress({
            progress: prediction.status === 'processing' ? 0.5 : 0.05,
            status: prediction.status === 'processing' ? 'generating' : 'queued',
            message: `Replicate: ${prediction.status}`,
          });
          await sleep(pollMs, req.signal);
          prediction = (await (await fetchImpl(prediction.urls.get, { headers })).json()) as typeof prediction;
        }
        if (prediction.status === 'canceled') throw new CancelledError();
        if (prediction.status === 'failed') throw new Error(`Replicate prediction failed: ${prediction.error ?? 'unknown error'}`);
        const out = findOutputUrl(prediction.output);
        if (!out) throw new Error('Replicate finished without a media URL');
        return await download(fetchImpl, out, req);
      } catch (err) {
        if (req.signal.aborted) throw new CancelledError();
        throw err;
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    },
    async status(models) {
      return keyStatus(models, Boolean(options.getKey()), 'Replicate');
    },
  };
}
