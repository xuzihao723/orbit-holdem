import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { CardManifest } from './lib/card-set.js';
const manifest = JSON.parse(readFileSync('assets/cards/manifest.json', 'utf8')) as CardManifest;
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1690, height: 784 },
    deviceScaleFactor: 1,
  });
  for (const four of [false, true]) {
    const color = (s: string) =>
      s === 'H'
        ? '#B83A48'
        : s === 'D'
          ? four
            ? '#2754A5'
            : '#B83A48'
          : s === 'C' && four
            ? '#17603F'
            : '#17212B';
    const cells = ['S', 'H', 'C', 'D'].flatMap((suit, row) =>
      ranks.map((rank, col) => {
        const id = rank + suit,
          svg = readFileSync('assets/' + manifest.faces[id], 'utf8');
        return (
          '<g transform="translate(' +
          (col * 130 + 5) +
          ' ' +
          (row * 196 + 4) +
          ')"><svg width="120" height="168" viewBox="0 0 240 336" color="' +
          color(suit) +
          '" style="--card-suit:' +
          color(suit) +
          '">' +
          svg.replace(/<svg[^>]+>|<\/svg>/g, '') +
          '</svg><text x="60" y="184" text-anchor="middle" fill="#F7F2E8" font-family="Segoe UI, sans-serif" font-size="14">' +
          id +
          '</text></g>'
        );
      }),
    );
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1690 784" width="1690" height="784"><rect width="1690" height="784" fill="#101827"/>' +
      cells.join('') +
      '</svg>';
    const suffix = four ? '-four-color' : '';
    writeFileSync('assets/cards/contact-sheet' + suffix + '.svg', source);
    await page.setContent('<style>body{margin:0}</style>' + source);
    await page.screenshot({ path: 'assets/cards/contact-sheet' + suffix + '.png' });
  }
  mkdirSync('docs/verification/w32', { recursive: true });
  for (const width of [50, 70, 90]) {
    for (const four of [false, true]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      const figures = ['S', 'H', 'C', 'D'].flatMap((suit) =>
        ['2', '7', '10', 'A', 'J', 'Q', 'K'].map((rank) => {
          const color =
            suit === 'C' && four
              ? '#17603F'
              : suit === 'D' && four
                ? '#2754A5'
                : suit === 'D' || suit === 'H'
                  ? '#B83A48'
                  : '#17212B';
          return (
            '<figure style="margin:0"><div style="width:' +
            width +
            'px;height:' +
            width * 1.4 +
            'px;--card-suit:' +
            color +
            '">' +
            readFileSync('assets/' + manifest.faces[rank + suit], 'utf8').replace(
              '<svg ',
              '<svg width="100%" height="100%" ',
            ) +
            '</div><figcaption>' +
            rank +
            suit +
            '</figcaption></figure>'
          );
        }),
      );
      await page.setContent(
        '<style>body{margin:20px;background:#101827;color:#F7F2E8;font:14px Segoe UI}main{display:flex;gap:16px;flex-wrap:wrap;max-width:1200px}</style><h1>' +
          width +
          'px / ' +
          (four ? '四色' : '标准') +
          '</h1><main>' +
          figures.join('') +
          '</main>',
      );
      await page.screenshot({
        path: 'docs/verification/w32/components-' + width + (four ? '-four' : '') + '.png',
        fullPage: true,
      });
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ contactSheets: 2, columns: 13, rows: 4, componentProofs: 6 }));
