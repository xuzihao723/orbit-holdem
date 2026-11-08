import type { Action, Street } from '@orbit/poker-core';
import type { Action as WireAction, Street as WireStreet } from '@orbit/protocol';
import type { CoreLegalActions, BettingEffect, BettingRound } from '@orbit/poker-core';
import type { LegalActionsView } from '@orbit/protocol';
const toWireAction = (a: Action): WireAction => a;
const fromWireAction = (a: WireAction): Action => a;
const toWireStreet = (s: Street): WireStreet => s;
const fromWireStreet = (s: WireStreet): Street => s;
void [toWireAction, fromWireAction, toWireStreet, fromWireStreet];
const toWireLegalActions = (core: CoreLegalActions): LegalActionsView => ({
  ...core,
  allowed: [...core.allowed],
  allIn: core.allIn ? { ...core.allIn } : null,
});
const fromWireLegalActions = (wire: LegalActionsView): CoreLegalActions => wire;
const cannotUseEffectAsRound = (effect: BettingEffect): void => {
  // @ts-expect-error Amount-only effects have no actor or pending queue.
  const round: BettingRound = effect;
  void round;
};
void [toWireLegalActions, fromWireLegalActions, cannotUseEffectAsRound];
