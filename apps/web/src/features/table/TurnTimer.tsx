export default function TurnTimer({ seconds }: { seconds: number | null }) {
  const threshold =
    seconds !== null &&
    (seconds <= 0
      ? '行动时间已到'
      : seconds <= 5
        ? '行动剩余5秒以内'
        : seconds <= 10
          ? '行动剩余10秒以内'
          : '');
  return (
    <>
      <span className={seconds !== null && seconds <= 10 ? 'timer-urgent' : ''}>
        {seconds === null ? '同步期限…' : seconds + '秒'}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {threshold}
      </span>
    </>
  );
}
