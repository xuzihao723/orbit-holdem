export default function CardBack() {
  const p = usePreferences();
  return (
    <span role="img" aria-label="未公开底牌" className="card-back">
      <span
        className="card-art"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: backArt[p.cardBack] }}
      />
    </span>
  );
}
import { backArt } from './card-art';
import { usePreferences } from '../../settings/use-preferences';
