import { expect, it } from 'vitest';
import {
  simulateBots,
  parseSimulationArgs,
  replaySimulationHand,
  simulationExitCode,
} from '../../scripts/lib/bot-simulation-runtime.js';
it('runs three real transactional basic hands and replays each recorded action trace', async () => {
  const r = await simulateBots({ seed: 20261031, hands: 3 });
  expect(r).toMatchObject({
    completedHands: 3,
    illegalActions: 0,
    conservationFailures: 0,
    stuckHands: 0,
    failure: null,
    resourcesClosed: true,
  });
  expect(r.trace).toHaveLength(3);
  expect(new Set(r.trace.map((h) => h.deck.join(','))).size).toBe(3);
  for (const h of r.trace) expect(replaySimulationHand(h)).toEqual(h.finalStacks);
});
it('rejects a 200-hand report without any accepted standard decision', () => {
  expect(
    simulationExitCode({
      requestedHands: 200,
      completedHands: 200,
      standardAcceptedJobs: 0,
      failure: null,
      resourcesClosed: true,
    }),
  ).toBe(1);
  expect(
    simulationExitCode({
      requestedHands: 3,
      completedHands: 3,
      standardAcceptedJobs: 0,
      failure: null,
      resourcesClosed: true,
    }),
  ).toBe(0);
});
it('resets only at a hand boundary with explicit removal and grants in a new match', async () => {
  const r = await simulateBots({ seed: 20261031, hands: 3 }, { resetAtHand: 2 });
  expect(r.failure).toBeNull();
  expect(r.resets).toBe(1);
  expect(r.resetLedger).toHaveLength(8);
  expect(r.resetLedger.reduce((n, e) => n + e.delta, 0)).toBe(0);
  expect(r.trace[1]!.startingStacks.every((p) => p.stack === 2000)).toBe(true);
});
it('uses a real compiled worker in a standard diagnostic hand', async () => {
  const r = await simulateBots(
    { seed: 20261031, hands: 1 },
    { profile: 'standard', strongDeck: true },
  );
  expect(r.failure).toBeNull();
  expect(r.standardAcceptedJobs).toBeGreaterThan(0);
  expect(r.actualSamples).toBeGreaterThan(0);
  expect(r.jobs.some((j) => j.outcome.threadId !== null && j.outcome.threadId > 0)).toBe(true);
});
it('stops at the first illegal action in hand three and preserves the two-hand prefix', async () => {
  const r = await simulateBots({ seed: 20261031, hands: 5 }, { faultAtHand: 3 });
  expect(r).toMatchObject({ completedHands: 2, illegalActions: 1, resourcesClosed: true });
  expect(r.failure?.handIndex).toBe(3);
  expect(r.trace).toHaveLength(3);
});
it('fails a hand that exceeds its advance limit without counting it as completed', async () => {
  const r = await simulateBots({ seed: 77, hands: 3 }, { maxAdvances: 0 });
  expect(r).toMatchObject({ completedHands: 0, stuckHands: 1, resourcesClosed: true });
});
it.each([
  ['--hands', '201'],
  ['--hands', '0'],
  ['--seed', 'NaN'],
  ['--seed', '1.1'],
  ['--output', '../outside.json'],
  ['--output', 'docs/verification/w27.md'],
  ['--fault', '3'],
  ['--hands', '2', '--hands', '3'],
])('rejects unsafe or unknown CLI input %j', (...args) =>
  expect(() => parseSimulationArgs(args)).toThrow(),
);
