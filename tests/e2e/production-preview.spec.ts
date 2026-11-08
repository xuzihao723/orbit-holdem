const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { expect, test } from './app.fixture';
for (const suffix of [
  '/',
  '/?preview=table&scenario=table-four',
  '/?preview=lobby&scenario=lobby-two-of-four',
]) {
  test(`production keeps the development fixture unavailable at ${suffix}`, async ({ page }) => {
    await page.goto(suffix);
    await expect(page.getByRole('heading', { name: '轨道牌桌', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '单人练习', exact: true })).toHaveAttribute(
      'href',
      '/play?mode=solo',
    );
    await expect(
      page.getByText('入座并准备后，由房主开始。每手结束后重新准备。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('table-scene')).toHaveCount(0);
    await expect(page.getByTestId('lobby-seats')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: '开发预览控制' })).toHaveCount(0);
    expect(await page.locator('body').innerHTML()).not.toMatch(
      /W04_DEV_FIXTURE_ONLY|W04校对昵称甲|W29_DEV_CARD_SAMPLES_ONLY/,
    );
    await page.screenshot({
      path:
        'docs/verification/' +
        stage +
        '/production-' +
        (suffix === '/' ? 'home' : suffix.includes('table') ? 'table-query' : 'lobby-query') +
        '.png',
      fullPage: true,
    });
  });
}
