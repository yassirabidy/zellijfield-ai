import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelEntry } from '../registry';
import { pickSize } from '../registry';
import type { Adapter, GenerateRequest, GenerateResult, GenerationParams, ModelStatus } from './types';
import { CancelledError, sleep, throwIfAborted } from './types';

// ComfyUI backend: API-format workflow from WORKFLOWS_DIR, inputs mapped onto node ids declared in
// models.json, POST /prompt, progress over /ws, result from /history + /view.

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;
type ComfyBlock = NonNullable<ModelEntry['comfyui']>;

export interface ComfyuiAdapterOptions {
  getUrl: () => string;
  workflowsDir: string;
  // Folder mirrored from ComfyUI's models/ (used for "installed / not found" checks).
  modelsDir: string;
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  pollMs?: number;
}

export interface UploadedNames {
  image?: string;
  audio?: string;
}

const MEDIA_EXTENSIONS = /\.(mp4|webm|mov|mkv|gif|webp|png|jpe?g)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv)$/i;

function setInput(wf: Workflow, block: ComfyBlock, key: keyof ComfyBlock['inputs'], value: unknown): void {
  const refs = block.inputs[key];
  if (!refs || value === undefined) return;
  for (const ref of refs) {
    const node = wf[ref.node];
    if (!node) throw new Error(`Workflow ${block.workflow} has no node ${ref.node} (mapped from "${key}")`);
    node.inputs[ref.input] = value;
  }
}

// Returns a copy of the workflow with the user's values written into the mapped node inputs.
export function applyInputs(
  workflow: Workflow,
  model: ModelEntry,
  params: GenerationParams,
  uploaded: UploadedNames,
  seed: number,
): Workflow {
  const block = model.comfyui;
  if (!block) throw new Error(`${model.id} has no comfyui block`);
  const wf: Workflow = structuredClone(workflow);
  setInput(wf, block, 'prompt', params.prompt);
  setInput(wf, block, 'negativePrompt', params.negativePrompt);
  setInput(wf, block, 'seed', seed);
  setInput(wf, block, 'steps', params.steps ?? model.defaults.steps);
  setInput(wf, block, 'frames', params.frames ?? model.defaults.frames);
  const ratio = params.aspectRatio ?? model.aspectRatios[0];
  const option = pickSize(model, undefined, ratio);
  const size = params.resolution ?? option?.size ?? (ratio ? block.resolutions?.[ratio as keyof typeof block.resolutions] : undefined);
  if (size) {
    const [w, h] = size.split('x').map(Number);
    setInput(wf, block, 'width', w);
    setInput(wf, block, 'height', h);
  }
  setInput(wf, block, 'flowShift', params.flowShift ?? option?.flowShift);
  setInput(wf, block, 'image', uploaded.image);
  setInput(wf, block, 'audio', uploaded.audio);
  return wf;
}

interface HistoryFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

// Finds the first media file among a node's outputs (images / gifs / videos / audio arrays).
export function pickOutputFile(nodeOutput: Record<string, unknown> | undefined): HistoryFile | null {
  if (!nodeOutput) return null;
  for (const value of Object.values(nodeOutput)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object' && typeof (item as HistoryFile).filename === 'string' && MEDIA_EXTENSIONS.test((item as HistoryFile).filename)) {
        return item as HistoryFile;
      }
    }
  }
  return null;
}

