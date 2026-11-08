const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from './app.fixture';
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
])
  test(
    'private history and complete read-only replay at ' + width + 'x' + height,
    async ({ page, browser, network }) => {
      await page.setViewportSize({ width: width!, height: height! });
      const context = await browser.newContext(),
        other = await context.newPage();
      try {
        await page.goto('/play?mode=create');
        await page.getByLabel('昵称', { exact: true }).fill('历史房主');
        await page.getByRole('button', { name: '创建房间', exact: true }).click();
        await expect(page).toHaveURL(/\/room\//);
        const code = page.url().split('/').at(-1)!;
        await other.goto('/play?mode=join&room=' + code);
        await other.getByLabel('昵称', { exact: true }).fill('朋友');
        await other.getByRole('button', { name: '加入房间', exact: true }).click();
        for (const p of [page, other])
          await p.getByRole('button', { name: '准备', exact: true }).click();
        await page.getByRole('button', { name: '开始本手', exact: true }).click();
        for (const p of [page, other]) await expect(p).toHaveURL(/\/table\//);
        const hand = network.rooms.store.findCode(code)!.hand!,
          actor = hand.betting!.actorSeatId === 0 ? page : other;
        await actor.getByRole('button', { name: '弃牌', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
        await page.goto('/history');
        await expect(page.getByRole('link', { name: '查看回放', exact: true })).toBeVisible();
        const version = network.rooms.store.findCode(code)!.hand!.handVersion;
        await page.getByRole('link', { name: '查看回放', exact: true }).click();
        await expect(page.getByRole('heading', { name: '本手回放', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
        await expect(page.getByTestId('self-cards')).toHaveCount(0);
        await page.getByRole('button', { name: '末步', exact: true }).click();
        await expect(page.getByText('其余玩家弃牌', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '首步', exact: true }).click();
        await page.getByRole('button', { name: '播放', exact: true }).click();
        await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        expect(network.rooms.store.findCode(code)!.hand!.handVersion).toBe(version);
        expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(
          width!,
        );
        await page.screenshot({
          path: 'docs/verification/' + stage + '/replay-' + width + '.png',
          fullPage: true,
        });
        const strangerContext = await browser.newContext(),
          stranger = await strangerContext.newPage();
        try {
          await stranger.goto(page.url());
          await expect(stranger.getByText('请先恢复原访客身份。', { exact: true })).toBeVisible();
          await expect(stranger.getByTestId('self-cards')).toHaveCount(0);
        } finally {
          await strangerContext.close();
        }
      } finally {
        await context.close();
      }
    },
  );
