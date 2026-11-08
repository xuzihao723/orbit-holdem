import type {
  AppliedBatch,
  PersistenceRepositories,
  StoredSession,
} from '../../apps/server/src/persistence/rows.js';
import type { RoomView } from '@orbit/protocol';
function contracts(
  repository: PersistenceRepositories,
  batch: AppliedBatch,
  session: StoredSession,
) {
  // @ts-expect-error Transactions accept structured data, never asynchronous callbacks.
  repository.commitAppliedCommand(Promise.resolve(batch));
  // @ts-expect-error Database identity entities are not public room views.
  const view: RoomView = session;
  void view;
}
void contracts;
