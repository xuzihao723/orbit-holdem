import { renderCenter } from '../../../../scripts/lib/card-components';
import type { Rank, Suit } from '@orbit/protocol';
export default function CardComponentPage() {
  return (
    <main className="app-page" data-preview-source="W32_DEV_COMPONENTS_ONLY">
      <h1>完整卡面构件校对</h1>
      <a href="/">返回首页</a>
      {(['standard', 'four'] as const).map((mode) => (
        <section key={mode} data-suit-theme={mode}>
          <h2>{mode === 'four' ? '四花色' : '标准花色'}</h2>
          {[50, 70, 90].map((width) => (
            <div key={width} className="component-catalog" aria-label={width + '像素'}>
              {(['S', 'H', 'C', 'D'] as Suit[]).flatMap((suit) =>
                (['2', '7', '10', 'A', 'J', 'Q', 'K'] as Rank[]).map((rank) => (
                  <figure key={rank + suit}>
                    <svg
                      role="img"
                      aria-label={rank + suit}
                      data-suit={suit}
                      viewBox="0 0 240 336"
                      width={width}
                      height={width * 1.4}
                    >
                      <rect width="240" height="336" rx="14" fill="#F7F2E8" />
                      <g dangerouslySetInnerHTML={{ __html: renderCenter(rank, suit).svg }} />
                    </svg>
                    <figcaption>{rank + suit}</figcaption>
                  </figure>
                )),
              )}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
