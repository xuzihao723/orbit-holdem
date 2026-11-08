import { afterEach, expect, it } from 'vitest';
import { gameContext } from '../helpers/game-context.js';
import { validateInternalReceipt } from '../../apps/server/src/persistence/internal-receipt.js';
import { validateReceipt } from '../../apps/server/src/persistence/payloads.js';
import type { ReceiptInsert } from '../../apps/server/src/persistence/rows.js';
import type { HandActionCommit } from '../../apps/server/src/persistence/hand-rows.js';
const contexts: Awaited<ReturnType<typeof gameContext>>[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
function receipt(): ReceiptInsert {
  return {
    actorScope: 'system:r1',
    commandId: 'timeout:h1:t1',
    payloadHash: 'a'.repeat(64),
    event: 'internal:timeout',
    result: { kind: 'internalApplied', roomId: 'r1', roomVersion: 2, handId: 'h1', handVersion: 2 },
    roomId: 'r1',
    appliedRoomVersion: 2,
    handId: 'h1',
    appliedHandVersion: 2,
    createdAt: 1000,
  };
}
it('validates a closed internal receipt without weakening the public UUID contract', () => {
  expect(() => validateInternalReceipt(receipt())).not.toThrow();
  expect(() => validateReceipt(receipt())).toThrow();
});
it.each(['actor', 'id', 'event', 'result', 'extra'])('rejects a forged internal %s', (field) => {
  const r = receipt();
  if (field === 'actor') Object.assign(r, { actorScope: 'session:s1' });
  if (field === 'id') Object.assign(r, { commandId: 'timeout:another:t1' });
  if (field === 'event') Object.assign(r, { event: 'internal:anything' });
  if (field === 'result')
    Object.assign(r, { result: { ...(r.result as object), handVersion: 99 } });
  if (field === 'extra') Object.assign(r, { privateState: [] });
  expect(() => validateInternalReceipt(r)).toThrow();
});
it('commits an actual internal hand batch atomically and can read only through the internal scope', async () => {
  const c = await gameContext();
  contexts.push(c);
  const commit = c.app.database.hands.commitHandAction;
  let batch!: HandActionCommit;
  c.app.database.hands.commitHandAction = (b) => {
    batch = b;
    throw Error('capture candidate only');
  };
  await c.play({ type: 'call' });
  const r: ReceiptInsert = {
    ...batch.receipt,
    actorScope: 'system:' + c.roomId,
    commandId: 'timeout:' + batch.hand.handId + ':' + c.hand().turnId,
    event: 'internal:timeout',
    result: {
      kind: 'internalApplied',
      roomId: c.roomId,
      roomVersion: batch.room.roomVersion,
      handId: batch.hand.handId,
      handVersion: batch.hand.handVersion,
    },
  };
  expect(() => commit({ ...batch, receipt: r })).not.toThrow();
  expect(c.app.database.hands.readHand(batch.hand.handId)!.handVersion).toBe(
    batch.hand.handVersion,
  );
  expect(c.app.database.repositories.findInternalReceipt(r.actorScope, r.commandId)).toMatchObject({
    event: 'internal:timeout',
    result: { kind: 'internalApplied' },
  });
  expect(() => c.app.database.repositories.findReceipt(r.actorScope, r.commandId)).toThrow();
  expect(() => commit({ ...batch, receipt: r })).toThrow();
});
