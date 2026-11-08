import ModalDialog from '../../components/ui/ModalDialog';
export default function AllInConfirmDialog({
  amount,
  onConfirm,
  onClose,
}: {
  amount: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalDialog title="确认全押" onClose={onClose}>
      <p>本次投入 {amount} 筹码。行动计时继续，回合更新后确认自动取消。</p>
      <button className="primary" onClick={onConfirm}>
        确认全押
      </button>
    </ModalDialog>
  );
}
