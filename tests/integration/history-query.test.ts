import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { HistoryResponse, ReplayResponse } from '@orbit/protocol';
import type { Socket } from 'socket.io-client';
import { gameContext } from '../helpers/game-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
function query<T>(socket: Socket, event: string, payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('QUERY_TIMEOUT')), 4000);
    socket.emit(event, { requestId: randomUUID(), ...payload }, (r: T) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}
test('real queries require actual participation, return exact net change and keep folded opponents hidden', async () => {
  const c = await gameContext();
  try {
    const owner = c.humans[0]!,
      other = await c.guest('Waiting');
    await c.command(other.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'Waiting',
    });
    await c.play({ type: 'fold' });
    const list = await query<HistoryResponse>(owner.socket, 'history:list', {
      cursor: null,
      limit: 20,
    });
    expect(list.ok).toBe(true);
    if (!list.ok) throw Error(list.code);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.handId).toBe(c.hand().handId);
    const row = c.app.database.hands.readHand(c.hand().handId)!;
    expect(list.items[0]!.netHandChange).toBe(
      row.result!.finalStacks.find((p) => p.participantId === list.items[0]!.participantId)!.stack -
        2000,
    );
    const replay = await query<ReplayResponse>(owner.socket, 'replay:get', {
      handId: c.hand().handId,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw Error(replay.code);
    expect(replay.frames.length).toBeGreaterThan(1);
    expect(replay.frames[0]!.ownerHoleCards).toBe(null);
    expect(replay.frames.at(-1)!.state.players.map((p) => p.stack)).toEqual(
      row.result!.finalStacks.map((p) => p.stack),
    );
    expect(replay.frames.every((f) => f.state.showdownCards.length === 0)).toBe(true);
    expect(JSON.stringify(replay)).not.toMatch(/deck|resumeToken|burnCards|tokenHash/);
    const refused = await query<ReplayResponse>(other.socket, 'replay:get', {
      handId: c.hand().handId,
    });
    expect(refused).toMatchObject({ ok: false, code: 'REPLAY_FORBIDDEN' });
    expect(
      await query<ReplayResponse>(owner.socket, 'replay:get', { handId: 'missing' }),
    ).toMatchObject({ ok: false, code: 'REPLAY_FORBIDDEN' });
  } finally {
    await c.close();
  }
});
test('a completed private projection cannot escape through a revoked controller after takeover', async () => {
  const c = await gameContext(),
    credentials = memoryCredentialStore(),
    client = createSocketClient({ url: c.origin, credentials });
  const original = c.app.history.executeQuery.bind(c.app.history);
  let release!: () => void, entered!: () => void;
  const arrived = new Promise<void>((r) => {
      entered = r;
    }),
    held = new Promise<void>((r) => {
      release = r;
    });
  try {
    await c.play({ type: 'fold' });
    const owner = c.humans[0]!;
    c.app.history.executeQuery = async (q) => {
      const result = await original(q);
      entered();
      await held;
      return result;
    };
    const pending = query<ReplayResponse>(owner.socket, 'replay:get', { handId: c.hand().handId });
    await arrived;
    credentials.write({
      sessionId: owner.sessionId,
      resumeToken: owner.resumeToken,
      expiresAt: owner.expiresAt,
    });
    await client.connect();
    expect((await client.resume()).ok).toBe(true);
    release();
    const response = await pending;
    expect(response).toMatchObject({ ok: false, code: 'SESSION_TAKEN_OVER' });
    expect(JSON.stringify(response)).not.toContain('frames');
  } finally {
    release?.();
    client.close();
    await c.close();
  }
});
