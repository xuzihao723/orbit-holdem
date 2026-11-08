import type { CardId, Suit } from '@orbit/protocol';
import type { PointerEvent } from 'react';
import { cardArt } from './card-art';
const suits: Record<Suit, { symbol: string; name: string; red: boolean }> = {
  S: { symbol: '♠', name: '黑桃', red: false },
  H: { symbol: '♥', name: '红桃', red: true },
  C: { symbol: '♣', name: '梅花', red: false },
  D: { symbol: '♦', name: '方块', red: true },
};
function trackPointer(event: PointerEvent<HTMLSpanElement>) {
  if (event.pointerType !== 'mouse') return;
  const face = event.currentTarget;
  const bounds = face.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  face.style.setProperty('--pointer-x', x * 100 + '%');
  face.style.setProperty('--pointer-y', y * 100 + '%');
  face.style.setProperty('--tilt-x', (0.5 - y) * 14 + 'deg');
  face.style.setProperty('--tilt-y', (x - 0.5) * 14 + 'deg');
}

export default function PlayingCard({
  card,
  compact = false,
  fluid = false,
}: {
  card: CardId;
  compact?: boolean;
  fluid?: boolean;
}) {
  const suit = card.slice(-1) as Suit;
  const rank = card.slice(0, -1);
  const info = suits[suit];
  const compactFace = !import.meta.env.DEV || compact;
  return (
    <span
      role="img"
      aria-label={info.name + rank}
      data-suit={suit}
      className={`playing-card ${info.red ? 'red' : 'dark'}${compactFace ? ' compact-card' : ''}${fluid ? ' fluid-card' : ''}`}
      onPointerMove={fluid ? trackPointer : undefined}
    >
      {compactFace ? (
        <span className="compact-face" aria-hidden="true">
          <b>
            {rank}
            <small>{info.symbol}</small>
          </b>
          <span>{info.symbol}</span>
        </span>
      ) : (
        <span
          className="card-art"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: cardArt[card] }}
        />
      )}
    </span>
  );
}
