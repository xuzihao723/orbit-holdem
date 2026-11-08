const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { expect, test } from '@playwright/test';
const viewports = [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
] as const;
test('keeps long names visible and supports a touch-sized keyboard theme toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=cards');
  const toggle = page.getByRole('checkbox', { name: '四花色模式' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  expect((await page.locator('.theme-toggle').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('heading', { name: '90 × 126 桌面' })).toBeVisible();
  await page.goto('/?preview=table&scenario=table-long-name');
  await expect(page.getByTitle('小林朋友甲乙丙丁一二三四')).toBeVisible();
  expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: 'docs/verification/' + stage + '/table-long-name-360x640.png',
    fullPage: true,
  });
});
for (const [width, height] of viewports)
  for (const theme of ['standard', 'four'])
    test(`${width}x${height} ${theme} samples and three table layouts`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/?preview=cards&suits=' + theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('轨道星图 · 六张样例');
      await expect(page.getByRole('img', { name: '7H样例', exact: true })).toHaveCount(3);
      await expect(page.getByRole('img', { name: '红桃10', exact: true })).toHaveCount(3);
      for (const w of [50, 70, 90]) {
        const section = page.getByRole('region', { name: w + '像素样例' });
        const box = await section.locator('.sample-svg').first().boundingBox();
        expect(box!.width).toBe(w);
        expect(box!.height).toBeCloseTo(w * 1.4, 1);
      }
      expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `docs/verification/${stage}/cards-${theme}-${width}x${height}.png`,
        fullPage: true,
      });
      for (const number of ['two', 'three', 'four']) {
        await page.goto('/?preview=table&scenario=table-' + number);
        await page
          .locator('html')
          .evaluate((n, theme) => n.setAttribute('data-suit-theme', theme), theme);
        await expect(page.getByTestId('table-scene')).toBeVisible();
        if (theme === 'four') {
          const diamonds = page.locator('.playing-card[data-suit="D"]');
          if (await diamonds.count())
            await expect(diamonds.first()).toHaveCSS('color', 'rgb(39, 84, 165)');
        }
        expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({
          path: `docs/verification/${stage}/table-${number}-${theme}-${width}x${height}.png`,
          fullPage: true,
        });
      }
    });
