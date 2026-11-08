import type { SessionRuntime } from '../sessions/session-types.js';
export function isSessionOnline(sessions: SessionRuntime, sessionId: string): boolean {
  const c = sessions.registry.getCurrent(sessionId);
  if (!c) return false;
  try {
    return sessions.service.checkController(c).ok;
  } catch {
    return false;
  }
}
