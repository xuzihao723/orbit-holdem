import { expect, test } from './release.fixture';
import { createUiRoom, finishUiHand, joinUiRoom, startUiHand } from '../helpers/ui-hand-driver';

for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
] as const) {
  for (const players of [2, 3, 4]) {
    test(`${width}px with ${players} players completes the active and waiting views`, async ({
      page,
      browser,
      network,
      clock,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const contexts = await Promise.all(
        Array.from({ length: players }, () => browser.newContext({ viewport: { width, height } })),
      );
      try {
        const code = await createUiRoom(page);
        const otherPages = await Promise.all(contexts.map((context) => context.newPage()));
        const waiting = otherPages.pop()!;
        const pages = [page, ...otherPages];
        for (const [index, other] of otherPages.entries()) await joinUiRoom(other, code, index + 1);
        await startUiHand(pages);
        const first = network.rooms.store.findCode(code)!.hand!;
        const actor = pages[first.betting!.actorSeatId!]!;
        await expect(actor.getByTestId('self-cards')).toBeVisible();
        await expect(actor.getByTestId('community-cards').getByRole('img')).toHaveCount(5);
        const fold = actor.getByRole('button', { name: '弃牌', exact: true });
        await expect(fold).toBeEnabled();
        await actor.evaluate(() => window.scrollTo(0, 0));
        const foldBounds = (await fold.boundingBox())!;
        expect(foldBounds.height).toBeGreaterThanOrEqual(44);
        if (height <= 720) expect(foldBounds.y + foldBounds.height).toBeLessThanOrEqual(height);
        await waiting.goto('/play?mode=join&room=' + code);
        await waiting.getByLabel('昵称', { exact: true }).fill('额外等待者');
        await waiting.getByRole('button', { name: '加入房间', exact: true }).click();
        if (players < 4) {
          await expect(waiting).toHaveURL(new RegExp('/table/' + code + '$'));
          await expect(waiting.getByTestId('table-scene')).toBeVisible();
          await expect(waiting.getByTestId('self-cards')).toHaveCount(0);
          await expect(waiting.getByRole('button', { name: '弃牌', exact: true })).toHaveCount(0);
        } else {
          await expect(waiting.getByRole('alert')).toContainText('房间已满');
        }
        for (const surface of [actor, waiting])
          expect(
            await surface.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
        await finishUiHand(network, clock, code, pages);
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    });
  }
}
