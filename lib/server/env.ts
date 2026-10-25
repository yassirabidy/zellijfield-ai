import path from 'node:path';
import { z } from 'zod';

// Server-side runtime configuration. Docker sets these in docker-compose.yml; outside Docker the
// defaults point at ./data, ./models and ./workflows next to the app.

const backendId = z.enum(['mock', 'wan2gp', 'comfyui', 'fal', 'replicate']);

const envSchema = z.object({
  DATA_DIR: z.string().default('./data'),
  OUTPUTS_DIR: z.string().optional(),
  WORKFLOWS_DIR: z.string().default('./workflows'),
  MODELS_DIR: z.string().default('./models'),
  DEFAULT_BACKEND: backendId.default('mock'),
  WAN2GP_MCP_URL: z.string().default('http://127.0.0.1:7866/mcp'),
  COMFYUI_URL: z.string().default('http://127.0.0.1:8188'),
  // Non-Docker only: run `wgp.py --process` from a local Wan2GP folder instead of MCP.
  WAN2GP_MODE: z.enum(['mcp', 'spawn']).default('mcp'),
  WAN2GP_DIR: z.string().default(''),
  WAN2GP_PYTHON: z.string().default(''),
  // Milliseconds per simulated mock step (tests set it to 0).
  MOCK_STEP_MS: z.coerce.number().int().min(0).max(10_000).default(400),
});

export type BackendId = z.infer<typeof backendId>;

export interface ServerEnv {
  dataDir: string;
  outputsDir: string;
  workflowsDir: string;
  modelsDir: string;
  defaultBackend: BackendId;
  wan2gpMcpUrl: string;
  comfyuiUrl: string;
  wan2gpMode: 'mcp' | 'spawn';
  wan2gpDir: string;
  wan2gpPython: string;
  mockStepMs: number;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const e = envSchema.parse(source);
  const dataDir = path.resolve(e.DATA_DIR);
  return {
    dataDir,
    outputsDir: path.resolve(e.OUTPUTS_DIR || path.join(dataDir, 'outputs')),
    workflowsDir: path.resolve(e.WORKFLOWS_DIR),
    modelsDir: path.resolve(e.MODELS_DIR),
    defaultBackend: e.DEFAULT_BACKEND,
    wan2gpMcpUrl: e.WAN2GP_MCP_URL,
    comfyuiUrl: e.COMFYUI_URL,
    wan2gpMode: e.WAN2GP_MODE,
    wan2gpDir: e.WAN2GP_DIR,
    wan2gpPython: e.WAN2GP_PYTHON,
    mockStepMs: e.MOCK_STEP_MS,
  };
}

let cached: ServerEnv | null = null;
export function getEnv(): ServerEnv {
  cached ??= loadEnv();
  return cached;
}
