import type { SessionResumed, ResumeBase, GuestResponse, ResumeResponse } from '@orbit/protocol';
import type {
  ResumeResolution,
  SessionService,
} from '../../apps/server/src/sessions/session-types.js';
function project(resolution: ResumeResolution, base: ResumeBase): SessionResumed {
  return { ...base, ...resolution };
}
const guest: (s: SessionService) => GuestResponse = (s) =>
  s.guest('socket', { requestId: '00000000-0000-4000-8000-000000000001', nickname: 'A' });
const resume: (s: SessionService) => Promise<ResumeResponse> = (s) =>
  s.resume('socket', {
    requestId: '00000000-0000-4000-8000-000000000001',
    resumeToken: 'invalid',
    roomId: null,
    lastSeenHandId: null,
    lastSeenRoomVersion: null,
    lastSeenHandVersion: null,
  });
void [project, guest, resume];
