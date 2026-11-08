import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'showcase.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  projects: [{ name: 'chromium-showcase', use: { ...devices['Desktop Chrome'] } }],
});
