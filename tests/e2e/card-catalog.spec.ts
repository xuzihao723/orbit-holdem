const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from '@playwright/test';
test('every real card component renders in both suit modes at three sizes', async ({ page }) => {
  await page.goto('/?preview=catalog');
  await expect(page.getByRole('heading', { name: '52张牌组校对', exact: true })).toBeVisible();
  await expect(page.locator('.playing-card')).toHaveCount(312);
  for (const section of await page.locator('[data-suit-theme]').all()) {
    await expect(section.getByRole('img', { name: '红桃10', exact: true })).toHaveCount(3);
    for (const card of await section.getByRole('img', { name: '红桃10', exact: true }).all())
      await expect(card.locator('svg')).toHaveAttribute('data-card-id', '10H');
  }
  for (const [width, height] of [
    [360, 640],
    [390, 844],
    [430, 932],
    [1280, 720],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(width!);
    await page.screenshot({
      path: 'docs/verification/' + stage + '/catalog-' + width + '.png',
      fullPage: true,
    });
  }
});
