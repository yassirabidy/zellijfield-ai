import type { ModelEntry } from '../registry';

export interface GenerationParams {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  steps?: number;
  frames?: number;
  // WxH chosen from the model's video.sizes (quality + aspect ratio).
  resolution?: string;
  // Resolution-dependent scheduler shift (ComfyUI Cosmos3).
  flowShift?: number;
  // Absolute paths on the studio's disk, resolved server-side from upload ids.
  imagePath?: string;
  // Last frame (models with inputs.endImage).
  endImagePath?: string;
  audioPath?: string;
}

export interface ProgressEvent {
  // 0..1
  progress: number;
  status: string;
  message?: string;
}

export interface GenerateRequest {
  jobId: string;
  model: ModelEntry;
  params: GenerationParams;
  // Directory the adapter must write its result into (created by the caller).
  outputDir: string;
  signal: AbortSignal;
  onProgress: (event: ProgressEvent) => void;
}

export interface GenerateResult {
  // Absolute path of the media file inside outputDir.
  filePath: string;
  mediaType: 'video' | 'image';
  seed?: number;
}

// installed: ready to run · missing: backend reachable but weights/workflow absent ·
// unreachable: backend not responding · needs-key: cloud backend without an API key
export type ModelAvailability = 'installed' | 'missing' | 'unreachable' | 'needs-key';

export interface ModelStatus {
  status: ModelAvailability;
  detail?: string;
}

export interface Adapter {
  readonly id: ModelEntry['backend'];
  // Jobs on a GPU lane run one at a time.
  readonly lane: 'gpu' | 'cloud';
  generate(req: GenerateRequest): Promise<GenerateResult>;
  status(models: ModelEntry[]): Promise<Map<string, ModelStatus>>;
}

export class CancelledError extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'CancelledError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}

// Resolves after `ms`, rejecting early with CancelledError when the signal aborts.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
