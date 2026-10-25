import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelEntry } from '../registry';
import type { Adapter, GenerateRequest, GenerateResult, ModelStatus } from './types';
import { sleep, throwIfAborted } from './types';

// Mock backend: walks through the same progress phases as a real engine, then copies a bundled
// sample clip into the output folder. Default backend, so the studio works with no GPU or keys.

export const MOCK_PHASES = [
  { status: 'loading', message: 'Loading model (simulated)' },
  { status: 'encoding', message: 'Encoding prompt' },
  { status: 'generating', message: 'Denoising' },
  { status: 'decoding', message: 'Decoding frames' },
  { status: 'saving', message: 'Saving video' },
] as const;

const GENERATE_STEPS = 10;

export interface MockAdapterOptions {
  samplePath?: string;
  stepMs?: number;
}

export function createMockAdapter(options: MockAdapterOptions = {}): Adapter {
  const samplePath = options.samplePath ?? path.join(process.cwd(), 'public', 'samples', 'mock-clip.mp4');
  const stepMs = options.stepMs ?? 400;

  return {
    id: 'mock',
    lane: 'gpu',

    async generate({ jobId, params, outputDir, signal, onProgress }: GenerateRequest): Promise<GenerateResult> {
      const totalSteps = 3 + GENERATE_STEPS + 2;
      let done = 0;
      const tick = async (status: string, message: string) => {
        throwIfAborted(signal);
        onProgress({ progress: done / totalSteps, status, message });
        await sleep(stepMs, signal);
        done += 1;
      };

      await tick(MOCK_PHASES[0].status, MOCK_PHASES[0].message);
      await tick(MOCK_PHASES[1].status, MOCK_PHASES[1].message);
      await tick(MOCK_PHASES[1].status, `Prompt: ${params.prompt.slice(0, 60)}`);
      for (let step = 1; step <= GENERATE_STEPS; step++) {
        await tick(MOCK_PHASES[2].status, `${MOCK_PHASES[2].message} — step ${step}/${GENERATE_STEPS}`);
      }
      await tick(MOCK_PHASES[3].status, MOCK_PHASES[3].message);
      await tick(MOCK_PHASES[4].status, MOCK_PHASES[4].message);

      throwIfAborted(signal);
      const filePath = path.join(outputDir, `${jobId}.mp4`);
      await fs.copyFile(samplePath, filePath);
      onProgress({ progress: 1, status: 'done' });
      return { filePath, mediaType: 'video', seed: params.seed ?? 42 };
    },

    async status(models: ModelEntry[]): Promise<Map<string, ModelStatus>> {
      const present = await fs.access(samplePath).then(() => true, () => false);
      const status: ModelStatus = present ? { status: 'installed' } : { status: 'missing', detail: `Sample clip not found: ${samplePath}` };
      return new Map(models.map((m) => [m.id, status]));
    },
  };
}
