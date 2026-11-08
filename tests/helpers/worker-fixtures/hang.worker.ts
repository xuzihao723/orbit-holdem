import { parentPort, threadId } from 'node:worker_threads';
parentPort!.postMessage({ kind: 'ready', threadId });
parentPort!.on('message', () => {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.wait(flag, 0, 0, 1000);
});
