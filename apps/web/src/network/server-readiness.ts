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
      return 'pending';
    }
    return (await response.json())?.status === 'ready' ? 'ready' : 'pending';
  } catch {
    return 'unreachable';
  }
}

export async function waitForGameServer(
  origin: string | undefined,
  signal: AbortSignal,
  connect: () => Promise<void>,
) {
  const deadline = AbortSignal.timeout(startupTimeoutMs);
  const waiting = AbortSignal.any([signal, deadline]);
  while (!waiting.aborted) {
    if (!navigator.onLine) throw Error('CONNECT_FAILED');
    let readiness = await probeGameServer(origin, waiting);
    if (readiness === 'unreachable' && !waiting.aborted) {
      // The public edge may block the HTTP probe even when the game socket is reachable.
      try {
        await connect();
        readiness = 'ready';
      } catch (error) {
        if (!(
          error instanceof Error && ['CONNECT_FAILED', 'CONNECT_TIMEOUT'].includes(error.message)
        )) {
          throw error;
        }
      }
    }
    if (readiness === 'ready' && !waiting.aborted) return;
    if (!waiting.aborted)
      await new Promise<void>((resolve) => setTimeout(resolve, retryIntervalMs));
  }
  signal.throwIfAborted();
  throw Error('SERVER_START_TIMEOUT');
}
