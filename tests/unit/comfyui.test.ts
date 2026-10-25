import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyInputs, pickOutputFile } from '@/lib/server/adapters/comfyui';
import { findOutputUrl } from '@/lib/server/adapters/cloud';
import { getModel } from '@/lib/server/registry';

const load = (f: string) => JSON.parse(fs.readFileSync(`workflows/${f}`, 'utf8'));

describe('ComfyUI input mapping', () => {
  it('writes prompt, seed, size and uploads into the Cosmos3 workflow', () => {
    const model = getModel('cosmos3-super')!;
    const original = load('cosmos3-super.json');
    const wf = applyInputs(original, model, { prompt: 'a robot waves', aspectRatio: '16:9', steps: 20 }, { image: 'zf-start.png' }, 1234);
    expect(wf['2'].inputs.prompt).toBe('a robot waves');
    expect(wf['7'].inputs.noise_seed).toBe(1234);
    expect(wf['9'].inputs.steps).toBe(20);
    expect(wf['14'].inputs.image).toBe('zf-start.png');
    for (const id of ['2', '4']) {
      expect(wf[id].inputs.width).toBe(832);
      expect(wf[id].inputs.height).toBe(480);
      expect(wf[id].inputs.num_frames).toBe(93);
    }
    expect(wf['15'].inputs.length).toBe(93);
    // Negative prompt stays wired to the default-negative node.
    expect(wf['4'].inputs.prompt).toEqual(['3', 0]);
    // The source workflow is not mutated.
    expect(original['2'].inputs.prompt).not.toBe('a robot waves');
  });

  it('feeds one seed into both SkyReels samplers and maps image + audio', () => {
    const model = getModel('skyreels-v3')!;
    const wf = applyInputs(load('skyreels-v3.json'), model, { prompt: 'a news anchor speaks' }, { image: 'face.png', audio: 'voice.wav' }, 99);
    expect(wf['241'].inputs.positive_prompt).toBe('a news anchor speaks');
    expect(wf['317'].inputs.seed).toBe(99);
    expect(wf['320'].inputs.seed).toBe(99);
    expect(wf['284'].inputs.image).toBe('face.png');
    expect(wf['125'].inputs.audio).toBe('voice.wav');
    expect(wf['131'].inputs.save_output).toBe(true);
  });

  it('picks the media file from VHS and core output shapes', () => {
    expect(pickOutputFile({ gifs: [{ filename: 'out_00001.mp4', subfolder: '', type: 'output' }] })?.filename).toBe('out_00001.mp4');
    expect(pickOutputFile({ images: [{ filename: 'v.mp4', type: 'output' }], animated: [true] })?.filename).toBe('v.mp4');
    expect(pickOutputFile({ text: ['hello'] })).toBeNull();
    expect(pickOutputFile(undefined)).toBeNull();
  });
});

describe('cloud output parsing', () => {
  it('finds the first https media URL in common payload shapes', () => {
    expect(findOutputUrl({ video: { url: 'https://cdn.example/v.mp4' } })).toBe('https://cdn.example/v.mp4');
    expect(findOutputUrl(['https://r.example/a.mp4'])).toBe('https://r.example/a.mp4');
    expect(findOutputUrl({ images: [{ url: 'http://insecure/x.png' }] })).toBeNull();
  });
});
