import { z } from 'zod';
import registryJson from '../../models.json';

// Model registry: models.json at the repository root, validated at load time.
// Backend-specific blocks carry only values verified against upstream sources; anything not yet
// verified is listed under `todo` instead of being guessed.

const slug = /^[a-z0-9][a-z0-9._-]*$/;
const resolution = z.string().regex(/^\d{2,5}x\d{2,5}$/);
const aspectRatio = z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']);
const inputMode = z.enum(['none', 'optional', 'required']);

// API-format ComfyUI node reference: node id (as exported by "Save (API)") + input name.
const nodeRef = z.object({
  node: z.string().regex(/^\d+(?::\d+)*$/, 'ComfyUI node ids are numeric strings'),
  input: z.string().min(1).max(100),
});

const wan2gpBlock = z.object({
  // Basename of <Wan2GP>/defaults/<modelType>.json
  modelType: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  // aspect ratio -> WxH. Omit to use the model's own default resolution.
  resolutions: z.partialRecord(aspectRatio, resolution).optional(),
});

// One value may feed several nodes (e.g. the same seed into two samplers).
const nodeRefs = z.union([nodeRef, z.array(nodeRef).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]));

// Path relative to models/comfyui, without .. segments.
const relPath = z.string().regex(/^[A-Za-z0-9._ -]+(\/[A-Za-z0-9._ -]+)*$/).refine((p) => !p.split('/').includes('..'), 'no .. segments');
const comfyuiFileDownload = z.object({
  file: relPath,
  url: z.string().regex(/^https:\/\/huggingface\.co\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/resolve\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/, 'must be a huggingface.co resolve URL'),
});
const comfyuiRepoDownload = z.object({
  dir: relPath,
  repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  revision: z.string().regex(/^[A-Za-z0-9._-]+$/).default('main'),
});

const comfyuiBlock = z.object({
  // File name inside WORKFLOWS_DIR (API format).
  workflow: z.string().regex(/^[A-Za-z0-9._-]+\.json$/),
  inputs: z
    .object({
      prompt: nodeRefs,
      negativePrompt: nodeRefs,
      seed: nodeRefs,
      steps: nodeRefs,
      frames: nodeRefs,
      width: nodeRefs,
      height: nodeRefs,
      image: nodeRefs,
      audio: nodeRefs,
    })
    .partial(),
  // Node whose output media is the result (SaveVideo, VHS_VideoCombine, SaveImage, ...).
  outputNode: z.string().regex(/^\d+(?::\d+)*$/),
  // aspect ratio -> WxH, applied through the width/height inputs.
  resolutions: z.partialRecord(aspectRatio, resolution).optional(),
  // Node class names that must be registered in ComfyUI (custom node packs installed).
  requiredNodes: z.array(z.string().min(1)).default([]),
  // Weight files relative to models/comfyui that must exist.
  requiredFiles: z.array(z.string().regex(/^[A-Za-z0-9._/ -]+$/)).default([]),
  // Where the Models page downloads requiredFiles from: one Hugging Face file, or a whole
  // Hugging Face repository into a folder. Only huggingface.co sources are accepted.
  downloads: z.array(z.union([comfyuiFileDownload, comfyuiRepoDownload])).default([]),
});

const falBlock = z.object({ endpoint: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._/-]+$/) });
const replicateBlock = z.object({
  model: z.string().regex(/^[a-z0-9-]+\/[a-z0-9._-]+$/),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const modelSchema = z
  .object({
    id: z.string().regex(slug).max(80),
    name: z.string().min(1).max(120),
    description: z.string().max(500).default(''),
    family: z.string().regex(slug),
    type: z.enum(['video', 'image']),
    backend: z.enum(['mock', 'wan2gp', 'comfyui', 'fal', 'replicate']),
    experimental: z.boolean().default(false),
    inputs: z.object({ image: inputMode.default('none'), audio: inputMode.default('none') }).default({ image: 'none', audio: 'none' }),
    aspectRatios: z.array(aspectRatio).default([]),
    defaults: z
      .object({ steps: z.number().int().positive().optional(), frames: z.number().int().positive().optional() })
      .default({}),
    wan2gp: wan2gpBlock.optional(),
    comfyui: comfyuiBlock.optional(),
    fal: falBlock.optional(),
    replicate: replicateBlock.optional(),
    // Total bytes of a full download (all files, including ones shared with other models),
    // measured from the real sources (Wan2GP: its default int8 files); shown on the Models page.
    downloadSize: z.number().int().positive().optional(),
    todo: z.array(z.string()).default([]),
  })
  .superRefine((m, ctx) => {
    for (const backend of ['wan2gp', 'comfyui', 'fal', 'replicate'] as const) {
      if (m.backend === backend && !m[backend]) {
        ctx.addIssue({ code: 'custom', message: `backend "${backend}" requires a "${backend}" block`, path: [backend] });
      }
    }
    const resolutions = m.wan2gp?.resolutions ?? m.comfyui?.resolutions;
    if (resolutions) {
      for (const ratio of m.aspectRatios) {
        if (!resolutions[ratio]) {
          ctx.addIssue({ code: 'custom', message: `aspect ratio ${ratio} has no resolution`, path: ['aspectRatios'] });
        }
      }
    }
    for (const d of m.comfyui?.downloads ?? []) {
      const target = 'file' in d ? d.file : d.dir;
      if (!m.comfyui!.requiredFiles.includes(target)) {
        ctx.addIssue({ code: 'custom', message: `download target ${target} is not in requiredFiles`, path: ['comfyui', 'downloads'] });
      }
    }
  });

export const registrySchema = z
  .object({ version: z.literal(1), models: z.array(modelSchema).min(1) })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.models.forEach((m, i) => {
      if (seen.has(m.id)) ctx.addIssue({ code: 'custom', message: `duplicate model id "${m.id}"`, path: ['models', i, 'id'] });
      seen.add(m.id);
    });
  });

export type ModelEntry = z.infer<typeof modelSchema>;
export type Registry = z.infer<typeof registrySchema>;

export function parseRegistry(input: unknown): Registry {
  return registrySchema.parse(input);
}

let cached: Registry | null = null;
export function getRegistry(): Registry {
  cached ??= parseRegistry(registryJson);
  return cached;
}

export function getModel(id: string): ModelEntry | undefined {
  return getRegistry().models.find((m) => m.id === id);
}
