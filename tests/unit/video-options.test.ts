import { describe, expect, it } from 'vitest';
import { applyInputs } from '@/lib/server/adapters/comfyui';
import { validateForModel } from '@/lib/server/jobs';
import { fitFrames, getModel, pickSize } from '@/lib/server/registry';
import fs from 'node:fs';

const model = (id: string) => getModel(id)!;

describe('video options (quality, aspect ratio, duration)', () => {
  it('picks real Wan2GP sizes per quality and ratio, aligned to the model block size', () => {
    expect(pickSize(model('wan-2.2-t2v'))?.size).toBe('832x480');
    expect(pickSize(model('wan-2.2-t2v'), '1080p', '9:16')?.size).toBe('1088x1920');
    expect(pickSize(model('wan-2.2-t2v'), undefined, '9:16')?.size).toBe('480x832');
    // LTX-2.5 uses 64-pixel blocks: 720p 16:9 is 1280x704, its own default.
    expect(pickSize(model('ltx-2.5'))?.size).toBe('1280x704');
    expect(pickSize(model('ltx-2.5'), '480p', '16:9')?.size).toBe('832x448');
    // MiniMax H3 uses 32-pixel blocks.
    expect(pickSize(model('minimax-h3'), '720p', '4:3')?.size).toBe('1088x832');
    // No 4:3 at 1080p in Wan2GP's presets; Hunyuan here is the 480p model.
    expect(pickSize(model('wan-2.2-t2v'), '1080p', '4:3')).toBeNull();
    expect(pickSize(model('hunyuan-video-1.5'), '720p')).toBeNull();
  });

  it('fits durations to each model frame rule like WanGP (rounding up, capped at the maximum)', () => {
    expect(fitFrames(model('wan-2.2-t2v'), 80)).toBe(81); // 4n+1 at 16 fps -> 5 s
    expect(fitFrames(model('ltx-2.5'), 240)).toBe(241); // 8n+1
    expect(fitFrames(model('minimax-h3'), 120)).toBe(124); // 107, 124, 141, ... (17n+5)
    expect(fitFrames(model('minimax-h3'), 10)).toBe(107); // its minimum
    expect(fitFrames(model('hunyuan-video-1.5'), 5000)).toBe(337); // capped
  });

  it('rejects sizes and lengths a model does not support', () => {
    expect(validateForModel({ modelId: 'hunyuan-video-1.5', prompt: 'x', quality: '1080p' }, model('hunyuan-video-1.5'))).toMatch(/no 1080p/);
    expect(validateForModel({ modelId: 'wan-2.2-t2v', prompt: 'x', quality: '1080p', aspectRatio: '4:3' }, model('wan-2.2-t2v'))).toMatch(/choose 720p, 480p/);
    expect(validateForModel({ modelId: 'wan-2.2-t2v', prompt: 'x', frames: 900 }, model('wan-2.2-t2v'))).toMatch(/at most 737 frames/);
    expect(validateForModel({ modelId: 'wan-2.2-t2v', prompt: 'x', quality: '720p', aspectRatio: '1:1', frames: 161 }, model('wan-2.2-t2v'))).toBeNull();
  });

  it('sets Cosmos3 size and its resolution-dependent flow shift in the workflow', () => {
    const wf = applyInputs(JSON.parse(fs.readFileSync('workflows/cosmos3-super.json', 'utf8')), model('cosmos3-super'),
      { prompt: 'a robot', resolution: '1280x720', flowShift: 10, frames: 161 }, { image: 'a.png' }, 1);
    expect(wf['2'].inputs).toMatchObject({ width: 1280, height: 720, num_frames: 161 });
    expect(wf['9'].inputs.flow_shift).toBe(10);
    // Defaults: 480p with flow shift 5.
    const def = applyInputs(JSON.parse(fs.readFileSync('workflows/cosmos3-super.json', 'utf8')), model('cosmos3-super'), { prompt: 'x' }, { image: 'a.png' }, 1);
    expect(def['15'].inputs).toMatchObject({ width: 832, height: 480 });
    expect(def['9'].inputs.flow_shift).toBe(5);
  });
});
