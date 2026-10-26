import type { ModelInfo, Quality, VideoOptions } from './api';

// Quality / aspect ratio / duration choices for the Local prompt bar, from a model's video options
// (models.json). Frame counts are fitted like WanGP does (rounded up to the model's frame steps),
// mirroring fitFrames in lib/server/registry.ts.

export const QUALITY_ORDER: Quality[] = ['1080p', '720p', '540p', '480p'];

export function fitFrames(video: VideoOptions, frames: number): number {
  const { min, step, offset, max } = video.frames;
  let fitted = Math.ceil(Math.max(0, Math.max(min, frames) - offset) / step) * step + offset;
  while (fitted > max && fitted - step >= min) fitted -= step;
  return fitted;
}

export function qualities(model: ModelInfo): Quality[] {
  const present = new Set(model.video?.sizes.map((o) => o.quality));
  return QUALITY_ORDER.filter((q) => present.has(q));
}

export function ratiosFor(model: ModelInfo, quality: Quality | null): string[] {
  if (!model.video) return model.aspectRatios;
  return model.video.sizes.filter((o) => !quality || o.quality === quality).map((o) => o.ratio);
}

export function sizeFor(model: ModelInfo, quality: Quality | null, ratio: string): string | null {
  return model.video?.sizes.find((o) => o.quality === quality && o.ratio === ratio)?.size ?? null;
}

const SECONDS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 45];

// Duration presets within the model's range, one per distinct frame count.
export function durationOptions(model: ModelInfo): Array<{ frames: number; seconds: number }> {
  const video = model.video;
  if (!video) return [];
  const seen = new Set<number>();
  const options: Array<{ frames: number; seconds: number }> = [];
  for (const s of SECONDS) {
    const frames = fitFrames(video, Math.round(s * video.fps));
    if (frames / video.fps < s - video.frames.step / video.fps || seen.has(frames)) continue;
    seen.add(frames);
    options.push({ frames, seconds: frames / video.fps });
  }
  return options;
}

export function formatSeconds(seconds: number): string {
  return `${Number.isInteger(Math.round(seconds * 10) / 10) ? Math.round(seconds) : seconds.toFixed(1)} s`;
}
