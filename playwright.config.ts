import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['startup.spec.ts', 'graybox.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.PLAYWRIGHT_REPORT_FILE ??
          'docs/verification/' + (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') + '-config.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run serve:test',
      url: 'http://127.0.0.1:3001/health/live',
      env: { HOST: '127.0.0.1', PORT: '3001' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
