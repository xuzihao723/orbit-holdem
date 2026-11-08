import { useEffect, useRef, useState } from 'react';
import type { Action, GameActionCommand } from '@orbit/protocol';
import { useNetwork } from '../../app/NetworkProvider';
import { canSubmitAction, sameActionKey, currentActionKey, type ActionKey } from './action-draft';
import { roomErrorMessage } from '../room/room-errors';
let confirmedSession: string | null = null;
let lastIdentity: string | null = null;
export function useTableActions(remaining: () => number | null) {
  const { client, snapshot } = useNetwork(),
    key = currentActionKey(snapshot),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState<{ key: ActionKey; action: Action; amount: number } | null>(
      null,
    ),
    [uncertain, setUncertain] = useState<{ key: ActionKey; payload: GameActionCommand } | null>(
      null,
    ),
    lock = useRef(false),
    acknowledged = useRef<ActionKey | null>(null),
    remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  useEffect(() => {
    const identity = snapshot.authContext?.sessionId ?? null;
    if (identity !== lastIdentity) {
      confirmedSession = null;
      lastIdentity = identity;
    }
  }, [snapshot.authContext?.sessionId]);
  const serialized = JSON.stringify(key);
  useEffect(() => {
    setConfirm((c) => (sameActionKey(c?.key ?? null, key) ? c : null));
    setUncertain((c) => (sameActionKey(c?.key ?? null, key) ? c : null));
  }, [serialized]); // Each permission field is encoded in the key.
  const valid = (draft: ActionKey | null) => {
    const current = currentActionKey(client.store.snapshot),
      ms = remainingRef.current();
    return (
      ms !== null &&
      ms > 0 &&
      canSubmitAction(
        draft,
        current,
        client.store.snapshot.controlReady,
        current ? current.deadline - ms : NaN,
      )
    );
  };
  const send = async (action: Action, draft: ActionKey, payload?: GameActionCommand) => {
    if (lock.current || sameActionKey(acknowledged.current, draft) || !valid(draft)) {
      setConfirm(null);
      return;
    }
    const view = client.store.snapshot.playerView;
    if (!view?.self.legalActions.allowed.includes(action.type)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setConfirm(null);
    const command = payload ?? {
      commandId: crypto.randomUUID(),
      roomId: draft.roomId,
      handId: draft.handId,
      turnId: draft.turnId,
      expectedVersion: draft.handVersion,
      action,
    };
    try {
      const ack = await client.sendCommand('game:action', command);
      if (!ack.ok) throw Error(ack.code);
      acknowledged.current = draft;
      setUncertain(null);
    } catch (e) {
      if (e instanceof Error && e.message === 'ACK_UNCERTAIN' && valid(draft))
        setUncertain({ key: draft, payload: command });
      setError(roomErrorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const submit = (action: Action) => {
    const draft = currentActionKey(client.store.snapshot),
      legal = client.store.snapshot.playerView?.self.legalActions;
    if (!draft || !valid(draft) || !legal?.allowed.includes(action.type) || uncertain) return;
    const allIn =
      action.type === 'allIn' || ('raiseTo' in action && action.raiseTo === legal.allIn?.raiseTo);
    if (allIn && confirmedSession !== draft.sessionId) {
      setConfirm({ key: draft, action, amount: legal.allIn?.additionalAmount ?? 0 });
      return;
    }
    void send(action, draft);
  };
  return {
    busy,
    error,
    confirm: confirm && valid(confirm.key) ? confirm : null,
    disabled:
      busy || !key || !valid(key) || !!uncertain || sameActionKey(acknowledged.current, key),
    submit,
    closeConfirm: () => setConfirm(null),
    confirmAllIn: () => {
      if (confirm && valid(confirm.key)) {
        confirmedSession = confirm.key.sessionId;
        void send(confirm.action, confirm.key);
      } else setConfirm(null);
    },
    retry:
      uncertain && valid(uncertain.key)
        ? () => void send(uncertain.payload.action, uncertain.key, uncertain.payload)
        : null,
  };
}
