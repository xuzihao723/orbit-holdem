const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { expect, test } from '@playwright/test';

const open = '/?preview=table&scenario=';
const scenarios = [
  'table-two',
  'table-three',
  'table-four',
  'table-long-name',
  'table-preflop',
  'table-waiting',
  'table-disconnected',
  'table-next-hand',
  'table-all-in',
];
test('opens a clearly identified development table without enabling game commands', async ({
  page,
}) => {
  await page.goto(open + 'table-four');
  await expect(page.getByText('开发灰盒 · 固定数据', { exact: true })).toBeVisible();
  await expect(page.getByTestId('community-cards')).toBeVisible();
  await expect(page.getByRole('button', { name: '弃牌', exact: true })).toBeDisabled();
});
for (const scenario of scenarios) {
  test(`renders the ${scenario} fixture with safe disabled actions`, async ({ page }) => {
    await page.goto(open + scenario);
    await expect(page.getByTestId('table-scene')).toBeVisible();
    await expect(page.getByTestId('community-cards').locator(':scope > *')).toHaveCount(5);
    const buttons = page.getByTestId('action-bar').getByRole('button');
    for (const button of await buttons.all()) await expect(button).toBeDisabled();
    if (scenario === 'table-next-hand') {
      await expect(page.getByTestId('self-cards')).toHaveCount(0);
      await expect(page.getByText('下一手加入', { exact: true }).first()).toBeVisible();
    } else await expect(page.getByTestId('self-cards').getByRole('img')).toHaveCount(2);
    if (scenario === 'table-waiting')
      await expect(page.getByTestId('action-bar')).toContainText('等待');
    if (scenario === 'table-disconnected')
      await expect(page.getByTestId('action-bar')).toContainText('离线');
    if (scenario === 'table-all-in')
      await expect(page.getByTestId('action-bar')).toContainText('已全押');
  });
}
test('distinguishes public empty slots from hidden opponents without card identifiers', async ({
  page,
}) => {
  await page.goto(open + 'table-preflop');
  await expect(page.getByRole('img', { name: '待发公共牌', exact: true })).toHaveCount(5);
  await expect(page.getByRole('img', { name: '未公开底牌', exact: true })).toHaveCount(2);
  const backs = page.getByRole('img', { name: '未公开底牌', exact: true });
  for (const back of await backs.all()) {
    expect(await back.evaluate((node) => node.outerHTML)).not.toMatch(
      /data-card|cardId|\b(?:AS|KH|2C|7D|JS)\b/,
    );
  }
});
for (const [scenario, count, reason] of [
  ['lobby-two-of-four', '2 / 4', '满足人数条件'],
  ['lobby-three-of-four', '3 / 4', '尚未准备'],
  ['lobby-alone', '1 / 4', '还需一名参与者'],
]) {
  test(`shows capacity separately from occupancy for ${scenario}`, async ({ page }) => {
    await page.goto('/?preview=lobby&scenario=' + scenario);
    await expect(page.getByTestId('lobby-occupancy')).toHaveText(count!);
    await expect(page.getByTestId('lobby-status')).toContainText(reason!);
    await expect(page.getByTestId('lobby-seats').locator(':scope > *')).toHaveCount(4);
    await expect(page.getByRole('button', { name: '开始对局', exact: true })).toBeDisabled();
  });
}
test('navigates preview pages, preserves refresh and rejects invalid fixtures', async ({
  page,
}) => {
  await page.goto('/?preview=home');
  await page.getByRole('button', { name: '切换灰盒场景' }).click();
  await page.getByRole('link', { name: '等待房间', exact: true }).click();
  await expect(page.getByTestId('lobby-seats')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('lobby-seats')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '轨道牌桌', exact: true })).toBeVisible();
  await page.goto('/?preview=table&scenario=missing');
  await expect(page.getByText('场景不存在', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回首页', exact: true })).toHaveAttribute(
    'href',
    '/',
  );
});
test('exposes readable suit and rank labels for every suit', async ({ page }) => {
  await page.goto(open + 'table-long-name');
  for (const name of ['黑桃A', '红桃7', '梅花J', '方块Q', '黑桃K']) {
    await expect(page.getByRole('img', { name, exact: true })).toBeVisible();
  }
});
const sizes = [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
] as const;
for (const [width, height] of sizes)
  for (const number of [2, 3, 4]) {
    test(`layout ${number} players at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(open + ['table-two', 'table-three', 'table-four'][number - 2]);
      await expect(page.getByTestId('self-cards')).toBeVisible();
      const dimensions = await page
        .locator('html')
        .evaluate((n) => ({ content: n.scrollWidth, viewport: n.clientWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
      const board = await page.getByTestId('community-cards').boundingBox();
      const self = await page.getByTestId('self-cards').boundingBox();
      const actions = await page.getByTestId('action-bar').boundingBox();
      if (!board || !self || !actions) throw new Error('Missing table regions');
      expect(board.y + board.height).toBeLessThanOrEqual(self.y);
      expect(self.y + self.height).toBeLessThanOrEqual(actions.y);
      expect(actions.y + actions.height).toBeLessThanOrEqual(height);
      const opponents = await page.getByTestId('opponent-seat').all();
      expect(opponents.length).toBe(number - 1);
      for (const opponent of opponents) {
        const box = await opponent.boundingBox();
        if (!box) throw new Error('Missing opponent');
        expect(box.y + box.height).toBeLessThanOrEqual(self.y);
        if (width < 768) expect(box.y + box.height).toBeLessThanOrEqual(board.y);
      }
      await page.screenshot({
        path: `docs/verification/${stage}/table-${number}-${width}x${height}.png`,
        fullPage: true,
      });
    });
  }
for (const [width, height] of [
  [360, 640],
  [1280, 720],
] as const)
  for (const preview of ['home', 'lobby']) {
    test(`${preview} page at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/?preview=' + preview);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const dimensions = await page
        .locator('html')
        .evaluate((n) => ({ content: n.scrollWidth, viewport: n.clientWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
      await page.screenshot({
        path: `docs/verification/${stage}/${preview}-${width}x${height}.png`,
        fullPage: true,
      });
    });
  }
test('supports keyboard navigation and touch-sized preview controls', async ({ page }) => {
  await page.goto('/?preview=table');
  const toggle = page.getByRole('button', { name: '切换灰盒场景' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const select = page.getByLabel('固定场景');
  await expect(select).toBeVisible();
  for (const locator of [toggle, select, page.getByRole('link', { name: '首页', exact: true })]) {
    const box = await locator.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await select.selectOption('table-three');
  await expect(page).toHaveURL(/scenario=table-three/);
  await expect(page.getByTestId('opponent-seat')).toHaveCount(2);
});

test('renders a named computer participant and a two-digit card rank', async ({ page }) => {
  await page.goto('/?preview=table&scenario=table-three');
  await expect(page.getByText('电脑 · 入门', { exact: true })).toBeVisible();
  await page.goto('/?preview=table&scenario=table-preflop');
  await expect(page.getByRole('img', { name: '方块10', exact: true })).toBeVisible();
});
test('keeps twelve-grapheme names and primary actions visible at 360 width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?preview=table&scenario=table-long-name');
  await expect(page.getByTitle('小林朋友甲乙丙丁一二三四')).toBeVisible();
  const actions = await page.getByTestId('action-bar').boundingBox();
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(640);
  expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: 'docs/verification/' + stage + '/table-long-name-360x640.png',
    fullPage: true,
  });
});

test('does not label a computer as an unready human in the lobby', async ({ page }) => {
  await page.goto('/?preview=lobby&scenario=lobby-three-of-four');
  await expect(page.getByText('电脑 · 标准 · 无需准备 · 在线', { exact: true })).toBeVisible();
});
