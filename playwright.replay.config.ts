import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'history-replay.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          'docs/verification/' +
          (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') +
          '-replay-playwright.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  projects: [{ name: 'chromium-replay', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview --workspace @orbit/web -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
