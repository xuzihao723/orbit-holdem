const startupTimeoutMs = 90_000;
const probeTimeoutMs = 10_000;
const retryIntervalMs = 1500;

export async function probeGameServer(origin: string | undefined, signal: AbortSignal) {
  try {
    const response = await fetch(new URL('/health/ready', origin ?? location.origin), {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(probeTimeoutMs)]),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return false;
    }
    return (await response.json())?.status === 'ready';
  } catch {
    return false;
  }
}

export async function waitForGameServer(origin: string | undefined, signal: AbortSignal) {
  const deadline = AbortSignal.timeout(startupTimeoutMs);
  const waiting = AbortSignal.any([signal, deadline]);
  while (!waiting.aborted) {
    if (!navigator.onLine) throw Error('CONNECT_FAILED');
    if (await probeGameServer(origin, waiting)) {
      waiting.throwIfAborted();
      return;
    }
    if (!waiting.aborted)
      await new Promise<void>((resolve) => setTimeout(resolve, retryIntervalMs));
  }
  signal.throwIfAborted();
  throw Error('SERVER_START_TIMEOUT');
}
