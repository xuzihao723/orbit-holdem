export default function ServerConnectionPage({
  timedOut,
  onBack,
  onRetry,
}: {
  timedOut: boolean;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="app-page server-connection-page">
      <section className="server-connection-panel">
        <p className="eyebrow">ORBIT / 联机</p>
        <h1>{timedOut ? '服务器暂未响应' : '正在启动游戏服务器'}</h1>
        {timedOut ? (
          <p role="alert">你的入座设置已保留，可以重新连接。</p>
        ) : (
          <div role="status">
            {/* Rolling ball animation from Uiverse.io by dovatgabriel. */}
            <div className="server-connection-loader" aria-hidden="true">
              <span className="server-connection-ball" />
              <span className="server-connection-bar" />
            </div>
            <p lang="en" className="server-connection-caption">
              Waiting to be connected...
            </p>
            <p>通常需要约 1 分钟。连接成功后将自动继续。</p>
          </div>
        )}
        <div className="server-connection-actions">
          {timedOut && (
            <button className="primary" onClick={onRetry}>
              重新连接
            </button>
          )}
          <button onClick={onBack}>返回设置</button>
        </div>
      </section>
    </main>
  );
}
