import { lazy, Suspense, useEffect } from 'react';
import HomePage from './pages/HomePage';
import SetupPage from './pages/SetupPage';
import RulesPage from './pages/RulesPage';
import LiveLobbyPage from './pages/LiveLobbyPage';
import LiveTablePage from './pages/LiveTablePage';
import ConnectionBanner from './network/ConnectionBanner';
import { useAccount, useNetwork, useAppRoute } from './app/NetworkProvider';
import { parseRoute } from './app/router';
import SettingsDrawer from './components/ui/SettingsDrawer';
import { usePreferences } from './settings/use-preferences';
import { getPreferencesStore } from './settings/preferences-store';
import { audioManager } from './audio/audio-manager';
import HistoryPage from './pages/HistoryPage';
import ReplayPage from './pages/ReplayPage';
import { useTableEffects } from './features/table/use-table-effects';
import AccountPage from './pages/AccountPage';
const DevPreviewApp = import.meta.env.DEV ? lazy(() => import('./dev/DevPreviewApp')) : null;
export default function App() {
  const { client, recovery, router, snapshot, intents } = useNetwork(),
    path = useAppRoute(),
    route = parseRoute(path);
  const preferences = usePreferences();
  const account = useAccount();
  const game = route.kind === 'room' || route.kind === 'table' || route.kind === 'replay';
  const auth =
    route.kind === 'login' || route.kind === 'register' || route.kind === 'reset-password';
  const tableEffect = useTableEffects(
    snapshot,
    (route.kind === 'table' || route.kind === 'room') && snapshot.roomView?.roomCode === route.code,
  );
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === 'orbit.preferences.v1') getPreferencesStore().refresh();
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  const preview = new URLSearchParams(path.split('?')[1] ?? '').get('preview');
  if (DevPreviewApp && preview !== null)
    return (
      <Suspense fallback={<p role="status">正在加载预览…</p>}>
        <DevPreviewApp />
      </Suspense>
    );
  const resetIdentity = () => {
    client.credentials.clear();
    client.locator.clear();
    intents.clear();
    location.assign('/');
  };
  return (
    <div
      className={game ? 'app-shell game-shell' : 'app-shell'}
      data-suit-theme={preferences.suitMode}
      data-reduce-motion={preferences.reduceMotion}
      data-table-effect={tableEffect ?? undefined}
      onPointerDown={() => audioManager.unlock()}
      onKeyDown={() => audioManager.unlock()}
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const a = target.closest('a');
        if (
          a instanceof HTMLAnchorElement &&
          a.origin === location.origin &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0 &&
          !a.target &&
          !a.download
        ) {
          event.preventDefault();
          router.navigate(a.pathname + a.search + a.hash);
        }
      }}
    >
      <header className={auth ? 'site-header site-header-auth' : 'site-header'}>
        <a className="site-brand" href="/" aria-label="轨道牌桌首页">
          <span className="brand-mark" aria-hidden="true">
            ♠
          </span>
          <strong>轨道牌桌</strong>
          <small lang="en">ORBIT HOLD’EM</small>
        </a>
        {game ? (
          <span className="site-context">
            {route.kind === 'replay' ? '牌局回放' : '房间 ' + route.code} · 虚拟筹码
          </span>
        ) : !auth ? (
          <nav className="site-nav" aria-label="主导航">
            <a href="/rules" aria-current={route.kind === 'rules' ? 'page' : undefined}>
              玩法说明
            </a>
            <a href="/history" aria-current={route.kind === 'history' ? 'page' : undefined}>
              历史记录
            </a>
            <a className="button-link" href={account.sessionId ? '/account' : '/login'}>
              {account.sessionId
                ? '我的账号'
                : account.emailEnabled && !account.googleEnabled
                  ? '登录 / 注册'
                  : '登录'}
            </a>
          </nav>
        ) : null}
        <div className="header-tools">
          <SettingsDrawer quickSound={route.kind === 'room' || route.kind === 'table'} />
        </div>
      </header>
      {(client.identitySessionId || snapshot.authContext) && (
        <div className="connection-banner">
          {client.credentialsChanged ? (
            <aside role="status">
              另一个页面更换了访客身份。
              <button onClick={() => location.reload()}>载入当前访客身份</button>
            </aside>
          ) : (
            <ConnectionBanner client={client} onRetry={() => void recovery.start()} />
          )}
          {!client.credentialsChanged &&
            !account.sessionId &&
            client.credentials.read() &&
            ['expired', 'takenOver'].includes(snapshot.status) && (
              <button onClick={resetIdentity}>重新建立访客身份</button>
            )}
          {account.sessionId && snapshot.status === 'expired' && <a href="/login">重新登录账号</a>}
        </div>
      )}
      {route.kind === 'home' ? (
        <HomePage showPreviewLink={import.meta.env.DEV} />
      ) : route.kind === 'setup' ? (
        <SetupPage key={route.mode + route.code} mode={route.mode} code={route.code} />
      ) : route.kind === 'rules' ? (
        <RulesPage />
      ) : route.kind === 'login' ||
        route.kind === 'register' ||
        route.kind === 'reset-password' ||
        route.kind === 'account' ? (
        <AccountPage key={route.kind} mode={route.kind} path={path} />
      ) : route.kind === 'history' ? (
        <HistoryPage />
      ) : route.kind === 'replay' ? (
        <ReplayPage key={route.handId} handId={route.handId} />
      ) : route.kind === 'room' ? (
        <LiveLobbyPage code={route.code} />
      ) : route.kind === 'table' ? (
        <LiveTablePage code={route.code} />
      ) : (
        <main className="app-page missing-page">
          <section>
            <p className="eyebrow">404 · ORBIT</p>
            <h1>页面暂不可用</h1>
            <p className="page-lead">这个入口尚未开放，或地址不正确。</p>
            <a className="button-link primary" href="/">
              返回首页
            </a>
          </section>
        </main>
      )}
    </div>
  );
}
