// Browser-side client for the Zellijfield AI API routes. Types mirror lib/server (kept separate so
// no server module is ever bundled into the browser).

export type Availability = 'installed' | 'missing' | 'unreachable' | 'needs-key';
export type InputMode = 'none' | 'optional' | 'required';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type Quality = '480p' | '540p' | '720p' | '1080p';

export interface VideoOptions {
  fps: number;
  frames: { min: number; step: number; offset: number; max: number };
  sizes: Array<{ quality: Quality; ratio: string; size: string; flowShift?: number }>;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  family: string;
  type: 'video' | 'image';
  backend: 'mock' | 'wan2gp' | 'comfyui' | 'fal' | 'replicate';
  experimental: boolean;
  // image = start frame, endImage = last frame.
  inputs: { image: InputMode; endImage: InputMode; audio: InputMode };
  aspectRatios: string[];
  defaults: { steps?: number; frames?: number };
  todo: string[];
  // Bytes of a full download (Models page).
  downloadSize?: number;
  // Supported output sizes and lengths (first size = default).
  video?: VideoOptions;
  availability: { status: Availability; detail?: string };
}

// Backends that run on this PC; the Local dashboard shows only these.
export const LOCAL_BACKENDS: ReadonlyArray<ModelInfo['backend']> = ['mock', 'wan2gp', 'comfyui'];

export interface JobInput {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  quality?: Quality;
  seed?: number;
  steps?: number;
  frames?: number;
  imageUploadId?: string;
  endImageUploadId?: string;
  audioUploadId?: string;
}

export interface Job {
  id: string;
  modelId: string;
  backend: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  params: JobInput;
  outputPath: string | null;
  mediaType: 'video' | 'image' | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GalleryItem {
  id: string;
  url: string;
  mediaType: 'video' | 'image';
  modelId: string | null;
  prompt: string | null;
  createdAt: number;
}

export interface PublicSettings {
  wan2gpUrl: string;
  comfyuiUrl: string;
  defaultBackend: string;
  keys: { muapi: boolean; fal: boolean; replicate: boolean };
}

export type DownloadStatus = 'waiting-engine' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';

export interface DownloadState {
  modelId: string;
  status: DownloadStatus;
  file?: string | null;
  fileIndex?: number | null;
  fileCount?: number | null;
  completed?: number | null;
  total?: number | null;
  received?: number | null;
  error?: string | null;
}

export interface ModelDownloadInfo {
  modelId: string;
  backend: 'wan2gp' | 'comfyui';
  downloadable: boolean;
  download: DownloadState | null;
  files?: { present: number; total: number; bytes: number; partialBytes: number };
}

export type EngineId = 'wan2gp' | 'comfyui';
export type EngineAction = 'install' | 'start' | 'stop' | 'delete';
export type EngineRequest = EngineAction | 'cancel';

export interface EngineState {
  id: EngineId;
  name: string;
  sizeEstimate: string;
  installed: boolean;
  sizeLabel: string | null;
  sizeBytes: number | null;
  container: string;
  health: string;
  ready: boolean;
  busy: boolean;
  op: { action: EngineAction; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; progress: number; message: string | null; error: string | null; startedAt: number | null; finishedAt: number | null } | null;
}

export interface EnginesSnapshot {
  managerOnline: boolean;
  dockerOk: boolean;
  engines: EngineState[];
}

export interface RemoveResult {
  removed: string[];
  keptShared: string[];
  bytesFreed: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = Array.isArray(body.issues) ? body.issues : undefined;
    const detail = issues?.map((i: { path: string; message: string }) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
    throw new ApiError(detail || body.error || `Request failed (${res.status})`, res.status, issues);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  models: () => request<{ models: ModelInfo[] }>('/api/models').then((r) => r.models),
  // Registry only, without live status checks (instant).
  registry: () => request<{ models: Omit<ModelInfo, 'availability'>[] }>('/api/models?status=0').then((r) => r.models),
  settings: () => request<PublicSettings>('/api/settings'),
  // wan2gpUrl / comfyuiUrl: null resets to the server default.
  saveSettings: (update: { wan2gpUrl?: string | null; comfyuiUrl?: string | null; defaultBackend?: string; keys?: Partial<Record<keyof PublicSettings['keys'], string>> }) =>
    request<PublicSettings>('/api/settings', json('PUT', update)),
  submitJob: (input: JobInput) => request<{ job: Job }>('/api/jobs', json('POST', input)).then((r) => r.job),
  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  jobs: (limit = 20) => request<{ jobs: Job[] }>(`/api/jobs?limit=${limit}`).then((r) => r.jobs),
  downloads: () => request<{ models: ModelDownloadInfo[] }>('/api/downloads').then((r) => r.models),
  startDownload: (modelId: string) => request<{ started: boolean }>(`/api/models/${encodeURIComponent(modelId)}/download`, { method: 'POST' }),
  cancelDownload: (modelId: string) => request<{ cancelled: boolean }>(`/api/models/${encodeURIComponent(modelId)}/download`, { method: 'DELETE' }),
  removeModel: (modelId: string) => request<RemoveResult>(`/api/models/${encodeURIComponent(modelId)}/files`, { method: 'DELETE' }),
  engines: () => request<EnginesSnapshot>('/api/engines'),
  engineAction: (id: EngineId, action: EngineRequest) => request<{ requested: boolean }>(`/api/engines/${id}`, json('POST', { action })),
  gallery: () => request<{ items: GalleryItem[] }>('/api/gallery').then((r) => r.items),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ id: string; kind: 'image' | 'audio' }>('/api/uploads', { method: 'POST', body: form });
  },
};

export const TERMINAL: JobStatus[] = ['succeeded', 'failed', 'cancelled'];

// Follows a job over Server-Sent Events until it finishes. Returns a function that stops listening.
export function watchJob(id: string, onUpdate: (job: Job) => void): () => void {
  const source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  source.addEventListener('job', (event) => {
    const job = JSON.parse((event as MessageEvent).data) as Job;
    onUpdate(job);
    if (TERMINAL.includes(job.status)) source.close();
  });
  return () => source.close();
}

export function mediaUrl(outputPath: string): string {
  return `/api/media/${outputPath.split('/').map(encodeURIComponent).join('/')}`;
}
