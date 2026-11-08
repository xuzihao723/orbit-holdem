import type { TablePreview } from './table-preview.types';
import TableSurface from './TableSurface';
import ActionBar from './ActionBar';
export default function TableScene({ table }: { table: TablePreview }) {
  const player = table.hand.players.find((p) => p.seatId === table.viewerSeatId);
  const legal =
    table.connection === 'connected' &&
    table.hand.actorSeatId === table.viewerSeatId &&
    !player?.folded &&
    !player?.allIn
      ? (table.self?.legalActions ?? null)
      : null;
  return (
    <>
      <TableSurface
        {...table}
        seats={table.room.seats.flatMap((s) =>
          s.occupant ? [{ ...s.occupant, seatId: s.seatId }] : [],
        )}
      />
      {!table.live && <ActionBar legal={legal} message="灰盒预览，暂不可操作" />}
    </>
  );
}
