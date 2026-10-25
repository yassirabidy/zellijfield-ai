import fs from 'node:fs';
import path from 'node:path';
import type { Job } from './jobs';

// Gallery = every media file under OUTPUTS_DIR/studio (where all backends' results are saved),
// enriched with the job that produced it when there is one.

const MEDIA = /\.(mp4|webm|mov|mkv|png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|mov|mkv)$/i;

export interface GalleryItem {
  id: string;
  url: string;
  mediaType: 'video' | 'image';
  modelId: string | null;
  prompt: string | null;
  createdAt: number;
}

export function mediaUrl(relPath: string): string {
  return `/api/media/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}

export function listGallery(outputsDir: string, jobs: Job[], limit = 200): GalleryItem[] {
  const dir = path.join(outputsDir, 'studio');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => MEDIA.test(f));
  } catch {
    return [];
  }
  const byPath = new Map(jobs.filter((j) => j.outputPath).map((j) => [j.outputPath!, j]));
  const items: GalleryItem[] = files.map((file) => {
    const rel = `studio/${file}`;
    const job = byPath.get(rel);
    let createdAt = job?.createdAt ?? 0;
    if (!createdAt) {
      try { createdAt = fs.statSync(path.join(dir, file)).mtimeMs; } catch { /* removed meanwhile */ }
    }
    return {
      id: job?.id ?? file,
      url: mediaUrl(rel),
      mediaType: VIDEO.test(file) ? 'video' : 'image',
      modelId: job?.modelId ?? null,
      prompt: job?.params.prompt ?? null,
      createdAt,
    };
  });
  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// Resolves a URL path below OUTPUTS_DIR, refusing anything that escapes it.
export function resolveMediaPath(outputsDir: string, segments: string[]): string | null {
  if (segments.length === 0 || segments.some((s) => !s || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null;
  const root = path.resolve(outputsDir);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!MEDIA.test(full)) return null;
  return full;
}
