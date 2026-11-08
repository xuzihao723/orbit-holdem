import type { CardId } from '@orbit/protocol';
export const HAND_RANK_EXAMPLES: readonly { name: string; cards: CardId[] }[] = [
  { name: '同花顺', cards: ['AS', 'KS', 'QS', 'JS', '10S'] },
  { name: '四条', cards: ['AS', 'AH', 'AC', 'AD', 'KS'] },
  { name: '葫芦', cards: ['KS', 'KH', 'KC', 'QD', 'QH'] },
  { name: '同花', cards: ['AS', 'JS', '8S', '5S', '2S'] },
  { name: '顺子（五高）', cards: ['AS', '2H', '3C', '4D', '5S'] },
  { name: '三条', cards: ['QS', 'QH', 'QC', 'AS', '9D'] },
  { name: '两对', cards: ['JS', 'JH', '4C', '4D', 'AS'] },
  { name: '一对', cards: ['10S', '10H', 'AH', '7C', '3D'] },
  { name: '高牌', cards: ['AS', 'KD', '9C', '7H', '3S'] },
];
export const additionalRaiseCost = (raiseTo: number, already: number) => raiseTo - already;
