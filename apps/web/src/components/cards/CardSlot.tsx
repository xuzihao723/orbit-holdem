export default function CardSlot({ compact = false }: { compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label="待发公共牌"
      className={compact ? 'card-slot compact-slot' : 'card-slot'}
    >
      {compact ? (
        <span aria-hidden="true">✧</span>
      ) : (
        <span
          className="card-art"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: slotArt }}
        />
      )}
    </span>
  );
}
import { slotArt } from './card-art';
