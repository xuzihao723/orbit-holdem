import type { CommandAck, ServerMeta } from '@orbit/protocol';
import type { ReceiptInsert } from '../persistence/rows.js';
import type { AuthenticatedCommand } from '../transport/types.js';
import { commandDigest } from './command-digest.js';
export function toReceipt(c: AuthenticatedCommand, ack: CommandAck): ReceiptInsert {
  return {
    actorScope: 'session:' + c.control.sessionId,
    commandId: c.payload.commandId,
    payloadHash: commandDigest(c.event, c.payload),
    event: c.event,
    result: ack,
    roomId: ack.roomId,
    appliedRoomVersion: ack.ok ? ack.appliedRoomVersion : null,
    handId: ack.ok ? ack.handId : null,
    appliedHandVersion: ack.ok ? ack.appliedHandVersion : null,
    createdAt: ack.serverTime,
  };
}
export function duplicateReceipt(r: ReceiptInsert, meta: ServerMeta): CommandAck {
  return { ...(r.result as CommandAck), ...meta, duplicate: true };
}
