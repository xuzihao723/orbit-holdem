import type { CorePotAward } from '@orbit/poker-core';
import type { PotAward } from '@orbit/protocol';
const project = (p: CorePotAward, identity: (seat: number) => string): PotAward => ({
  potId: p.potId,
  amount: p.amount,
  eligibleParticipantIds: p.eligibleSeatIds.map(identity),
  winnerParticipantIds: p.winnerSeatIds.map(identity),
  allocations: p.allocations.map((a) => ({ participantId: identity(a.seatId), amount: a.amount })),
  winningCategory: p.winningCategory,
});
void project;
