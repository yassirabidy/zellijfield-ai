import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ClientError } from './http';

// Start frames / voice clips for local generation. Stored under DATA_DIR/uploads/<uuid>.<ext>;
// jobs refer to them only by id, so clients never supply file paths.

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const KINDS = {
  'image/png': { ext: '.png', kind: 'image' },
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'audio/mpeg': { ext: '.mp3', kind: 'audio' },
  'audio/wav': { ext: '.wav', kind: 'audio' },
  'audio/x-wav': { ext: '.wav', kind: 'audio' },
  'audio/mp4': { ext: '.m4a', kind: 'audio' },
  'audio/x-m4a': { ext: '.m4a', kind: 'audio' },
} as const;

type Mime = keyof typeof KINDS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Magic-byte check so a renamed file cannot pass as an image/audio.
export function sniffMime(bytes: Uint8Array): Mime | null {
  const b = bytes;
  const ascii = (start: number, s: string) => s.split('').every((c, i) => b[start + i] === c.charCodeAt(0));
  if (b[0] === 0x89 && ascii(1, 'PNG')) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(4, 'ftyp') && (ascii(8, 'M4A') || ascii(8, 'mp42') || ascii(8, 'isom'))) return 'audio/mp4';
  return null;
}

export interface SavedUpload {
  id: string;
  kind: 'image' | 'audio';
  bytes: number;
}

export class UploadError extends ClientError {}

export function saveUpload(uploadsDir: string, bytes: Uint8Array): SavedUpload {
  if (bytes.byteLength === 0) throw new UploadError('The file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError('The file is larger than 50 MB.');
  const mime = sniffMime(bytes);
  if (!mime) throw new UploadError('Unsupported file type. Use PNG, JPEG or WebP images, or MP3, WAV or M4A audio.');
  const { ext, kind } = KINDS[mime];
  const id = crypto.randomUUID();
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, `${id}${ext}`), bytes);
  return { id, kind, bytes: bytes.byteLength };
}

export function resolveUpload(uploadsDir: string, id: string): string | null {
  if (!UUID.test(id)) return null;
  const exts = [...new Set(Object.values(KINDS).map((k) => k.ext))];
  for (const ext of exts) {
    const file = path.join(uploadsDir, `${id}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}
