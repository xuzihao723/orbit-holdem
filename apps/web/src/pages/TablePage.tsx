import type { TablePreview } from '../features/table/table-preview.types';
import TableScene from '../features/table/TableScene';
export default function TablePage({ table }: { table: TablePreview }) {
  return (
    <main className="table-page">
      <header className="table-heading">
        <div>
          <p className="eyebrow">ORBIT / 牌桌</p>
          <h1>一手之间。</h1>
        </div>
        <div className="table-meta">
          <span>示例 {table.room.roomCode}</span>
          <span>
            {table.hand.players.length}人参与 / 容量{table.room.capacity}
          </span>
        </div>
      </header>
      <TableScene table={table} />
    </main>
  );
}
