import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['card-catalog.spec.ts', 'component-states.spec.ts'],
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
          '-assets-playwright.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:5181', trace: 'off' },
  projects: [{ name: 'chromium-assets', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace @orbit/web -- --host 127.0.0.1 --port 5181 --strictPort',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
  },
});
