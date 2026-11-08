import { parentPort, threadId } from 'node:worker_threads';
parentPort!.postMessage({ kind: 'ready', threadId });
parentPort!.on('message', () => {
  throw Error('OWNED_WORKER_CRASH');
});
