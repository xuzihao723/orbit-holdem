import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'account-auth.spec.ts',
  workers: 1,
  retries: 0,
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 640 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'mobile-430', use: { viewport: { width: 430, height: 932 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
  ],
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `docs/verification/${process.env.ORBIT_VERIFY_STAGE ?? 'w45-w50'}-auth-playwright.json`,
      },
    ],
  ],
});
