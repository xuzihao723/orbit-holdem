import { useState, type CSSProperties } from 'react';
import { cardSamples } from './card-samples';
import PlayingCard from '../components/cards/PlayingCard';
import CardSlot from '../components/cards/CardSlot';
export default function CardSamplePage() {
  const [four, setFour] = useState(new URLSearchParams(location.search).get('suits') === 'four');
  return (
    <main
      className="card-sample-page"
      data-suit-theme={four ? 'four' : 'standard'}
      data-sample-source="W29_DEV_CARD_SAMPLES_ONLY"
    >
      <p className="eyebrow">ORBIT / VISUAL STUDY 01</p>
      <h1>轨道星图 · 六张样例</h1>
      <p>开发校对，非完整52张牌组。原生矢量，观察牌值、花色与角标。</p>
      <label className="theme-toggle">
        <input type="checkbox" checked={four} onChange={(e) => setFour(e.target.checked)} />
        四花色模式
      </label>
      {[50, 70, 90].map((width) => (
        <section key={width} aria-label={width + '像素样例'}>
          <h2>
            {width} × {Math.round(width * 1.4)}{' '}
            <span>{width === 50 ? '公共牌' : width === 70 ? '手牌' : '桌面'}</span>
          </h2>
          <div
            className="sample-row"
            style={
              {
                '--sample-width': width + 'px',
                '--card-width': width + 'px',
                '--card-height': width * 1.4 + 'px',
              } as CSSProperties
            }
          >
            {cardSamples.map((s) => (
              <figure key={s.id} data-suit={s.id === 'orbit-back' ? '' : s.id.slice(-1)}>
                <span
                  className="sample-svg"
                  role="img"
                  aria-label={s.id + '样例'}
                  dangerouslySetInnerHTML={{ __html: s.svg }}
                />
                <figcaption>{s.id}</figcaption>
              </figure>
            ))}
            <figure>
              <PlayingCard card="10H" />
              <figcaption>10H · CSS</figcaption>
            </figure>
            <figure>
              <CardSlot />
              <figcaption>空槽</figcaption>
            </figure>
          </div>
        </section>
      ))}
      <p className="sample-note">7H中心准确七点；牌背旋转180°一致。其他牌继续使用原CSS逻辑牌面。</p>
      <a href="/?preview=table&scenario=table-four">查看四人桌</a>
    </main>
  );
}
