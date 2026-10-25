import { defineConfig, devices } from '@playwright/test';

// Smoke test of the mock flow. CI runs it against the production build (`next start`); locally it
// uses `next dev` unless E2E_PROD=1. Data goes to .e2e-data so it never touches ./data.
const PORT = 3100;
const prod = Boolean(process.env.CI || process.env.E2E_PROD);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: prod ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATA_DIR: '.e2e-data',
      MOCK_STEP_MS: '300',
      SHOW_MOCK: '1',
      // Unreachable on purpose: the smoke test needs no GPU backends.
      WAN2GP_MCP_URL: 'http://127.0.0.1:9/mcp',
      COMFYUI_URL: 'http://127.0.0.1:9',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
