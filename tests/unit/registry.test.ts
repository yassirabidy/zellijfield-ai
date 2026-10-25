import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import registryJson from '../../models.json';
import { getRegistry, parseRegistry } from '@/lib/server/registry';

const base = {
  id: 'x',
  name: 'X',
  family: 'test',
  type: 'video',
  backend: 'mock',
};

describe('models.json registry', () => {
  it('validates the shipped registry', () => {
    const registry = parseRegistry(registryJson);
    expect(registry.models.length).toBeGreaterThan(0);
    expect(getRegistry().models.map((m) => m.id)).toContain('mock-video');
  });

  it('maps the requested models to the agreed backends', () => {
    const backendOf = (id: string) => getRegistry().models.find((m) => m.id === id)?.backend;
    expect(backendOf('minimax-h3')).toBe('wan2gp');
    expect(backendOf('ltx-2.5')).toBe('wan2gp');
    expect(backendOf('wan-2.2-t2v')).toBe('wan2gp');
    expect(backendOf('hunyuan-video-1.5')).toBe('wan2gp');
    expect(backendOf('skyreels-v3')).toBe('comfyui');
    expect(backendOf('cosmos3-super')).toBe('comfyui');
    expect(getRegistry().models.find((m) => m.id === 'cosmos3-super')?.experimental).toBe(true);
  });

  it('uses Wan2GP model types that exist upstream (pinned list)', () => {
    // Basenames of deepbeepmeep/Wan2GP@9d25c60 defaults/*.json used by the registry.
    const known = new Set(['minimax_h3_fl2va_pruned', 'ltx2_25_22B_distilled', 't2v_2_2', 'i2v_2_2', 'hunyuan_1_5_480_t2v']);
    for (const m of getRegistry().models.filter((m) => m.backend === 'wan2gp')) {
      expect(known.has(m.wan2gp!.modelType), m.id).toBe(true);
    }
  });

  it('maps ComfyUI inputs onto nodes that exist in the shipped workflows', () => {
    for (const m of getRegistry().models.filter((m) => m.backend === 'comfyui')) {
      const wf = JSON.parse(fs.readFileSync(path.join('workflows', m.comfyui!.workflow), 'utf8'));
      expect(wf[m.comfyui!.outputNode], `${m.id} output node`).toBeDefined();
      for (const [key, refs] of Object.entries(m.comfyui!.inputs)) {
        for (const ref of refs ?? []) {
          expect(wf[ref.node], `${m.id}.${key} -> node ${ref.node}`).toBeDefined();
          expect(ref.input in wf[ref.node].inputs, `${m.id}.${key} -> ${ref.node}.${ref.input}`).toBe(true);
        }
      }
    }
  });

  it('rejects duplicate ids', () => {
    expect(() => parseRegistry({ version: 1, models: [base, base] })).toThrow(/duplicate model id/);
  });

  it('requires the backend block that matches the backend', () => {
    // zod reports issues as JSON, so the quotes arrive escaped.
    expect(() => parseRegistry({ version: 1, models: [{ ...base, backend: 'wan2gp' }] })).toThrow(/requires a \\?"wan2gp\\?" block/);
    expect(() => parseRegistry({ version: 1, models: [{ ...base, backend: 'comfyui' }] })).toThrow(/requires a \\?"comfyui\\?" block/);
  });

  it('rejects invented-looking identifiers', () => {
    const bad = { ...base, backend: 'wan2gp', wan2gp: { modelType: '../etc/passwd' } };
    expect(() => parseRegistry({ version: 1, models: [bad] })).toThrow();
    const badNode = {
      ...base,
      backend: 'comfyui',
      comfyui: { workflow: 'a.json', outputNode: '9', inputs: { prompt: { node: 'KSampler', input: 'text' } } },
    };
    expect(() => parseRegistry({ version: 1, models: [badNode] })).toThrow(/numeric/);
  });

  it('requires a resolution for every declared aspect ratio', () => {
    const m = { ...base, backend: 'wan2gp', aspectRatios: ['16:9', '9:16'], wan2gp: { modelType: 't2v_2_2', resolutions: { '16:9': '832x480' } } };
    expect(() => parseRegistry({ version: 1, models: [m] })).toThrow(/9:16 has no resolution/);
  });
});
