import { createServer } from 'node:net';

try {
  const host = process.env.HOST ?? '127.0.0.1';
  const rawPort = process.env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Development PORT must be an integer between 1 and 65535');
  }
  // Check both before starting either process: Windows child creation can race a tree kill.
  for (const [address, value] of [
    [host, port],
    ['127.0.0.1', 5173],
  ]) {
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen({ host: address, port: value, exclusive: true }, resolve);
    });
    await new Promise((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
