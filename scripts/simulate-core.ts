import { writeFileSync } from 'node:fs';
import { invariantFixtures } from '../tests/helpers/invariant-scenarios.js';
import {
  simulateLegalHands,
  simulateInvalidActions,
  diagnosticJson,
} from '../tests/helpers/core-simulation.js';
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  console.error('Usage: simulate-core [--output path]');
  process.exitCode = 1;
} else {
  try {
    const data = invariantFixtures(),
      legal = simulateLegalHands(data.legal),
      invalid = simulateInvalidActions(data.invalid),
      report = {
        date: '2026-10-30',
        scope: 'test-only seeded full hands and illegal rejections',
        legal,
        invalid,
      };
    writeFileSync(args[1] ?? 'docs/verification/scratch-simulation.json', diagnosticJson(report));
    console.log(
      JSON.stringify({
        legalCompleted: legal.completed,
        invalidCompleted: invalid.completed,
        failures: legal.failureCount + invalid.failureCount,
      }),
    );
    if (legal.failureCount || invalid.failureCount) process.exitCode = 1;
  } catch {
    console.error('CORE_SIMULATION_FAILED');
    process.exitCode = 1;
  }
}
