export const figureNames = { J: '信使', Q: '领航者', K: '守望者' } as const;
export function figureBody(rank: keyof typeof figureNames) {
  const crown =
    rank === 'J'
      ? 'M92 118Q120 83 148 118L138 122Q120 108 102 122Z'
      : rank === 'Q'
        ? 'M94 116L88 91L109 103L120 85L131 103L152 91L146 116Z'
        : 'M94 116L90 94L108 101L120 89L132 101L150 94L146 116Z';
  return (
    '<circle cx="120" cy="170" r="60" fill="none" stroke="#D6B878" stroke-width="2"/>' +
    '<path d="M72 246Q76 198 120 194Q164 198 168 246L147 260H93Z"/>' +
    '<path d="M99 198L120 221L141 198L135 236H105Z" fill="#F7F2E8"/>' +
    '<path d="M97 125Q97 114 120 114Q143 114 143 125V150Q141 178 120 184Q99 178 97 150Z" fill="#F7F2E8" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M106 140H113M127 140H134M117 157L123 159M111 170Q120 174 129 170" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="' +
    crown +
    '"/>'
  );
}
