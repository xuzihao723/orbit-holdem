import type { ErrorCode } from '@orbit/protocol';
import type { HandFailureReason } from '@orbit/poker-core';
export function mapHandFailure(reason: HandFailureReason): ErrorCode {
  if (reason === 'HAND_SETTLED') return 'HAND_MISMATCH';
  if (reason === 'TURN_MISMATCH') return 'TURN_EXPIRED';
  return reason;
}
