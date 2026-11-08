import { readFileSync } from 'node:fs';
export const SAMPLE_IDS = ['AS', '7H', 'JC', 'QD', 'KS', 'orbit-back'] as const;
const suits: Record<string, string> = { S: '♠', H: '♥', C: '♣', D: '♦' };
function star(x: number, y: number, size: number) {
  return `<path d="M${x} ${y - size} L${x + size / 4} ${y - size / 4} L${x + size} ${y} L${x + size / 4} ${y + size / 4} L${x} ${y + size} L${x - size / 4} ${y + size / 4} L${x - size} ${y} L${x - size / 4} ${y - size / 4}Z" fill="#D6B878"/>`;
}
function court(rank: string, suit: string, color: string) {
  const crown =
    rank === 'Q'
      ? '<path d="M91 114L86 85L109 101L120 79L131 101L154 85L149 114Z"/>'
      : rank === 'K'
        ? '<path d="M90 113L87 91L108 99L120 84L132 99L153 91L150 113Z"/>'
        : '<path d="M87 114Q120 70 153 114L140 119Q120 103 100 120Z"/>';
  return `<g data-character="${rank}" stroke="${color}" stroke-width="3" stroke-linejoin="round"><circle cx="120" cy="168" r="67" fill="none" stroke="#D6B878"/><ellipse cx="120" cy="168" rx="77" ry="22" fill="none" stroke="#D6B878" transform="rotate(-30 120 168)"/><path d="M70 239Q77 194 120 192Q163 194 170 239L146 260H94Z" fill="${color}"/><path d="M99 195L120 219L141 195L135 235H105Z" fill="#F7F2E8"/><path d="M96 123Q96 113 120 112Q144 113 144 123V151Q141 180 120 186Q99 180 96 151Z" fill="#F7F2E8"/><path d="M106 139H114M126 139H134M117 157L123 159M111 170Q120 175 129 170" fill="none"/>${crown}<text x="120" y="253" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="25" fill="#F7F2E8" stroke="none">${suit}</text></g>`;
}
export function cardSampleSvg(id: string) {
  if (!SAMPLE_IDS.includes(id as (typeof SAMPLE_IDS)[number])) throw Error('UNKNOWN_SAMPLE');
  const back = id === 'orbit-back',
    rank = back ? '' : id.slice(0, -1),
    suit = back ? '' : id.slice(-1),
    symbol = suits[suit] ?? '',
    color = `var(--card-suit,${suit === 'H' || suit === 'D' ? '#B83A48' : '#17212B'})`;
  const corner = `<g data-corner="safe" fill="${color}" font-family="Segoe UI, sans-serif" font-weight="600" text-anchor="middle"><text x="34" y="54" font-size="46">${rank}</text><text x="34" y="86" font-size="32">${symbol}</text></g>`;
  let art = '';
  if (back) {
    const half = `<path d="M32 168Q45 55 120 44Q170 70 208 168" fill="none" stroke="#D6B878" stroke-width="2"/><ellipse cx="120" cy="168" rx="76" ry="32" fill="none" stroke="#D6B878" stroke-width="2" transform="rotate(-35 120 168)"/>${star(120, 83, 9)}${star(55, 140, 4)}${star(178, 111, 4)}`;
    art = `<g data-back-half="first">${half}</g><g data-back-half="second" transform="rotate(180 120 168)">${half}</g><circle cx="120" cy="168" r="26" fill="#183545" stroke="#D6B878" stroke-width="2"/>${star(120, 168, 18)}`;
  } else if (rank === '7') {
    art =
      '<g data-seven="true" fill="' +
      color +
      '">' +
      [
        [81, 111],
        [159, 111],
        [120, 150],
        [81, 185],
        [159, 185],
        [81, 250],
        [159, 250],
      ]
        .map(
          ([x, y]) =>
            `<text data-pip="heart" x="${x}" y="${y}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="43">♥</text>`,
        )
        .join('') +
      '</g>';
  } else if (rank === 'A') {
    art = `<g stroke="#D6B878" fill="none" stroke-width="2"><circle cx="120" cy="168" r="65"/><circle cx="120" cy="168" r="54"/><path d="M120 89V109M120 227V247M41 168H61M179 168H199"/></g>${star(120, 168, 58)}<text x="120" y="198" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="97" fill="${color}">♠</text>`;
  } else art = court(rank, symbol, color);
  const vars: Record<string, string> = {
    ID: id,
    RANK: rank,
    SUIT: suit,
    TITLE: back ? '轨道星图牌背' : id,
    FACE: back ? '#183545' : '#F7F2E8',
    CORNERS: back ? '' : corner + `<g transform="rotate(180 120 168)">${corner}</g>`,
    ART: art,
  };
  return readFileSync('assets/cards/templates/source.svg', 'utf8').replace(
    /\{\{([A-Z]+)\}\}/g,
    (_, k: string) => vars[k]!,
  );
}
