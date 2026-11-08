import { useAccount, useNetwork } from '../app/NetworkProvider';
import PlayingCard from '../components/cards/PlayingCard';
import chip from '../../../../assets/table/chip-100.svg?url';
export default function HomePage({ showPreviewLink = false }: { showPreviewLink?: boolean }) {
  const { snapshot, client, intents } = useNetwork(),
    room = snapshot.roomView,
    unfinished = intents.read();
  const account = useAccount();
  return (
    <main className="home-page">
      <div className="home-art" aria-hidden="true">
        <PlayingCard card="AH" compact />
        <PlayingCard card="AS" compact />
        <img src={chip} alt="" />
      </div>
      <p className="eyebrow">ORBIT HOLD’EM · 德州扑克</p>
      <h1>轨道牌桌</h1>
      <p className="intro">一张牌桌，几位朋友。</p>
      <div className="home-actions" aria-label="游戏入口">
        <a href="/play?mode=solo" className="button-link primary">
          单人练习
        </a>
        <a href="/play?mode=create" className="button-link">
          创建房间
        </a>
        <a href="/play?mode=join" className="button-link">
          加入房间
        </a>
      </div>
      <p className="help-text">2–4 人同桌 · 真人或电脑 · 虚拟筹码</p>
      <p className="help-text home-instructions">入座并准备后，由房主开始。每手结束后重新准备。</p>
      <nav className="home-secondary" aria-label="更多入口">
        {!account.sessionId && <a href="/play?mode=solo">以游客继续</a>}
        {room && snapshot.controlReady && <a href={'/room/' + room.roomCode}>返回上次房间</a>}
        {client.identitySessionId && !room && <span>将尝试恢复上次身份与房间。</span>}
        {unfinished &&
          unfinished.sessionId === client.identitySessionId &&
          unfinished.status !== 'complete' && (
            <a href={'/play?mode=' + unfinished.config.mode}>继续未完成的设置</a>
          )}
      </nav>
      {showPreviewLink && (
        <a className="preview-entry" href="/?preview=table&scenario=table-four">
          查看灰盒布局 <span aria-hidden="true">↗</span>
        </a>
      )}
    </main>
  );
}
