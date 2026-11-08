import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  bindingFor,
  parseWorkerJob,
  parseWorkerResult,
} from '../../apps/server/src/bots/worker-messages.js';
import { royalCase } from '../helpers/equity-cases.js';
function job() {
  const o = royalCase(),
    jobId = randomUUID();
  return {
    kind: 'estimate' as const,
    jobId,
    binding: bindingFor(jobId, o),
    observation: o,
    seed: 77,
    requestedSamples: 1000,
    remainingMs: 150,
    cancellation: new SharedArrayBuffer(4),
  };
}
it('accepts a closed job and rejects hidden fields, mismatched binding or unsafe metadata', () => {
  const j = job();
  expect(parseWorkerJob(j).binding).toEqual(j.binding);
  for (const wrong of [
    { ...j, deck: [] },
    { ...j, seed: Infinity },
    { ...j, remainingMs: 0 },
    { ...j, cancellation: new SharedArrayBuffer(8) },
    { ...j, binding: { ...j.binding, turnId: 'other' } },
    { ...j, observation: { ...j.observation, sessionId: 'secret' } },
    {
      ...j,
      observation: {
        ...j.observation,
        players: j.observation.players.map((p) => ({ ...p, holeCards: ['AS', 'AH'] })),
      },
    },
  ])
    expect(() => parseWorkerJob(wrong)).toThrow();
});
it('validates finite matching estimates without trusting a worker to choose an actor', () => {
  const j = job(),
    result = {
      kind: 'result',
      jobId: j.jobId,
      binding: j.binding,
      threadId: 42,
      estimate: {
        requestedSamples: 1000,
        completedSamples: 100,
        weightedShare: 0.5,
        expectedReturn: 100,
        additionalCallCost: 0,
        expectedNet: 100,
        stopReason: 'budget',
      },
    };
  expect(parseWorkerResult(result, j, 42).estimate.completedSamples).toBe(100);
  for (const wrong of [
    { ...result, threadId: 43 },
    { ...result, actor: 'other' },
    { ...result, estimate: { ...result.estimate, weightedShare: NaN } },
    { ...result, estimate: { ...result.estimate, expectedReturn: 201, expectedNet: 201 } },
    { ...result, estimate: { ...result.estimate, completedSamples: 1001 } },
    { ...result, binding: { ...j.binding, handId: 'other' } },
  ])
    expect(() => parseWorkerResult(wrong, j, 42)).toThrow();
});
