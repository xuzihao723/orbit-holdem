import type { CommandAck } from '@orbit/protocol';
import type { AuthenticatedCommand } from '../transport/types.js';
import type { ParticipantRow } from '../persistence/domain-rows.js';
import { RoomService } from '../rooms/room-service.js';
import { RoomError, type RoomState } from '../rooms/room-types.js';
import { prepareAction } from './action-candidate.js';
import { toReceipt } from './command-receipt.js';
import { getHandLegalActions } from '@orbit/poker-core';
import { TurnTimer, type TimeoutToken } from './turn-timer.js';
import { timeoutAction } from './timeout-policy.js';
import { commitActionCandidate } from './internal-action-handler.js';
import { commandDigest } from './command-digest.js';
import { publishGameState } from './publish.js';
import { publishPublicResult } from './publish.js';
import { projectPlayerView } from './player-view.js';
import { prepareBoundary, chooseHost } from '../rooms/hand-boundary.js';
import { internalRoomReceipt } from './internal-room-receipt.js';
import { nextVersion } from '../rooms/room-types.js';
import { randomUUID } from 'node:crypto';
import type { LedgerInsert } from '../persistence/rows.js';
import type { SeatReservation } from '../sessions/reservation-book.js';
import type { InternalBotAction } from '../bots/bot-types.js';
import { projectBotObservation } from '../bots/observation.js';
export class CommandHandler extends RoomService {
  private commitListeners = new Set<(state: RoomState) => void>();
  onCommitted(listener: (state: RoomState) => void) {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }
  private botsClosed = false;
  async executeBotAction(
    command: InternalBotAction,
    isCurrent: () => boolean = () => true,
  ): Promise<'applied' | 'duplicate' | 'stale' | 'paused'> {
    if (this.botsClosed) return 'stale';
    try {
      return await this.queue.run(command.roomId, () => {
        try {
          if (this.botsClosed || !isCurrent()) return 'stale' as const;
          const actorScope = 'bot:' + command.botId,
            commandId = 'bot:' + command.handId + ':' + command.turnId,
            hash = commandDigest('internal:bot', command),
            prior = this.database.repositories.findInternalReceipt(actorScope, commandId);
          if (prior) {
            if (prior.payloadHash !== hash) throw Error('BOT_COMMAND_ID_CONFLICT');
            return 'duplicate' as const;
          }
          const state = this.store.get(command.roomId),
            observation = state ? projectBotObservation(state, command.botId) : null;
          if (
            !state ||
            !observation ||
            observation.participantId !== command.participantId ||
            observation.handId !== command.handId ||
            observation.turnId !== command.turnId ||
            observation.handVersion !== command.expectedVersion ||
            observation.deadline !== command.deadline ||
            this.clock.now() >= observation.deadline
          )
            return 'stale' as const;
          const member = state.participants.find((p) => p.participantId === command.participantId)!,
            now = this.clock.now(),
            x = prepareAction(
              {
                payload: {
                  commandId,
                  roomId: command.roomId,
                  handId: command.handId,
                  turnId: command.turnId,
                  expectedVersion: command.expectedVersion,
                  action: command.action,
                },
                receivedAt: now,
              },
              state,
              member,
              now,
            ),
            receipt = {
              actorScope,
              commandId,
              payloadHash: hash,
              event: 'internal:bot',
              result: {
                kind: 'internalApplied',
                roomId: command.roomId,
                roomVersion: x.state.row.roomVersion,
                handId: command.handId,
                handVersion: x.state.hand!.handVersion,
              },
              roomId: command.roomId,
              appliedRoomVersion: x.state.row.roomVersion,
              handId: command.handId,
              appliedHandVersion: x.state.hand!.handVersion,
              createdAt: now,
            };
          commitActionCandidate(this.database, state, x, receipt, now);
          this.store.replace(x.state);
          this.committed(state, x.state);
          try {
            publishGameState(this.store.get(command.roomId)!, this.sessions, this.emit);
          } catch {
            /* Delivery cannot undo committed chips. */
          }
          return 'applied' as const;
        } catch (error) {
          if (
            error instanceof RoomError &&
            [
              'ILLEGAL_ACTION',
              'ILLEGAL_AMOUNT',
              'TURN_EXPIRED',
              'STALE_STATE',
              'HAND_MISMATCH',
            ].includes(error.code)
          )
            return 'stale' as const;
          this.pause(command.roomId);
          return 'paused' as const;
        }
      });
    } catch {
      if (this.botsClosed) return 'stale';
      this.pause(command.roomId);
      return 'paused';
    }
  }
  private readonly timers = new TurnTimer(
    this.clock,
    (t) => this.executeTimeout(t),
    (id) => this.pause(id),
  );
  protected override committed(_before: RoomState | null, after: RoomState) {
    this.timers.sync(after);
    if (
      after.hand?.phase === 'settled' &&
      after.row.status !== 'pausedFault' &&
      _before?.hand?.phase !== 'settled'
    )
      this.boundaryNow(after.row.roomId);
    const latest = this.store.get(after.row.roomId);
    if (latest?.row.status === 'playing' && latest.turnClock) {
      const p = latest.participants.find(
        (p) => p.participantId === latest.turnClock!.actorParticipantId,
      );
      if (p?.admission === 'leaving')
        void this.executeLeaveFold({ ...latest.turnClock, roomId: latest.row.roomId }).catch(() =>
          this.pause(latest.row.roomId),
        );
    }
    if (latest)
      for (const listener of this.commitListeners) {
        try {
          listener(latest);
        } catch {
          /* Post-commit observers cannot undo storage. */
        }
      }
  }
  protected boundaryCandidate(state: RoomState, now: number) {
    return prepareBoundary(state, this.sessions, now);
  }
  private systemLedger(
    state: RoomState,
    e: { participantId: string; matchId: string; type: LedgerInsert['type']; delta: number },
    commandId: string,
  ): LedgerInsert {
    return {
      ...e,
      entryId: randomUUID(),
      roomId: state.row.roomId,
      reason: e.type,
      occurredAt: this.clock.now(),
      sourceActorScope: 'system:' + state.row.roomId,
      sourceCommandId: commandId,
      sourceSystemEventId: null,
    };
  }
  private boundaryNow(roomId: string): 'applied' | 'duplicate' | 'stale' | 'paused' {
    let state = this.store.get(roomId);
    const failedRoomVersion = state?.boundaryPending ? state.row.roomVersion : null;
    if (state?.boundaryPending) {
      const persisted = this.database.rooms.readRoom(roomId);
      if (persisted)
        state = {
          ...state,
          row: persisted.room,
          participants: state.participants.map(
            (p) => persisted.participants.find((q) => q.participantId === p.participantId) ?? p,
          ),
          match: persisted.matches.find((m) => m.matchId === persisted.room.matchId)!,
        };
    }
    if (!state?.hand || state.hand.phase !== 'settled') return 'stale';
    const commandId = 'boundary:' + state.hand.handId;
    try {
      if (this.database.repositories.findInternalReceipt('system:' + roomId, commandId))
        return 'duplicate';
      const now = this.clock.now(),
        x = this.boundaryCandidate(state, now),
        recovered =
          failedRoomVersion === null
            ? x.state
            : { ...x.state, row: { ...x.state.row, roomVersion: nextVersion(failedRoomVersion) } },
        receipt = internalRoomReceipt(
          recovered,
          'internal:boundary',
          commandId,
          { roomId, handId: state.hand.handId },
          now,
        );
      this.database.commitBoundary({
        failedRoomVersion,
        expectedRoomVersion: state.row.roomVersion,
        room: recovered.row,
        participantWrites: x.state.participants,
        matchWrites: [x.state.match],
        ledger: x.ledger.map((e) => this.systemLedger(state, e, commandId)),
        receipt,
      });
      this.store.replace(recovered);
      this.timers.sync(recovered);
      return 'applied';
    } catch {
      this.store.replace({ ...state, boundaryPending: true });
      this.pause(roomId);
      return 'paused';
    }
  }
  executeBoundary(roomId: string) {
    return this.queue.run(roomId, () => {
      const result = this.boundaryNow(roomId);
      if (result === 'applied') {
        const state = this.store.get(roomId);
        if (state) {
          this.committed(state, state);
          publishGameState(state, this.sessions, this.emit);
        }
      }
      return result;
    });
  }
  private departureState(state: RoomState, member: ParticipantRow): RoomState {
    return {
      ...state,
      participants: state.participants.map((p) => ({
        ...p,
        ready: false,
        ...(p.participantId === member.participantId ? { admission: 'leaving' as const } : {}),
      })),
      row: { ...state.row, resetProposal: null, roomVersion: nextVersion(state.row.roomVersion) },
    };
  }
  private leaveAction(state: RoomState, member: ParticipantRow, now: number) {
    const marked = this.departureState(state, member);
    const x = prepareAction(
      {
        payload: {
          commandId: 'unused',
          roomId: state.row.roomId,
          handId: state.hand!.handId,
          turnId: state.hand!.turnId!,
          expectedVersion: state.hand!.handVersion,
          action: { type: 'fold' },
        },
        receivedAt: now,
      },
      marked,
      marked.participants.find((p) => p.participantId === member.participantId)!,
      now,
      'leave',
    );
    return {
      ...x,
      state: {
        ...x.state,
        row: { ...x.state.row, roomVersion: nextVersion(state.row.roomVersion) },
      },
    };
  }
  executeLeaveFold(token: TimeoutToken) {
    return this.queue.run(token.roomId, () => {
      const state = this.store.get(token.roomId),
        member = state?.participants.find((p) => p.participantId === token.actorParticipantId);
      if (
        !state ||
        state.row.status !== 'playing' ||
        !member ||
        member.leftAt !== null ||
        member.admission !== 'leaving' ||
        state.hand?.handId !== token.handId ||
        state.hand.turnId !== token.turnId ||
        state.hand.handVersion !== token.handVersion
      )
        return 'stale';
      try {
        const now = this.clock.now(),
          x = this.leaveAction(state, member, now),
          id = 'leave-fold:' + token.handId + ':' + token.turnId,
          receipt = internalRoomReceipt(x.state, 'internal:leaveFold', id, token, now);
        commitActionCandidate(this.database, state, x, receipt, now);
        this.store.replace(x.state);
        this.committed(state, x.state);
        publishGameState(this.store.get(token.roomId)!, this.sessions, this.emit);
        return 'applied';
      } catch {
        this.pause(token.roomId);
        return 'paused';
      }
    });
  }
  executeReservationExpiry(token: SeatReservation, isCurrent: () => boolean) {
    return this.queue.run(token.roomId, () => {
      if (!isCurrent()) return 'stale';
      const prior = this.database.repositories.findInternalReceipt(
        'system:' + token.roomId,
        'expiry:' +
          token.participantId +
          ':' +
          token.disconnectGeneration +
          ':' +
          token.reserveUntil,
      );
      if (prior) {
        if (prior.payloadHash !== commandDigest('internal:expiry', token)) {
          this.pause(token.roomId);
          return 'paused';
        }
        return 'duplicate';
      }
      const state = this.store.get(token.roomId),
        member = state?.participants.find(
          (p) => p.participantId === token.participantId && p.leftAt === null,
        );
      if (
        !state ||
        !member ||
        state.row.status === 'closed' ||
        state.row.status === 'pausedFault' ||
        this.clock.now() < token.reserveUntil
      )
        return 'stale';
      try {
        const now = this.clock.now(),
          id =
            'expiry:' +
            token.participantId +
            ':' +
            token.disconnectGeneration +
            ':' +
            token.reserveUntil,
          marked = this.departureState(state, member),
          inHand =
            state.row.status === 'playing' &&
            state.hand?.players.some((p) => p.participantId === member.participantId);
        let next: RoomState = marked;
        const ledger: LedgerInsert[] = [];
        if (!inHand) {
          next = {
            ...marked,
            participants: marked.participants.map((p) =>
              p.participantId === member.participantId ? { ...p, stack: 0, leftAt: now } : p,
            ),
          };
          if (member.stack)
            ledger.push(
              this.systemLedger(
                state,
                {
                  participantId: member.participantId,
                  matchId: state.match.matchId,
                  type: 'seat_cashout',
                  delta: -member.stack,
                },
                id,
              ),
            );
          const humans = next.participants.some((p) => p.leftAt === null && p.sessionId !== null);
          if (!humans) next = { ...next, row: { ...next.row, status: 'closed', closedAt: now } };
        }
        next = {
          ...next,
          row: { ...next.row, hostParticipantId: chooseHost(next, this.sessions) },
        };
        const receipt = internalRoomReceipt(next, 'internal:expiry', id, token, now);
        this.database.rooms.commitRoomChange({
          expectedRoomVersion: state.row.roomVersion,
          room: next.row,
          participantWrites: next.participants,
          matchWrites: [next.match],
          ledger,
          receipt,
        });
        this.store.replace(next);
        this.committed(state, next);
        publishGameState(this.store.get(token.roomId)!, this.sessions, this.emit);
        return 'applied';
      } catch {
        this.pause(token.roomId);
        return 'paused';
      }
    });
  }
  async executeTimeout(token: TimeoutToken): Promise<'applied' | 'duplicate' | 'stale' | 'paused'> {
    return this.queue.run(token.roomId, () => {
      try {
        const actorScope = 'system:' + token.roomId,
          commandId = 'timeout:' + token.handId + ':' + token.turnId;
        const expectedHash = commandDigest('internal:timeout', token),
          prior = this.database.repositories.findInternalReceipt(actorScope, commandId);
        if (prior) {
          if (prior.payloadHash !== expectedHash) throw Error('INTERNAL_COMMAND_ID_CONFLICT');
          return 'duplicate';
        }
        const state = this.store.get(token.roomId),
          clock = state?.turnClock;
        if (
          !state ||
          state.row.status !== 'playing' ||
          !clock ||
          clock.handId !== token.handId ||
          clock.turnId !== token.turnId ||
          clock.handVersion !== token.handVersion ||
          clock.actorParticipantId !== token.actorParticipantId ||
          clock.deadline !== token.deadline ||
          this.clock.now() < clock.deadline
        )
          return 'stale';
        const member = state.participants.find(
          (p) => p.participantId === clock.actorParticipantId && p.leftAt === null,
        );
        if (!member) throw Error('MISSING_TIMEOUT_ACTOR');
        const action =
          member.admission === 'leaving'
            ? { type: 'fold' as const }
            : timeoutAction(getHandLegalActions(state.hand!, member.seatId));
        if (!action) return 'stale';
        const now = this.clock.now(),
          payload = {
            commandId,
            roomId: token.roomId,
            handId: token.handId,
            turnId: token.turnId,
            expectedVersion: token.handVersion,
            action,
          };
        const x = prepareAction(
          { payload, receivedAt: now },
          state,
          member,
          now,
          member.admission === 'leaving' ? 'leave' : 'timeout',
        );
        const receipt = {
          actorScope,
          commandId,
          payloadHash: expectedHash,
          event: 'internal:timeout',
          result: {
            kind: 'internalApplied',
            roomId: token.roomId,
            roomVersion: x.state.row.roomVersion,
            handId: token.handId,
            handVersion: x.state.hand!.handVersion,
          },
          roomId: token.roomId,
          appliedRoomVersion: x.state.row.roomVersion,
          handId: token.handId,
          appliedHandVersion: x.state.hand!.handVersion,
          createdAt: now,
        };
        commitActionCandidate(this.database, state, x, receipt, now);
        this.store.replace(x.state);
        this.committed(state, x.state);
        try {
          publishGameState(this.store.get(token.roomId)!, this.sessions, this.emit);
        } catch {
          /* Notifications cannot undo a commit. */
        }
        return 'applied';
      } catch {
        this.pause(token.roomId);
        return 'paused';
      }
    });
  }
  override async close() {
    this.botsClosed = true;
    this.commitListeners.clear();
    this.timers.close();
    await super.close();
  }

