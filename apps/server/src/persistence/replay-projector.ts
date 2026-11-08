import {
  beginBettingRound,
  applyBettingAction,
  getRoundOutcome,
  postBlinds,
  resolvePositions,
  type BettingRound,
  type BettingPlayer,
  type HandEventPayload,
} from '@orbit/poker-core';
import type {
  ReplayFrame,
  ReplayState,
  ReplayView,
  CardPair,
  SeatId,
  Action,
} from '@orbit/protocol';
import type { HandRow } from './hand-rows.js';
import type { EventInsert } from './rows.js';
import { validateEvent } from './payloads.js';
function invalid(): never {
  throw Error('INVALID_REPLAY_EVENTS');
}
export async function projectReplay(
  row: HandRow,
  events: readonly EventInsert[],
  viewer: string,
  checkpoint: () => Promise<void> = async () => {
    await new Promise<void>((r) => setImmediate(r));
  },
) {
  if (
    row.status === 'active' ||
    !row.participantIds.includes(viewer) ||
    !events.length ||
    events.length > 10000
  )
    invalid();
  const first = events[0]!;
  validateEvent(first);
  if (first.kind !== 'handStarted') invalid();
  const start = first.payload as { dealerSeatId: SeatId; seats: SeatId[] };
  if (
    start.seats.length !== row.participantIds.length ||
    start.dealerSeatId !== row.positions.dealerSeatId
  )
    invalid();
  const positions = resolvePositions(start.seats, start.dealerSeatId);
  if (JSON.stringify(positions) !== JSON.stringify(row.positions)) invalid();
  let players = start.seats.map((seatId, i) => ({
    seatId,
    participantId: row.participantIds[i]!,
    stack: row.startingStacks.find((p) => p.participantId === row.participantIds[i])!.stack,
    streetCommitted: 0,
    handCommitted: 0,
    folded: false,
    allIn: false,
    lastActedAtBet: null as number | null,
    hiddenCardCount: 0 as 0 | 2,
  }));
  const expectedBlinds = postBlinds(players, positions).players.filter(
      (p) => p.streetCommitted > 0,
    ),
    blinds = new Set<number>();
  let round: BettingRound | null = null,
    runout = false,
    ownerHoleCards: CardPair | null = null;
  let state: ReplayState = {
    roomId: row.roomId,
    matchId: row.matchId,
    handId: row.handId,
    handVersion: 1,
    phase: 'preflop',
    dealerSeatId: positions.dealerSeatId,
    smallBlindSeatId: positions.smallBlindSeatId,
    bigBlindSeatId: positions.bigBlindSeatId,
    players: [],
    board: [],
    showdownCards: [],
    pots: [],
    potTotal: 0,
    actorSeatId: null,
    publicEventSequence: 0,
  };
  const frames: ReplayFrame[] = [],
    stageStarts: ReplayView['stageStarts'] = [],
    payouts = new Map<SeatId, number>();
  const allCards = new Set<string>();
  const dealt = new Map<SeatId, CardPair>();
  const paidKeys = new Set<string>();
  let lastSequence = 0,
    lastVersion = 1,
    lastAt = row.startedAt,
    settled = false;
  function addCards(cards: readonly string[]) {
    for (const card of cards) {
      if (allCards.has(card)) invalid();
      allCards.add(card);
    }
  }
  function player(seatId: SeatId) {
    const p = players.find((p) => p.seatId === seatId);
    if (!p) invalid();
    return p;
  }
  function merge(next: readonly BettingPlayer[]) {
    players = players.map((p) => ({ ...p, ...next.find((n) => n.seatId === p.seatId)! }));
  }
  function emit(sequence: number, at: number, actionText: string) {
    state = {
      ...state,
      players: players.map(({ lastActedAtBet: _, ...p }) => ({ ...p })),
      actorSeatId:
        state.phase === 'settled' || state.phase === 'interrupted'
          ? null
          : (round?.actorSeatId ?? null),
      potTotal: players.reduce((n, p) => n + p.handCommitted, 0),
    };
    if (
      players.some(
        (p) =>
          ![p.stack, p.handCommitted, p.streetCommitted].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ),
      ) ||
      players.reduce((n, p) => n + p.stack + p.handCommitted, 0) !== row.initialChipTotal
    )
      invalid();
    const phase = state.phase;
    if (!stageStarts.some((s) => s.phase === phase)) stageStarts.push({ phase, sequence });
    frames.push({
      sequence,
      at,
      actionText,
      state: structuredClone(state),
      ownerHoleCards: ownerHoleCards ? [...ownerHoleCards] : null,
    });
  }
  emit(0, row.startedAt, '本手开始前');
  for (const [index, e] of events.entries()) {
    if (index % 100 === 0) await checkpoint();
    validateEvent(e);
    if (
      e.handId !== row.handId ||
      e.sequence !== lastSequence + 1 ||
      e.handVersion < lastVersion ||
      e.handVersion > lastVersion + 1 ||
      e.handVersion > row.handVersion ||
      e.occurredAt < lastAt ||
      settled
    )
      invalid();
    lastSequence = e.sequence;
    lastVersion = e.handVersion;
    lastAt = e.occurredAt;
    state.handVersion = e.handVersion;
    const d = { ...(e.payload as object), kind: e.kind } as HandEventPayload;
    if (d.kind === 'cardBurned') continue;
    if (d.kind === 'holeDealt') {
      const p = player(d.seatId);
      if (e.ownerParticipantId !== p.participantId || dealt.has(d.seatId)) invalid();
      addCards(d.cards);
      dealt.set(d.seatId, [...d.cards]);
      p.hiddenCardCount = 2;
      if (p.participantId !== viewer) continue;
      ownerHoleCards = [...d.cards];
      emit(e.sequence, e.occurredAt, '你的底牌已发出');
      continue;
    }
    state.publicEventSequence = e.sequence;
    let text = '';
    switch (d.kind) {
      case 'handStarted':
        if (e.sequence !== 1) invalid();
        players = players.map((p) => ({ ...p, hiddenCardCount: 2 }));
        text = '本手开始';
        break;
      case 'blindPosted': {
        const p = player(d.seatId),
          expected = expectedBlinds.find((p) => p.seatId === d.seatId);
        if (!expected || blinds.has(d.seatId) || expected.streetCommitted !== d.amount) invalid();
        blinds.add(d.seatId);
        p.stack -= d.amount;
        p.streetCommitted += d.amount;
        p.handCommitted += d.amount;
        p.allIn = p.stack === 0;
        if (blinds.size === expectedBlinds.length) {
          round = beginBettingRound({
            street: 'preflop',
            bigBlind: 20,
            players,
            actionOrder: positions.preflopOrder,
          });
          merge(round.players);
          runout = getRoundOutcome(round) === 'runout';
        }
        text = '座位' + (d.seatId + 1) + ' 投入盲注 ' + d.amount;
        break;
      }
      case 'actionApplied': {
        if (!round || blinds.size !== expectedBlinds.length) invalid();
        const action: Action =
          d.actionType === 'bet' || d.actionType === 'raise'
            ? { type: d.actionType, raiseTo: d.raiseTo! }
            : { type: d.actionType };
        const next = applyBettingAction(round, d.seatId, action);
        if (!next.ok || next.effect.paidAmount !== d.paidAmount) invalid();
        const before = player(d.seatId).streetCommitted;
        round = next.state;
        merge(round.players);
        if (d.raiseTo !== null && before + d.paidAmount !== d.raiseTo) invalid();
        runout = getRoundOutcome(round) === 'runout';
        const names = {
          fold: '弃牌',
          check: '过牌',
          call: '跟注',
          bet: '下注',
          raise: '加注',
          allIn: '全押',
        };
        text =
          '座位' +
          (d.seatId + 1) +
          ' ' +
          names[d.actionType] +
          (d.paidAmount ? '，本次投入 ' + d.paidAmount : '');
        break;
      }
      case 'boardDealt': {
        const expected = d.street === 'flop' ? 0 : d.street === 'turn' ? 3 : 4;
        if (state.board.length !== expected || (!round && !runout)) invalid();
        addCards(d.cards);
        state.board.push(...d.cards);
        state.phase = d.street;
        if (!runout) {
          if (!round || getRoundOutcome(round) !== 'streetComplete') invalid();
          round = beginBettingRound({
            street: d.street,
            bigBlind: 20,
            players,
            actionOrder: positions.postflopOrder,
          });
          merge(round.players);
        } else round = null;
        text = { flop: '翻牌', turn: '转牌', river: '河牌' }[d.street] + '已公开';
        break;
      }
      case 'refunded': {
        const p = player(d.seatId);
        if (d.amount > p.handCommitted) invalid();
        p.stack += d.amount;
        p.handCommitted -= d.amount;
        p.streetCommitted -= Math.min(p.streetCommitted, d.amount);
        p.allIn = p.stack === 0;
        round = null;
        text = '座位' + (d.seatId + 1) + ' 返还未匹配下注 ' + d.amount;
        break;
      }
      case 'potsBuilt':
        state.pots = d.pots.map((p) => ({
          potId: p.potId,
          amount: p.amount,
          eligibleParticipantIds: p.eligibleSeatIds.map((s) => player(s).participantId),
        }));
        round = null;
        text = '底池已分层';
        break;
      case 'showdownRevealed':
        state.phase = 'showdown';
        state.showdownCards = d.cards.map((c) => {
          const p = player(c.seatId);
          if (p.folded || JSON.stringify(dealt.get(c.seatId)) !== JSON.stringify(c.cards))
            invalid();
          p.hiddenCardCount = 0;
          return { participantId: p.participantId, cards: [...c.cards] as CardPair };
        });
        text = '摊牌已公开';
        break;
      case 'paidOut':
        if (
          !state.pots.some(
            (p) =>
              p.potId === d.potId &&
              p.eligibleParticipantIds.includes(player(d.seatId).participantId),
          )
        )
          invalid();
        if (
          paidKeys.has(d.potId + ':' + d.seatId) ||
          row.result?.pots
            .find((p) => p.potId === d.potId)
            ?.allocations.find((a) => a.participantId === player(d.seatId).participantId)
            ?.amount !== d.amount
        )
          invalid();
        paidKeys.add(d.potId + ':' + d.seatId);
        payouts.set(d.seatId, (payouts.get(d.seatId) ?? 0) + d.amount);
        continue;
      case 'handSettled': {
        if (
          row.status !== 'settled' ||
          !row.result ||
          row.result.reason !== d.reason ||
          JSON.stringify(state.board) !== JSON.stringify(row.result.board) ||
          JSON.stringify(state.showdownCards) !== JSON.stringify(row.result.showdownCards)
        )
          invalid();
        for (const p of players) {
          p.stack += payouts.get(p.seatId) ?? 0;
          p.handCommitted = 0;
          p.streetCommitted = 0;
          p.allIn = false;
          p.lastActedAtBet = null;
          if (
            row.result.finalStacks.find((f) => f.participantId === p.participantId)?.stack !==
            p.stack
          )
            invalid();
        }
        state.phase = 'settled';
        state.pots = [];
        round = null;
        settled = true;
        text = '本手结算完成';
        break;
      }
      default:
        invalid();
    }
    emit(e.sequence, e.occurredAt, text);
  }
  if (lastVersion !== row.handVersion || (row.status === 'settled' && !settled)) invalid();
  if (row.status === 'interrupted') {
    state.phase = 'interrupted';
    round = null;
    emit(lastSequence + 1, row.endedAt!, '本手已中止，无最终结算');
  }
  return { frames, stageStarts, result: row.result ? structuredClone(row.result) : null };
}
