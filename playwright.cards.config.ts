import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'card-samples.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          'docs/verification/' +
          (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') +
          '-cards.config.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off' },
  projects: [{ name: 'chromium-cards', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