  protected override apply(
    c: AuthenticatedCommand,
    state: RoomState,
    member: ParticipantRow | null,
  ): CommandAck {
    if (
      c.event === 'room:leave' &&
      member &&
      state.row.status === 'playing' &&
      state.hand?.players.some((p) => p.participantId === member.participantId)
    ) {
      if (member.admission === 'leaving') return this.receiptOnly(c, this.success(c, state));
      const player = state.hand.players.find((p) => p.participantId === member.participantId)!;
      if (player.seatId === state.hand.betting?.actorSeatId && !player.allIn && !player.folded) {
        const now = this.clock.now(),
          x = this.leaveAction(state, member, now),
          ack = {
            ...this.success(c, x.state),
            handId: x.state.hand!.handId,
            appliedHandVersion: x.state.hand!.handVersion,
          };
        commitActionCandidate(this.database, state, x, toReceipt(c, ack), now);
        this.store.replace(x.state);
        this.committed(state, x.state);
        return ack;
      }
      return this.commit(c, state, this.departureState(state, member), []);
    }
    if (member?.admission === 'leaving') throw new RoomError('ROOM_FORBIDDEN');
    if (c.event !== 'game:action') return super.apply(c, state, member);
    if (!member) throw new RoomError('ROOM_FORBIDDEN');
    const now = this.sessions.meta().serverTime,
      x = prepareAction(c, state, member, now),
      hand = x.state.hand!;
    const ack = {
      ...this.success(c, x.state),
      handId: hand.handId,
      appliedHandVersion: hand.handVersion,
    };
    commitActionCandidate(this.database, state, x, toReceipt(c, ack), now);
    this.store.replace(x.state);
    this.committed(state, x.state);
    return ack;
  }
  override afterAck(c: AuthenticatedCommand, ack: CommandAck) {
    super.afterAck(c, ack);
    if (ack.roomId) {
      const state = this.store.get(ack.roomId);
      if (state)
        for (const p of state.participants) {
          if (
            p.leftAt !== null ||
            p.sessionId === null ||
            (!ack.ok && p.sessionId !== c.control.sessionId)
          )
            continue;
          const control = this.sessions.registry.getCurrent(p.sessionId);
          if (!control) continue;
          const view = projectPlayerView(state, this.sessions, control);
          if (view) this.emit({ socketId: control.socketId, event: 'game:view', payload: view });
        }
    }
    if (!ack.ok || !ack.handId) return;
    const state = this.store.get(ack.roomId);
    if (state?.hand?.handId === ack.handId && state.hand.result)
      publishPublicResult(state, this.sessions, this.emit);
  }
}
