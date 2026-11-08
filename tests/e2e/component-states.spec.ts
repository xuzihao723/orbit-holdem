import { test, expect } from '@playwright/test';

const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';

for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
] as const) {
  test('component state board is usable at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?preview=states');
    await expect(page.getByRole('heading', { name: '组件状态校对' })).toBeVisible();
    const seats = page.getByRole('region', { name: '座位' });
    for (const text of [
      '空座',
      '行动中',
      '已准备',
      '已弃牌',
      '已全押',
      '离线',
      '下一手加入',
      '已出局',
    ])
      await expect(seats.getByText(text, { exact: false })).toHaveCount(1);
    await expect(seats.getByText('电脑 · 标准')).toBeVisible();
    await expect(page.getByRole('img', { name: '未公开底牌' })).toBeVisible();
    await expect(page.getByRole('img', { name: '待发公共牌' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '边池 1 · 300' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '未匹配下注返还' })).toBeVisible();

    const mode = page.getByLabel('下注状态');
    await mode.selectOption('short');
    await expect(page.getByRole('button', { name: '全押 30' })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: '加注至' })).toHaveCount(0);
    await mode.selectOption('pending');
    await expect(page.getByRole('textbox', { name: '加注至' })).toBeDisabled();
    await mode.selectOption('normal');
    const input = page.getByRole('textbox', { name: '加注至' });
    await input.fill('abc');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('请输入整数筹码。')).toBeVisible();
    await input.fill('80');
    await input.press('Tab');
    await expect(page.getByRole('slider', { name: '加注金额滑块' })).toBeFocused();
    const button = await page.getByRole('button', { name: '加注至 80' }).boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);

    const replay = page.getByRole('region', { name: '回放控制' });
    await expect(replay.getByRole('button', { name: '首步' })).toBeDisabled();
    await replay.getByRole('button', { name: '播放' }).click();
    await expect(replay.getByRole('button', { name: '暂停' })).toBeEnabled();
    await replay.getByRole('button', { name: '末步' }).click();
    await expect(replay.getByRole('button', { name: '下一步' })).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `docs/verification/${stage}/component-states-${width}.png`,
      fullPage: true,
    });
  });
}
