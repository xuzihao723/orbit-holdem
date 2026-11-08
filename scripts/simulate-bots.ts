import { writeFileSync } from 'node:fs';
import {
  parseSimulationArgs,
  simulateBots,
  simulationExitCode,
} from './lib/bot-simulation-runtime.js';
try {
  const input = parseSimulationArgs(process.argv.slice(2)),
    report = await simulateBots(input);
  writeFileSync(input.output!, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      output: input.output,
      completedHands: report.completedHands,
      requestedHands: report.requestedHands,
      failure: report.failure,
      standardAcceptedJobs: report.standardAcceptedJobs,
    }),
  );
  process.exitCode = simulationExitCode(report);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
