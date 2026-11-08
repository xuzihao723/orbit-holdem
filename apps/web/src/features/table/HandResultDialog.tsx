import type { HandResult } from '@orbit/protocol';
import ModalDialog from '../../components/ui/ModalDialog';
import PotSummary from './PotSummary';
export default function HandResultDialog({
  result,
  label,
  onClose,
  onReady,
  busy,
  error,
}: {
  result: HandResult;
  label: (id: string) => string;
  onClose: () => void;
  onReady: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <ModalDialog title="本手结算" onClose={onClose}>
      <PotSummary result={result} label={label} />
      <p>下一手需要重新准备，并由房主开始。</p>
      <button className="primary" disabled={busy} onClick={onReady}>
        准备下一手
      </button>
      {error && <p role="alert">{error}</p>}
    </ModalDialog>
  );
}
