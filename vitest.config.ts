import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'integration',
          // Each file may create its own bounded worker pool and SQLite runtime.
          // Bound file concurrency so unrelated cold starts do not consume job budgets.
          maxWorkers: 2,
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 10_000,
        },
      },
      { test: { name: 'core', environment: 'node', include: ['tests/core/**/*.test.ts'] } },
    ],
  },
});
