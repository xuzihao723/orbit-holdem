import { t } from '../../i18n/translate';
import type { LegalActionsView } from '@orbit/protocol';
import { resolveRaise, raiseShortcuts } from './raise-model';
export default function RaiseControl({
  legal,
  committed,
  raw,
  onChange,
  disabled,
  onSubmit,
}: {
  legal: LegalActionsView;
  committed: number;
  raw: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onSubmit: (raiseTo: number) => void;
}) {
  const model = resolveRaise(legal, committed, raw);
  if (!legal.allowed.includes('bet') && !legal.allowed.includes('raise')) return null;
  if (legal.minRaiseTo === null || legal.maxRaiseTo === null) return null;
  return (
    <div className="raise-control">
      <label>
        加注至（本轮总额）
        <input
          aria-label="加注至"
          type="text"
          inputMode="numeric"
          value={raw}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={model.error !== null}
          aria-describedby="raise-explanation"
        />
      </label>
      <input
        aria-label="加注金额滑块"
        type="range"
        min={legal.minRaiseTo}
        max={legal.maxRaiseTo}
        step={1}
        value={model.raiseTo ?? legal.minRaiseTo}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="raise-shortcuts">
        {raiseShortcuts(legal).map((amount, i) => (
          <button key={amount} disabled={disabled} onClick={() => onChange(String(amount))}>
            {i === 0 ? '最低 ' : amount === legal.allIn?.raiseTo ? '全押额 ' : '两倍最低 '}
            {amount}
          </button>
        ))}
      </div>
      <p id="raise-explanation" className="help-text">
        {model.error
          ? model.error === 'empty'
            ? '请输入本轮总额。'
            : model.error === 'integer'
              ? '请输入整数筹码。'
              : '合法总额为 ' + legal.minRaiseTo + '—' + legal.maxRaiseTo + '。'
          : t('additional', { amount: model.additionalAmount! }) + '，已投入 ' + committed + '。'}
      </p>
      <button
        className="primary"
        disabled={disabled || model.error !== null}
        onClick={() => model.raiseTo !== null && onSubmit(model.raiseTo)}
      >
        {legal.allowed.includes('bet') ? '下注至 ' : '加注至 '}
        {model.raiseTo ?? '…'}
      </button>
    </div>
  );
}
