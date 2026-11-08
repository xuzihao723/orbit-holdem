import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'ui-settings.spec.ts',
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
          '-ui-playwright.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  projects: [{ name: 'chromium-ui', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview --workspace @orbit/web -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
