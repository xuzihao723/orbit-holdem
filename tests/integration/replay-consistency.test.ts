import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { HistoryResponse } from '@orbit/protocol';
import { gameContext } from '../helpers/game-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
import { projectReplay } from '../../apps/server/src/persistence/replay-projector.js';
import { createApplicationRuntime } from '../../apps/server/src/application-runtime.js';
async function nextHand(c: Awaited<ReturnType<typeof gameContext>>) {
  for (const h of c.humans) {
    const ack = await c.command(h.socket, 'room:ready', {
      commandId: randomUUID(),
      roomId: c.roomId,
      expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
      ready: true,
    });
    if (!ack.ok) throw Error(ack.code);
  }
  const ack = await c.command(c.humans[0]!.socket, 'room:start', {
    commandId: randomUUID(),
    roomId: c.roomId,
    expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
  });
  if (!ack.ok) throw Error(ack.code);
}
test('real keyset paging has no duplicate hand at equal timestamps; client reads strictly validated private data', async () => {
  const c = await gameContext();
  const credentials = memoryCredentialStore(),
    client = createSocketClient({ url: c.origin, credentials });
  try {
    for (let i = 0; i < 23; i++) {
      await c.play({ type: 'fold' });
      if (i < 22) await nextHand(c);
    }
    const h = c.humans[0]!;
    credentials.write({
      sessionId: h.sessionId,
      resumeToken: h.resumeToken,
      expiresAt: h.expiresAt,
    });
    await client.connect();
    expect((await client.resume()).ok).toBe(true);
    const first = await client.historyList({ cursor: null });
    expect(first.ok).toBe(true);
    if (!first.ok) throw Error(first.code);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = await client.historyList({ cursor: first.nextCursor });
    expect(second.ok).toBe(true);
    if (!second.ok) throw Error(second.code);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBe(null);
    expect(new Set([...first.items, ...second.items].map((i) => i.handId)).size).toBe(23);
    const last = first.items[0]!,
      replay = await client.replayGet(last.handId);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw Error(replay.code);
    expect(
      replay.frames.at(-1)!.state.players.find((p) => p.participantId === last.participantId)!
        .stack,
    ).toBe(last.endingStack);
    expect(last.netHandChange).toBe(last.endingStack! - last.startingStack);
    const foreignCursor = Buffer.from(
      JSON.stringify({ v: 1, s: 'foreign', t: last.startedAt, h: last.handId }),
    ).toString('base64url');
    expect(await client.historyList({ cursor: foreignCursor })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await client.replayGet(c.hand().handId)).toMatchObject({ ok: true });
  } finally {
    client.close();
    await c.close();
  }
});
test('a real new epoch archives the unfinished hand, preserves settled results and returns no invented profit', async () => {
  const c = await gameContext();
  let restarted: ReturnType<typeof createApplicationRuntime> | undefined;
  try {
    await c.passive();
    const settledId = c.hand().handId,
      result = JSON.stringify(c.app.database.hands.readHand(settledId)!.result);
    await nextHand(c);
    const activeId = c.hand().handId,
      viewer = c.hand().players[0]!.participantId;
    await c.app.close();
    restarted = createApplicationRuntime({
      database: c.storage.db,
      serverEpoch: 'actual-restart',
      now: () => 2000,
    });
    const row = restarted.database.hands.readHand(activeId)!;
    expect(row.status).toBe('interrupted');
    expect(row.result).toBe(null);
    const replay = await projectReplay(
      row,
      restarted.database.repositories.readReplayEvents(activeId),
      viewer,
    );
    expect(replay.frames.at(-1)!.state.phase).toBe('interrupted');
    expect(replay.result).toBe(null);
    expect(JSON.stringify(restarted.database.hands.readHand(settledId)!.result)).toBe(result);
    const control = {
      socketId: 'none',
      sessionId: c.humans[0]!.sessionId,
      connectionGeneration: 1,
    };
    // Identity checks remain enforced after restart; no fabricated query authorization.
    const denied = await restarted.history.executeQuery({
      event: 'history:list',
      payload: { requestId: randomUUID(), cursor: null },
      control,
      receivedAt: 2000,
    });
    expect(denied.ok).toBe(false);
  } finally {
    await restarted?.close();
    await c.close();
  }
});
