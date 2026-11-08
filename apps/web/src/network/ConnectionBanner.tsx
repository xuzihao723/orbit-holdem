import { useSyncExternalStore } from 'react';
import type { createSocketClient } from './socket-client';
export default function ConnectionBanner({
  client,
  onRetry,
}: {
  client: ReturnType<typeof createSocketClient>;
  onRetry?: () => void;
}) {
  const state = useSyncExternalStore(
    client.store.subscribe,
    () => client.store.snapshot,
    () => client.store.snapshot,
  );
  if (state.interruptedHandId)
    return <aside role="status">服务器已重启，本手已中止。可以新建或加入房间。</aside>;
  if (state.status === 'ready' && state.controlReady) return null;
  const message =
    state.status === 'takenOver'
      ? '此身份已由另一个页面控制。'
      : state.status === 'expired'
        ? '身份已过期，请重新建立访客身份。'
        : state.status === 'authenticating'
          ? '正在恢复身份与房间…'
          : '连接已断开，操作暂不可用。';
  return (
    <aside role="status" aria-live="polite">
      {message}
      {state.status === 'disconnected' && onRetry && (
        <button type="button" onClick={onRetry}>
          重新连接
        </button>
      )}
    </aside>
  );
}
