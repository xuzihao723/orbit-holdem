import { scenario, array, record, cards, integer } from './fixture-read.js';
import {
  createDeck,
  createHand,
  applyHandAction,
  assertHandInvariants,
} from '../../packages/poker-core/src/index.js';
import { withTurnClock } from '../../apps/server/src/game/turn-timer.js';
import type { RoomState } from '../../apps/server/src/rooms/room-types.js';
export function botPrivacyContext() {
  const f = scenario('PRIV04', ['projectBotVariantsAndValidateConnection']),
    v = record(array(f.given.variants).find((v) => record(v).name === 'botObservation')),
    own = cards(v.ownHoleCards),
    board = cards(v.board),
    seed = integer(v.policySeed);
  const rooms = array(v.alternativeHiddenStates).map((variant) => {
    const hidden = record(variant),
      opponent = cards(hidden.opponentHoleCards),
      future = cards(hidden.futureCards),
      prefix = [
        own[0]!,
        opponent[0]!,
        own[1]!,
        opponent[1]!,
        '2S' as const,
        ...board,
        '3S' as const,
        future[0]!,
        '4S' as const,
        future[1]!,
      ],
      deck = [...prefix, ...createDeck().filter((c) => !prefix.includes(c))];
    let hand = createHand({
      handId: 'privacy-hand',
      dealerSeatId: 1,
      deck,
      players: [
        { participantId: 'bot-a', seatId: 0, stack: 2000 },
        { participantId: 'bot-b', seatId: 1, stack: 2000 },
      ],
    }).state;
    for (const type of ['call', 'check'] as const) {
      const x = applyHandAction(hand, {
        seatId: hand.betting!.actorSeatId!,
        turnId: hand.turnId!,
        action: { type },
      });
      if (!x.ok) throw Error(x.reason);
      hand = x.state;
    }
    assertHandInvariants(hand);
    if (
      JSON.stringify(hand.players[0]!.holeCards) !== JSON.stringify(own) ||
      JSON.stringify(hand.board) !== JSON.stringify(board)
    )
      throw Error('PRIV04_PREMISE');
    const state: RoomState = {
      row: {
        roomId: 'privacy-room',
        roomCode: 'ABC234',
        capacity: 2,
        status: 'playing',
        roomVersion: 7,
        serverEpoch: 'privacy-epoch',
        hostParticipantId: null,
        matchId: 'privacy-match',
        currentHandId: hand.handId,
        createdAt: 0,
        closedAt: null,
        resetProposal: null,
      },
      match: {
        matchId: 'privacy-match',
        roomId: 'privacy-room',
        status: 'active',
        lastBigBlindSeatId: 0,
        startedAt: 0,
        endedAt: null,
      },
      participants: hand.players.map((p) => ({
        participantId: p.participantId,
        roomId: 'privacy-room',
        sessionId: null,
        botId: p.participantId,
        seatId: p.seatId,
        nickname: p.participantId,
        stack: p.stack,
        admission: 'active',
        joinedAt: 0,
        leftAt: null,
        ready: false,
        botDifficulty: 'basic',
      })),
      hand,
      previous: null,
      publicEventSequence: hand.eventSequence,
    };
    return withTurnClock(state, 0);
  });
  return { rooms, seed, own, board, expected: record(f.expected.botObservation), botId: 'bot-a' };
}
