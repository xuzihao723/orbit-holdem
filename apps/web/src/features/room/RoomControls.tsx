import { useRef, useState } from 'react';
import type {
  RoomView,
  MutatingEventName,
  MutatingCommandMap,
  BotDifficulty,
  Capacity,
} from '@orbit/protocol';
import { useNetwork } from '../../app/NetworkProvider';
import { identifySelf } from './provision-room';
import { roomErrorMessage } from './room-errors';
export default function RoomControls({ room }: { room: RoomView }) {
  const { client, snapshot, router, intents, recovery } = useNetwork(),
    self = identifySelf(room, snapshot.authContext),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [difficulty, setDifficulty] = useState<BotDifficulty>('basic'),
    lock = useRef(false);
  const uncertain = Object.values(snapshot.pending).some((p) => p.status === 'uncertain'),
    blocked =
      busy ||
      uncertain ||
      !snapshot.controlReady ||
      !self ||
      room.status === 'closed' ||
      room.status === 'pausedFault',
    host = self?.participantId === room.hostParticipantId,
    boundary = room.status !== 'playing';
  const send = async <K extends MutatingEventName>(
    event: K,
    payload: Omit<MutatingCommandMap[K], 'commandId'>,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const ack = await client.sendCommand(event, {
        ...payload,
        commandId: crypto.randomUUID(),
      } as MutatingCommandMap[K]);
      if (!ack.ok) throw Error(ack.code);
      if (event === 'room:start') return;
      const r = await client.resume();
      if (!r.ok) throw Error(r.code);
      if (event === 'room:leave') {
        intents.clear();
        router.navigate('/');
      }
    } catch (e) {
      setError(roomErrorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const version = { roomId: room.roomId, expectedRoomVersion: room.roomVersion };
  return (
    <section className="room-controls" aria-label="房间操作" aria-busy={busy}>
      <div className="control-row">
        <button
          className={self?.kind === 'human' && self.ready ? undefined : 'primary'}
          disabled={blocked || !boundary || self?.admission === 'leaving'}
          onClick={() =>
            void send('room:ready', { ...version, ready: !(self?.kind === 'human' && self.ready) })
          }
        >
          {room.resetProposal
            ? self?.kind === 'human' && self.ready
              ? '取消同意'
              : '同意重新开场'
            : self?.kind === 'human' && self.ready
              ? '取消准备'
              : '准备'}
        </button>
        <button
          className="danger-action"
          disabled={blocked}
          onClick={() => void send('room:leave', { roomId: room.roomId })}
        >
          离开房间
        </button>
        <button
          className="primary"
          disabled={blocked || !host || !room.canStart}
          onClick={() => void send('room:start', version)}
        >
          开始本手
        </button>
      </div>
      {uncertain && (
        <div>
          <p role="status">操作结果尚未确认，请先恢复房间状态。</p>
          <button
            disabled={busy || !snapshot.controlReady}
            onClick={() => {
              setBusy(true);
              void client
                .resume()
                .then((r) => {
                  if (!r.ok) throw Error(r.code);
                  if (r.outcome !== 'seatRestored') router.navigate('/');
                })
                .catch((e) => setError(roomErrorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            恢复房间状态
          </button>
        </div>
      )}
      {error && (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          {!snapshot.controlReady && snapshot.status === 'authenticating' && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void recovery.start().finally(() => setBusy(false));
              }}
            >
              重试身份恢复
            </button>
          )}
        </div>
      )}
      {host && (
        <section className="host-controls" aria-label="房主管理">
          <h2>房主管理</h2>
          <p className="help-text">座位或容量变更后，所有真人需要重新准备。</p>
          <label>
            房间容量
            <select
              aria-label="房间容量"
              value={room.capacity}
              disabled={blocked || !boundary}
              onChange={(e) =>
                void send('room:capacity:set', {
                  ...version,
                  capacity: Number(e.target.value) as Capacity,
                })
              }
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}人容量
                </option>
              ))}
            </select>
          </label>
          <label>
            添加电脑难度
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}
              disabled={blocked || !boundary}
            >
              <option value="basic">入门</option>
              <option value="standard">标准</option>
            </select>
          </label>
          <div className="control-row">
            {room.seats.map((s) =>
              s.availability === 'open' ? (
                <button
                  key={s.seatId}
                  disabled={blocked || !boundary}
                  onClick={() =>
                    void send('room:bot:add', { ...version, seatId: s.seatId, difficulty })
                  }
                >
                  座位{s.seatId + 1}添加电脑
                </button>
              ) : s.occupant?.kind === 'bot' ? (
                <button
                  key={s.seatId}
                  disabled={blocked || !boundary}
                  onClick={() => void send('room:bot:remove', { ...version, seatId: s.seatId })}
                >
                  移除座位{s.seatId + 1}电脑
                </button>
              ) : null,
            )}
          </div>
          <button
            disabled={blocked || !boundary}
            onClick={() =>
              void send(room.resetProposal ? 'room:reset:cancel' : 'room:reset:propose', version)
            }
          >
            {room.resetProposal ? '取消重新开场' : '提议重新开场'}
          </button>
        </section>
      )}
    </section>
  );
}
