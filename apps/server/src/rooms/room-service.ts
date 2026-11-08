import { publishPausedRoom } from '../game/publish.js';
import { prepareManagement } from './room-lifecycle.js';
import { prepareHandStart, type StartOptions } from './start-hand.js';
import { randomUUID } from 'node:crypto';
import type { CommandAck, CommandSuccess, SeatId } from '@orbit/protocol';
import type { PokerDatabase, LedgerInsert } from '../persistence/rows.js';
import type { RoomCommit, ParticipantRow, RoomRow, MatchRow } from '../persistence/domain-rows.js';
import { RoomCodeCollision } from '../persistence/room-commit.js';
import type { SessionRuntime } from '../sessions/session-types.js';
import type { AuthenticatedCommand, CommandExecutor } from '../transport/types.js';
import { commandFailure } from '../transport/errors.js';
import { RoomQueue } from '../game/room-queue.js';
import { systemClock, type ServerClock } from '../game/turn-timer.js';
import { commandDigest } from '../game/command-digest.js';
import { toReceipt, duplicateReceipt } from '../game/command-receipt.js';
import { RoomStore } from './room-store.js';
import { RoomError, nextVersion, type RoomState, type Publication } from './room-types.js';
import { createRoomCode } from './room-code.js';
import { projectRoomView, isSessionOnline } from './room-view.js';
export class RoomService implements CommandExecutor {
  readonly store = new RoomStore();
  readonly queue = new RoomQueue();
  readonly identities = {
    run: <T>(key: string, task: () => T | Promise<T>) =>
      this.queue.runKeys(['session:' + key], task),
  };
  constructor(
    readonly database: PokerDatabase,
    readonly sessions: SessionRuntime,
    readonly emit: (p: Publication) => void,
    readonly code: () => string = createRoomCode,
    readonly startOptions: StartOptions = {},
    readonly clock: ServerClock = systemClock(() => sessions.meta().serverTime),
  ) {
    this.removePresence = sessions.registry.onChange((sessionId, previous, current) => {
      if ((previous === null) === (current === null)) return;
      for (const room of this.store.all())
        if (
          room.row.status !== 'closed' &&
          room.participants.some((p) => p.sessionId === sessionId && p.leftAt === null)
        ) {
          void this.queue
            .run(room.row.roomId, () => {
              const state = this.store.get(room.row.roomId);
              if (!state || state.row.status === 'closed' || state.row.status === 'pausedFault')
                return;
              try {
                this.database.rooms.updatePresenceVersion(state.row.roomId, state.row.roomVersion);
                this.store.replace({
                  ...state,
                  row: { ...state.row, roomVersion: nextVersion(state.row.roomVersion) },
                });
              } catch {
                this.pause(state.row.roomId);
              }
              const latest = this.store.get(state.row.roomId)!;
              for (const p of latest.participants) {
                if (
                  p.leftAt !== null ||
                  p.sessionId === null ||
                  !sessions.canAccessSeat(latest.row.roomId, p.participantId)
                )
                  continue;
                const control = sessions.registry.getCurrent(p.sessionId);
                if (control && sessions.service.checkController(control).ok)
                  this.emit({
                    socketId: control.socketId,
                    event: 'room:view',
                    payload: projectRoomView(latest, sessions, sessions.meta()),
                  });
              }
            })
            .catch(() => {});
        }
    });
  }
  private readonly removePresence: () => void;
  protected success(c: AuthenticatedCommand, state: RoomState): CommandSuccess {
    return {
      ...this.sessions.meta(),
      commandId: c.payload.commandId,
      ok: true,
      duplicate: false,
      roomId: state.row.roomId,
      appliedRoomVersion: state.row.roomVersion,
      handId: null,
      appliedHandVersion: null,
    };
  }
  protected check(c: AuthenticatedCommand) {
    const r = this.sessions.service.checkController(c.control);
    if (!r.ok) throw new RoomError(r.reason);
  }
  private prior(c: AuthenticatedCommand): CommandAck | null {
    const r = this.database.repositories.findReceipt(
      'session:' + c.control.sessionId,
      c.payload.commandId,
    );
    if (!r) return null;
    if (r.payloadHash !== commandDigest(c.event, c.payload))
      throw new RoomError('COMMAND_ID_CONFLICT');
    return duplicateReceipt(r, this.sessions.meta());
  }
  protected receiptOnly(c: AuthenticatedCommand, ack: CommandAck) {
    this.database.repositories.commitAppliedCommand({
      events: [],
      receipt: toReceipt(c, ack),
      handVersionUpdate: null,
    });
    return ack;
  }
  protected commit(
    c: AuthenticatedCommand,
    before: RoomState | null,
    after: RoomState,
    ledger: readonly LedgerInsert[],
    matchWrites: readonly MatchRow[] = [after.match],
  ) {
    const ack = this.success(c, after),
      batch: RoomCommit = {
        expectedRoomVersion: before?.row.roomVersion ?? null,
        room: after.row,
        participantWrites: after.participants,
        matchWrites,
        ledger,
        receipt: toReceipt(c, ack),
      };
    this.database.rooms.commitRoomChange(batch);
    this.store.replace(after);
    this.committed(before, after);
    return ack;
  }
  protected ledger(
    c: AuthenticatedCommand,
    p: ParticipantRow,
    matchId: string,
    type: LedgerInsert['type'],
    delta: number,
  ): LedgerInsert {
    return {
      entryId: randomUUID(),
      roomId: p.roomId,
      matchId,
      participantId: p.participantId,
      type,
      delta,
      reason: type,
      occurredAt: this.sessions.meta().serverTime,
      sourceActorScope: 'session:' + c.control.sessionId,
      sourceCommandId: c.payload.commandId,
      sourceSystemEventId: null,
    };
  }
  async execute(c: AuthenticatedCommand): Promise<CommandAck> {
    let target: RoomState | null = null;
    const id =
      c.event === 'room:create'
        ? undefined
        : c.event === 'room:join'
          ? this.store.findCode(c.payload.roomCode)?.row.roomId
          : c.payload.roomId;
    try {
      return await this.queue.runKeys(
        ['session:' + c.control.sessionId, ...(id ? ['room:' + id] : [])],
        () => {
          this.check(c);
          const prior = this.prior(c);
          if (prior) return prior;
          if (c.event === 'room:create') return this.create(c);
          if (!id)
            return this.receiptOnly(
              c,
              commandFailure(
                this.sessions.meta(),
                c.payload,
                c.event === 'room:join' ? 'ROOM_NOT_FOUND' : 'ROOM_FORBIDDEN',
              ),
            );
          this.check(c);
          target = this.store.get(id);
          try {
            if (
              !target ||
              target.row.status === 'closed' ||
              target.row.serverEpoch !== this.sessions.serverEpoch
            )
              throw new RoomError(c.event === 'room:join' ? 'ROOM_NOT_FOUND' : 'ROOM_FORBIDDEN');
            const member = target.participants.find(
              (p) => p.sessionId === c.control.sessionId && p.leftAt === null,
            );
            if (c.event !== 'room:join' && !member) throw new RoomError('ROOM_FORBIDDEN');
            if (member && !this.sessions.canAccessSeat(target.row.roomId, member.participantId))
              throw new RoomError('ROOM_FORBIDDEN');
            if (target.row.status === 'pausedFault') throw new RoomError('ROOM_PAUSED');
            return this.apply(c, target, member ?? null);
          } catch (error) {
            if (
              error instanceof RoomError &&
              error.code === 'ROOM_PAUSED' &&
              target?.row.status !== 'pausedFault'
            ) {
              this.pause(id);
              target = this.store.get(id);
            }
            if (error instanceof RoomError && error.code !== 'COMMAND_ID_CONFLICT') {
              let ack = commandFailure(this.sessions.meta(), c.payload, error.code);
              if (
                target &&
                target.participants.some(
                  (p) => p.sessionId === c.control.sessionId && p.leftAt === null,
                ) &&
                error.code !== 'ROOM_FORBIDDEN'
              )
                ack = {
                  ...ack,
                  roomId: target.row.roomId,
                  latestRoomVersion: target.row.roomVersion,
                  handId: target.hand?.handId ?? null,
                  latestHandVersion: target.hand?.handVersion ?? null,
                };
              try {
                return this.receiptOnly(c, ack);
              } catch {
                this.pause(id);
                return commandFailure(this.sessions.meta(), c.payload, 'PERSISTENCE_UNAVAILABLE');
              }
            }
            if (!(error instanceof RoomError)) this.pause(id);
            return commandFailure(
              this.sessions.meta(),
              c.payload,
              error instanceof RoomError ? error.code : 'PERSISTENCE_UNAVAILABLE',
            );
          }
        },
      );
    } catch (error) {
      return commandFailure(
        this.sessions.meta(),
        c.payload,
        error instanceof RoomError ? error.code : 'PERSISTENCE_UNAVAILABLE',
      );
    }
  }
  protected create(c: Extract<AuthenticatedCommand, { event: 'room:create' }>): CommandAck {
    for (let attempt = 0; attempt < 10; attempt++) {
      const now = this.sessions.meta().serverTime,
        roomId = randomUUID(),
        matchId = randomUUID(),
        participantId = randomUUID();
      const row: RoomRow = {
        roomId,
        roomCode: this.code(),
        capacity: c.payload.capacity,
        status: 'waiting',
        roomVersion: 1,
        serverEpoch: this.sessions.serverEpoch,
        hostParticipantId: participantId,
        matchId,
        currentHandId: null,
        createdAt: now,
        closedAt: null,
        resetProposal: null,
      };
      const p: ParticipantRow = {
        participantId,
        roomId,
        sessionId: c.control.sessionId,
        botId: null,
        seatId: 0,
        nickname: c.payload.nickname,
        stack: 2000,
        admission: 'active',
        joinedAt: now,
        leftAt: null,
        ready: false,
        botDifficulty: null,
      };
      const state: RoomState = {
        row,
        participants: [p],
        match: {
          matchId,
          roomId,
          status: 'active',
          lastBigBlindSeatId: null,
          startedAt: now,
          endedAt: null,
        },
        hand: null,
        previous: null,
        publicEventSequence: 0,
      };
      try {
        return this.commit(c, null, state, [this.ledger(c, p, matchId, 'seat_grant', 2000)]);
      } catch (error) {
        if (error instanceof RoomCodeCollision && attempt < 9) continue;
        throw error;
      }
    }
    throw new RoomError('PERSISTENCE_UNAVAILABLE');
  }
  protected apply(
    c: AuthenticatedCommand,
    state: RoomState,
    member: ParticipantRow | null,
  ): CommandAck {
    if (c.event === 'room:join') {
      if (member) return this.receiptOnly(c, this.success(c, state));
      const current = state.participants.filter((p) => p.leftAt === null);
      if (current.length >= state.row.capacity) throw new RoomError('ROOM_FULL');
      const seatId = ([0, 1, 2, 3] as const).find((s) => !current.some((p) => p.seatId === s))!,
        waiting = state.row.status === 'playing';
      const p: ParticipantRow = {
        participantId: randomUUID(),
        roomId: state.row.roomId,
        sessionId: c.control.sessionId,
        botId: null,
        seatId,
        nickname: c.payload.nickname,
        stack: waiting ? 0 : 2000,
        admission: waiting ? 'waitingNextHand' : 'active',
        joinedAt: this.sessions.meta().serverTime,
        leftAt: null,
        ready: false,
        botDifficulty: null,
      };
      const next: RoomState = {
        ...state,
        row: { ...state.row, roomVersion: nextVersion(state.row.roomVersion) },
        participants: [...state.participants.map((p) => ({ ...p, ready: false })), p],
        joinedPublicSequences: {
          ...state.joinedPublicSequences,
          [p.participantId]: state.publicEventSequence,
        },
      };
      return this.commit(
        c,
        state,
        next,
        waiting ? [] : [this.ledger(c, p, state.match.matchId, 'seat_grant', 2000)],
      );
    }
    if (c.event === 'room:leave' && member) {
      if (
        state.row.status === 'playing' &&
        state.hand?.players.some((p) => p.participantId === member.participantId)
      )
        throw new RoomError('HAND_IN_PROGRESS');
      const remaining = state.participants.filter(
          (p) => p.leftAt === null && p.participantId !== member.participantId,
        ),
        closed = remaining.length === 0;
      const host =
        state.row.hostParticipantId === member.participantId
          ? ([...remaining]
              .filter((p) => p.sessionId !== null && isSessionOnline(this.sessions, p.sessionId))
              .sort(
                (a, b) => a.joinedAt - b.joinedAt || a.participantId.localeCompare(b.participantId),
              )[0]?.participantId ?? null)
          : state.row.hostParticipantId;
      const next: RoomState = {
        ...state,
        row: {
          ...state.row,
          hostParticipantId: host,
          resetProposal: null,
          roomVersion: nextVersion(state.row.roomVersion),
          status: closed ? 'closed' : state.row.status,
          closedAt: closed ? this.sessions.meta().serverTime : null,
        },
        participants: state.participants.map((p) =>
          p.participantId === member.participantId
            ? { ...p, stack: 0, leftAt: this.sessions.meta().serverTime, ready: false }
            : { ...p, ready: false },
        ),
      };
      return this.commit(
        c,
        state,
        next,
        member.stack
          ? [this.ledger(c, member, state.match.matchId, 'seat_cashout', -member.stack)]
          : [],
      );
    }
    if (c.event === 'room:start') {
      const x = prepareHandStart(c, state, this.sessions, this.startOptions),
        ack = {
          ...this.success(c, x.state),
          handId: x.hand.handId,
          appliedHandVersion: x.hand.handVersion,
        };
      const ledger = x.ledger.map((e) =>
        this.ledger(
          c,
          x.state.participants.find((p) => p.participantId === e.participantId)!,
          e.matchId,
          e.type,
          e.delta,
        ),
      );
      this.database.hands.commitHandStart({
        expectedRoomVersion: state.row.roomVersion,
        room: x.state.row,
        participantWrites: x.state.participants,
        matchWrites: x.matchWrites,
        ledger,
        receipt: toReceipt(c, ack),
        hand: x.hand,
        events: x.events,
      });
      this.store.replace(x.state);
      this.committed(state, x.state);
      return ack;
    }
    if (member) {
      const x = prepareManagement(c, state, member, this.sessions.meta().serverTime);
      if (!x.changed) return this.receiptOnly(c, this.success(c, state));
      const ledger = x.ledger.map((e) =>
        this.ledger(
          c,
          x.state.participants.find((p) => p.participantId === e.participantId)!,
          e.matchId,
          e.type,
          e.delta,
        ),
      );
      return this.commit(c, state, x.state, ledger);
    }
    throw new RoomError('INVALID_INPUT');
  }
  afterAck(c: AuthenticatedCommand, ack: CommandAck) {
    if (!ack.roomId) return;
    const state = this.store.get(ack.roomId);
    if (!state) return;
    for (const p of state.participants) {
      if (
        p.leftAt !== null ||
        p.sessionId === null ||
        !this.sessions.canAccessSeat(state.row.roomId, p.participantId) ||
        (!ack.ok && p.sessionId !== c.control.sessionId)
      )
        continue;
      const control = this.sessions.registry.getCurrent(p.sessionId);
      if (!control || !this.sessions.service.checkController(control).ok) continue;
      this.emit({
        socketId: control.socketId,
        event: 'room:view',
        payload: projectRoomView(state, this.sessions, this.sessions.meta()),
      });
    }
  }
  protected pause(id: string) {
    this.pauseForFault(id);
  }
  pauseForFault(id: string) {
    const state = this.store.get(id);
    if (!state || state.row.status === 'pausedFault') return;
    this.store.replace({
      ...state,
      turnClock: null,
      row: {
        ...state.row,
        status: 'pausedFault',
        roomVersion:
          state.row.roomVersion === Number.MAX_SAFE_INTEGER
            ? state.row.roomVersion
            : nextVersion(state.row.roomVersion),
      },
    });
    this.committed(state, this.store.get(id)!);
    publishPausedRoom(this.store.get(id)!, this.sessions, this.emit);
  }
  protected committed(_before: RoomState | null, _after: RoomState): void {}
  async close() {
    this.removePresence();
    await this.queue.close();
    this.store.clear();
  }
}
