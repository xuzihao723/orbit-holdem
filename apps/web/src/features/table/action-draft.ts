import type { ViewSnapshot } from '../../network/view-store';
export interface ActionKey {
  sessionId: string;
  participantId: string;
  serverEpoch: string;
  roomId: string;
  handId: string;
  turnId: string;
  handVersion: number;
  deadline: number;
}
const fields: readonly (keyof ActionKey)[] = [
  'sessionId',
  'participantId',
  'serverEpoch',
  'roomId',
  'handId',
  'turnId',
  'handVersion',
  'deadline',
];
export function sameActionKey(a: ActionKey | null, b: ActionKey | null): boolean {
  return !!a && !!b && fields.every((k) => a[k] === b[k]);
}
export function canSubmitAction(
  draft: ActionKey | null,
  current: ActionKey | null,
  controlReady: boolean,
  serverNow: number,
): boolean {
  return (
    controlReady &&
    Number.isFinite(serverNow) &&
    sameActionKey(draft, current) &&
    serverNow < current!.deadline
  );
}

export function currentActionKey(s: Readonly<ViewSnapshot>): ActionKey | null {
  const v = s.playerView,
    a = s.authContext;
  if (
    !s.controlReady ||
    !v ||
    !a ||
    a.participantId !== v.self.participantId ||
    v.handId !== s.roomView?.currentHandId ||
    !v.turnId ||
    v.deadline === null
  )
    return null;
  const p = v.players.find((p) => p.participantId === a.participantId);
  if (!p || p.folded || p.allIn || p.seatId !== v.actorSeatId || v.self.admission !== 'active')
    return null;
  return {
    sessionId: a.sessionId,
    participantId: a.participantId!,
    serverEpoch: v.serverEpoch,
    roomId: v.roomId,
    handId: v.handId,
    turnId: v.turnId,
    handVersion: v.handVersion,
    deadline: v.deadline,
  };
}
