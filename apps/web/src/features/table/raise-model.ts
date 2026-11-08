import type { LegalActionsView } from '@orbit/protocol';
export interface RaiseModel {
  raw: string;
  raiseTo: number | null;
  additionalAmount: number | null;
  error: 'empty' | 'integer' | 'range' | null;
}
function hasRange(legal: LegalActionsView) {
  return (
    (legal.allowed.includes('bet') || legal.allowed.includes('raise')) &&
    legal.minRaiseTo !== null &&
    legal.maxRaiseTo !== null &&
    legal.minRaiseTo <= legal.maxRaiseTo
  );
}
export function resolveRaise(legal: LegalActionsView, committed: number, raw: string): RaiseModel {
  const invalid = (error: RaiseModel['error']): RaiseModel => ({
    raw,
    raiseTo: null,
    additionalAmount: null,
    error,
  });
  if (!raw.trim()) return invalid('empty');
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return invalid('integer');
  const raiseTo = Number(raw);
  if (
    !hasRange(legal) ||
    raiseTo < legal.minRaiseTo! ||
    raiseTo > legal.maxRaiseTo! ||
    raiseTo <= committed
  )
    return invalid('range');
  return { raw, raiseTo, additionalAmount: raiseTo - committed, error: null };
}
export function raiseShortcuts(legal: LegalActionsView): number[] {
  if (!hasRange(legal)) return [];
  const min = legal.minRaiseTo!,
    max = legal.maxRaiseTo!;
  return [
    ...new Set([
      min,
      Math.min(max, min * 2),
      ...(legal.allowed.includes('allIn') &&
      legal.allIn &&
      legal.allIn.raiseTo >= min &&
      legal.allIn.raiseTo <= max
        ? [legal.allIn.raiseTo]
        : []),
    ]),
  ];
}
