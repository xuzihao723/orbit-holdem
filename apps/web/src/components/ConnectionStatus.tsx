import { useEffect, useState } from 'react';
type ConnectionState = 'checking' | 'connected' | 'failed';
const messages: Record<ConnectionState, string> = {
  checking: '正在连接服务…',
  connected: '服务连接正常',
  failed: '暂时无法连接服务，请稍后重试。',
};

export default function ConnectionStatus() {
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    setConnection('checking');

    void fetch('/health/live', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Service unavailable');
        const body: unknown = await response.json();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('status' in body) ||
          body.status !== 'ok'
        ) {
          throw new Error('Unexpected health response');
        }
        if (active) setConnection('connected');
      })
      .catch(() => {
        if (active) setConnection('failed');
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <section className="connection" aria-labelledby="connection-title">
      <div>
        <h2 id="connection-title">连接状态</h2>
        <p
          className={`connection-message ${connection}`}
          role={connection === 'failed' ? 'alert' : 'status'}
        >
          <span className="status-dot" aria-hidden="true" />
          {messages[connection]}
        </p>
      </div>
      <button
        type="button"
        disabled={connection === 'checking'}
        onClick={() => setAttempt((value) => value + 1)}
      >
        重新连接
      </button>
    </section>
  );
}