export function createComfyuiAdapter(options: ComfyuiAdapterOptions): Adapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 2000;
  const base = () => options.getUrl().replace(/\/+$/, '');

  async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${base()}${pathname}`, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`ComfyUI ${init?.method ?? 'GET'} ${pathname} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function upload(filePath: string): Promise<string> {
    const form = new FormData();
    const bytes = await fs.readFile(filePath);
    form.append('image', new Blob([bytes]), `zf-${crypto.randomUUID()}${path.extname(filePath).toLowerCase()}`);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const r = await api<{ name: string; subfolder?: string }>('/upload/image', { method: 'POST', body: form });
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  }

  async function loadWorkflow(block: ComfyBlock): Promise<Workflow> {
    const file = path.join(options.workflowsDir, block.workflow);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as Workflow;
    } catch (err) {
      throw new Error(`Cannot read ComfyUI workflow ${file}: ${(err as Error).message}`);
    }
  }

  // Waits for the prompt to finish, reporting progress. Uses the websocket when available and
  // falls back to polling /history.
  async function waitForPrompt(promptId: string, clientId: string, totalNodes: number, req: GenerateRequest): Promise<void> {
    const WS = options.webSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    let finished = false;
    let failure: Error | null = null;
    let executed = 0;
    let ws: WebSocket | null = null;

    if (WS) {
      try {
        ws = new WS(`${base().replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`);
        ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data !== 'string') return; // binary preview frames
          let msg: { type?: string; data?: Record<string, unknown> };
          try { msg = JSON.parse(event.data); } catch { return; }
          const data = msg.data ?? {};
          if (data.prompt_id && data.prompt_id !== promptId) return;
          if (msg.type === 'progress') {
            const value = Number(data.value) || 0;
            const max = Number(data.max) || 1;
            req.onProgress({
              progress: Math.min(0.98, (executed + value / max) / Math.max(1, totalNodes)),
              status: 'generating',
              message: `step ${value}/${max}`,
            });
          } else if (msg.type === 'executing') {
            if (data.node === null) finished = true;
            else executed += 1;
          } else if (msg.type === 'execution_success') {
            finished = true;
          } else if (msg.type === 'execution_error') {
            failure = new Error(`ComfyUI error in node ${data.node_id} (${data.node_type}): ${data.exception_message}`);
          } else if (msg.type === 'execution_interrupted') {
            failure = new CancelledError();
          }
        };
      } catch {
        ws = null;
      }
    }

    try {
      while (!finished && !failure) {
        await sleep(pollMs, req.signal);
        const history = await api<Record<string, { status?: { completed?: boolean; status_str?: string; messages?: unknown[] } }>>(`/history/${promptId}`);
        const entry = history[promptId];
        if (entry?.status?.completed) finished = true;
        else if (entry?.status?.status_str === 'error') failure = new Error(`ComfyUI reported an error: ${JSON.stringify(entry.status.messages ?? []).slice(0, 500)}`);
      }
      if (failure) throw failure;
    } finally {
      ws?.close();
    }
  }

  async function generate(req: GenerateRequest): Promise<GenerateResult> {
    const block = req.model.comfyui;
    if (!block) throw new Error(`${req.model.id} has no comfyui block`);
    const clientId = crypto.randomUUID();
    let promptId: string | null = null;
    const onAbort = () => {
      api('/interrupt', { method: 'POST' }).catch(() => {});
      if (promptId) api('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    try {
      req.onProgress({ progress: 0, status: 'starting', message: 'Preparing ComfyUI workflow' });
      const workflow = await loadWorkflow(block);
      const uploaded: UploadedNames = {};
      if (req.params.imagePath) uploaded.image = await upload(req.params.imagePath);
      if (req.params.audioPath) uploaded.audio = await upload(req.params.audioPath);
      throwIfAborted(req.signal);
      const seed = req.params.seed ?? crypto.randomInt(0, 2 ** 31);
      const prompt = applyInputs(workflow, req.model, req.params, uploaded, seed);

      const queued = await api<{ prompt_id?: string; error?: unknown; node_errors?: unknown }>('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: clientId }),
      });
      if (!queued.prompt_id) throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(queued.node_errors ?? queued.error).slice(0, 500)}`);
      promptId = queued.prompt_id;
      req.onProgress({ progress: 0.01, status: 'queued', message: 'Queued in ComfyUI' });

      await waitForPrompt(promptId, clientId, Object.keys(prompt).length, req);
      throwIfAborted(req.signal);

      const history = await api<Record<string, { outputs?: Record<string, Record<string, unknown>> }>>(`/history/${promptId}`);
      const file = pickOutputFile(history[promptId]?.outputs?.[block.outputNode]);
      if (!file) throw new Error(`ComfyUI finished but node ${block.outputNode} produced no media file`);

      req.onProgress({ progress: 0.99, status: 'saving', message: 'Downloading result' });
      const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
      const res = await fetchImpl(`${base()}/view?${query}`);
      if (!res.ok) throw new Error(`ComfyUI /view failed: HTTP ${res.status}`);
      const ext = path.extname(file.filename).toLowerCase();
      const filePath = path.join(req.outputDir, `${req.jobId}${ext}`);
      await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
      return { filePath, mediaType: VIDEO_EXTENSIONS.test(ext) ? 'video' : 'image', seed };
    } catch (err) {
      if (req.signal.aborted) throw new CancelledError();
      throw err;
    } finally {
      req.signal.removeEventListener('abort', onAbort);
    }
  }

  async function status(models: ModelEntry[]): Promise<Map<string, ModelStatus>> {
    const result = new Map<string, ModelStatus>();
    try {
      await api('/system_stats');
    } catch (err) {
      for (const m of models) result.set(m.id, { status: 'unreachable', detail: `ComfyUI not reachable: ${(err as Error).message}` });
      return result;
    }
    const nodeCache = new Map<string, boolean>();
    const hasNode = async (cls: string) => {
      if (!nodeCache.has(cls)) {
        const info = await api<Record<string, unknown>>(`/object_info/${encodeURIComponent(cls)}`).catch(() => ({}));
        nodeCache.set(cls, cls in info);
      }
      return nodeCache.get(cls)!;
    };
    for (const m of models) {
      const block = m.comfyui!;
      const problems: string[] = [];
      const workflowOk = await fs.access(path.join(options.workflowsDir, block.workflow)).then(() => true, () => false);
      if (!workflowOk) problems.push(`workflow ${block.workflow} not found`);
      for (const cls of block.requiredNodes) if (!(await hasNode(cls))) problems.push(`node ${cls} not installed`);
      for (const rel of block.requiredFiles) {
        const ok = await fs.access(path.join(options.modelsDir, rel)).then(() => true, () => false);
        if (!ok) problems.push(`models/comfyui/${rel} missing`);
      }
      result.set(m.id, problems.length ? { status: 'missing', detail: problems.join('; ') } : { status: 'installed' });
    }
    return result;
  }

  return { id: 'comfyui', lane: 'gpu', generate, status };
}
