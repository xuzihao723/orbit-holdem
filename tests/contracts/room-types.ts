import type { RoomView } from '@orbit/protocol';
import type { RoomRow, ParticipantRow } from '../../apps/server/src/persistence/domain-rows.js';
import { projectRoomView } from '../../apps/server/src/rooms/room-view.js';
type Assert<T extends true> = T;
type NoSessionLeak = Assert<'sessionId' extends keyof RoomView ? false : true>;
function viewType(...args: Parameters<typeof projectRoomView>): RoomView {
  return projectRoomView(...args);
}
const types: readonly [NoSessionLeak, RoomRow | null, ParticipantRow | null] = [true, null, null];
void types;
void viewType;
