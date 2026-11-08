import { useEffect, useState } from 'react';
import type { Action, LegalActionsView } from '@orbit/protocol';
import RaiseControl from './RaiseControl';
export default function ActionBar({
  legal,
  message,
  onAction,
  disabled = true,
  committed = 0,
  stack = 0,
  actionId = '',
}: {
  legal: LegalActionsView | null;
  message: string;
  onAction?: (action: Action) => void;
  disabled?: boolean;
  committed?: number;
  stack?: number;
  actionId?: string;
}) {
  const [raw, setRaw] = useState(String(legal?.minRaiseTo ?? ''));
  useEffect(() => setRaw(String(legal?.minRaiseTo ?? '')), [actionId, legal?.minRaiseTo]);
  return (
    <section className="action-bar" data-testid="action-bar" aria-label="行动区域">
      <div className="action-caption">
        <strong>{message}</strong>
        <span>{onAction ? '以服务器确认的筹码为准' : '灰盒预览，暂不可操作'}</span>
      </div>
      {legal && legal.allowed.length > 0 && (
        <div className="action-buttons">
          {legal.allowed.includes('fold') && (
            <button
              className="danger-action"
              type="button"
              disabled={disabled}
              onClick={() => onAction?.({ type: 'fold' })}
            >
              弃牌
            </button>
          )}
          {legal.allowed.includes('check') && (
            <button type="button" disabled={disabled} onClick={() => onAction?.({ type: 'check' })}>
              过牌
            </button>
          )}
          {legal.allowed.includes('call') && (
            <button type="button" disabled={disabled} onClick={() => onAction?.({ type: 'call' })}>
              跟注 {onAction ? Math.min(legal.callAmount, stack) : legal.callAmount}
            </button>
          )}
          {!onAction && (legal.allowed.includes('raise') || legal.allowed.includes('bet')) && (
            <button type="button" disabled>
              加注至 {legal.minRaiseTo}
            </button>
          )}
          {legal.allowed.includes('allIn') && (
            <button type="button" disabled={disabled} onClick={() => onAction?.({ type: 'allIn' })}>
              全押{onAction ? ' ' + legal.allIn?.additionalAmount : ''}
            </button>
          )}
        </div>
      )}
      {legal && onAction && (
        <RaiseControl
          legal={legal}
          committed={committed}
          raw={raw}
          onChange={setRaw}
          disabled={disabled}
          onSubmit={(raiseTo) =>
            onAction({ type: legal.allowed.includes('bet') ? 'bet' : 'raise', raiseTo })
          }
        />
      )}
      {!onAction && legal?.minRaiseTo != null && (
        <p className="raise-caption">
          合法加注至 {legal.minRaiseTo}—{legal.maxRaiseTo} · 金额由夹具视图提供
        </p>
      )}
    </section>
  );
}
