import type { CardId } from '@orbit/protocol';
import PlayingCard from '../components/cards/PlayingCard';
import CardBack from '../components/cards/CardBack';
import CardSlot from '../components/cards/CardSlot';
import { cardArt } from '../components/cards/card-art';
export default function CardCatalogPage() {
  return (
    <main className="app-page" data-preview-source="W33_DEV_CARD_CATALOG_ONLY">
      <h1>52张牌组校对</h1>
      <a href="/">返回首页</a>
      {(['standard', 'four'] as const).map((mode) => (
        <section key={mode} data-suit-theme={mode}>
          <h2>{mode === 'four' ? '四色' : '标准'}</h2>
          {[50, 70, 90].map((width) => (
            <div
              className="component-catalog"
              key={width}
              style={
                {
                  '--card-width': width + 'px',
                  '--card-height': width * 1.4 + 'px',
                } as React.CSSProperties
              }
            >
              {(Object.keys(cardArt) as CardId[]).map((card) => (
                <figure key={card}>
                  <PlayingCard card={card} />
                  <figcaption>{card}</figcaption>
                </figure>
              ))}
              <CardBack />
              <CardSlot />
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
