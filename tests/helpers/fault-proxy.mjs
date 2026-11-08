import { createServer, request as httpRequest } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
export async function startFaultProxy({ port = 0, target, origin }) {
  const targetUrl = new URL(target);
  let profile = 'base',
    dropNext = false,
    dropId = null;
  const stats = {
      connections: 0,
      clientFrames: 0,
      serverFrames: 0,
      droppedAcks: 0,
      overflowClosures: 0,
    },
    connections = new Set();
  const server = createServer((req, res) => {
    const upstream = httpRequest(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.host },
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });
  wss.on('connection', (client, req) => {
    stats.connections++;
    const upstream = new WebSocket(target.replace(/^http/, 'ws') + req.url, {
      headers: { Origin: origin },
    });
    const connection = { client, upstream, queues: [[], []], timers: [null, null], closed: false };
    connections.add(connection);
    function close() {
      if (connection.closed) return;
      connection.closed = true;
      for (const timer of connection.timers) clearTimeout(timer);
      client.terminate();
      upstream.terminate();
      connections.delete(connection);
    }
    function pump(direction) {
      clearTimeout(connection.timers[direction]);
      connection.timers[direction] = null;
      const destination = direction === 0 ? upstream : client,
        queue = connection.queues[direction];
      if (connection.closed || destination.readyState !== WebSocket.OPEN) return;
      while (queue.length && queue[0].due <= performance.now()) {
        const frame = queue.shift();
        if (destination.bufferedAmount > 2 * 1024 * 1024) {
          stats.overflowClosures++;
          close();
          return;
        }
        destination.send(frame.data, { binary: frame.binary });
      }
      if (queue.length)
        connection.timers[direction] = setTimeout(
          () => pump(direction),
          Math.max(0, queue[0].due - performance.now()),
        );
    }
    function enqueue(direction, data, binary) {
      const text = binary ? '' : data.toString();
      try {
        if (text.startsWith('42')) {
          const [event, payload] = JSON.parse(text.slice(2));
          if (direction === 0 && dropNext && event === 'game:action' && dropId === null)
            dropId = payload.commandId;
          if (
            direction === 1 &&
            dropNext &&
            event === 'command:ack' &&
            payload.commandId === dropId
          ) {
            stats.droppedAcks++;
            dropNext = false;
            dropId = null;
            return;
          }
        }
      } catch {
        /* Non-event Engine.IO packets are forwarded unchanged. */
      }
      const queue = connection.queues[direction],
        all = connection.queues.flat();
      if (
        all.length >= 1024 ||
        all.reduce((n, f) => n + f.data.length, 0) + data.length > 2 * 1024 * 1024
      ) {
        stats.overflowClosures++;
        close();
        return;
      }
      queue.push({
        data: Buffer.from(data),
        binary,
        due: performance.now() + (profile === 'rtt100' ? 50 : profile === 'rtt300' ? 150 : 0),
      });
      pump(direction);
    }
    client.on('message', (data, binary) => {
      stats.clientFrames++;
      enqueue(0, data, binary);
    });
    upstream.on('message', (data, binary) => {
      stats.serverFrames++;
      enqueue(1, data, binary);
    });
    upstream.on('open', () => pump(0));
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    setProfile(value) {
      if (!['base', 'rtt100', 'rtt300'].includes(value)) throw Error('INVALID_PROFILE');
      profile = value;
    },
    dropNextActionAck() {
      dropNext = true;
      dropId = null;
    },
    get stats() {
      return { ...stats };
    },
    async close() {
      for (const c of [...connections]) {
        c.client.terminate();
        c.upstream.terminate();
        for (const t of c.timers) clearTimeout(t);
      }
      connections.clear();
      wss.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
