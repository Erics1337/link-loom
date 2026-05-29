import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '../..');
const port = process.env.WEB_E2E_PORT ?? '3100';
const baseURL = process.env.WEB_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm --filter web dev -- --hostname 127.0.0.1 --port ${port}`,
    cwd: repoRoot,
    url: baseURL,
    reuseExistingServer: process.env.WEB_E2E_REUSE_SERVER === 'true',
    timeout: 120000,
  },
});
