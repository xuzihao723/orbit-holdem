import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'reconnect.spec.ts',
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
          '-reconnect.config.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium-reconnect', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace @orbit/web -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
