import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['modes.spec.ts', 'network-recovery.spec.ts', 'component-table-matrix.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          'docs/verification/' +
          (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') +
          '-release-playwright.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', actionTimeout: 10000 },
  projects: [{ name: 'chromium-release', use: { ...devices['Desktop Chrome'] } }],
});
