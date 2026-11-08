import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2),
  input = args[args.indexOf('--origin') + 1];
if (!args.includes('--origin') || !input)
  throw Error('Usage: deploy:verify -- --origin AUTHORIZED_ORIGIN [--local-http]');
const origin = new URL(input).origin;
if (origin !== input || (!args.includes('--local-http') && !origin.startsWith('https://')))
  throw Error('EXACT_HTTPS_ORIGIN_REQUIRED');
if (
  args.includes('--local-http') &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)
)
  throw Error('LOCAL_HTTP_ONLY');
const results = [];
for (const path of ['/health/live', '/health/ready', '/', '/rules', '/history']) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('DEPLOY_HTTP_FAILED: ' + path);
  results.push({
    path,
    status: response.status,
    contentType: response.headers.get('content-type'),
  });
}
const socket = io(origin, {
  transports: ['websocket'],
  reconnection: false,
  forceNew: true,
  extraHeaders: { Origin: origin },
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WS_CONNECT_TIMEOUT')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  // A transport handshake is read-only; creating a guest or a room is left to the
  // isolated end-to-end suite or an explicitly authorized external smoke session.
  console.log(
    JSON.stringify({
      origin,
      http: results,
      webSocketConnected: true,
      mutations: 0,
      publicHttps: origin.startsWith('https://'),
    }),
  );
} finally {
  socket.disconnect();
}
