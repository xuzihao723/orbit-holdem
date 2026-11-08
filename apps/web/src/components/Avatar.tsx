const avatars = import.meta.glob<string>('../../../../assets/avatars/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
});
export default function Avatar({ kind, seat }: { kind: 'human' | 'bot'; seat: number }) {
  const name = kind + '-' + String(seat + 1).padStart(2, '0') + '.svg';
  return <img src={avatars['../../../../assets/avatars/' + name]} alt="" width={32} height={32} />;
}
