import { parentPort, threadId, workerData } from 'node:worker_threads';
parentPort!.postMessage({ kind: 'ready', threadId });
parentPort!.on('message', (job) => {
  if (workerData instanceof SharedArrayBuffer) {
    const gate = new Int32Array(workerData);
    while (Atomics.load(gate, 0) === 0) Atomics.wait(gate, 0, 0, 20);
  }
  const o = job.observation,
    own = o.players.find((p: { participantId: string }) => p.participantId === o.participantId),
    cost = Math.min(own.stack, o.legalActions.callAmount),
    expectedReturn = o.potTotal / 2;
  const message = {
    kind: 'result',
    jobId: job.jobId,
    binding: workerData === 'forged' ? { ...job.binding, turnId: 'forged-turn' } : job.binding,
    threadId,
    estimate: {
      requestedSamples: job.requestedSamples,
      completedSamples: 1,
      weightedShare: 0.5,
      expectedReturn,
      additionalCallCost: cost,
      expectedNet: expectedReturn - cost,
      stopReason: 'budget',
    },
  };
  parentPort!.postMessage({ ...message, jobId: '00000000-0000-4000-8000-000000000000' });
  parentPort!.postMessage(message);
  parentPort!.postMessage(message);
});
