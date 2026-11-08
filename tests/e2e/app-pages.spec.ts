const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from './app.fixture';
import type { Page } from '@playwright/test';
import type { AuthenticatedCommand } from '../../apps/server/dist/transport/types.js';
test('retries a private resume timeout after an acknowledged ready change', async ({
  page,
  network,
}) => {
  await create(page, '私有恢复');
  const original = network.sessions.service.resume;
  let drop = true,
    release: (() => void) | undefined;
  network.sessions.service.resume = async (...args) => {
    const r = await original.apply(network.sessions.service, args);
    if (drop) {
      drop = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return r;
  };
  try {
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试身份恢复', exact: true })).toBeEnabled({
      timeout: 8000,
    });
    await page.getByRole('button', { name: '重试身份恢复', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
  } finally {
    release?.();
    network.sessions.service.resume = original;
  }
});
test('invalidates a second tab when the shared browser credential changes to another guest', async ({
  page,
}) => {
  const code = await create(page, '身份一'),
    other = await page.context().newPage();
  try {
    await other.goto('/room/' + code);
    await expect(other.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '重新建立访客身份', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重新建立访客身份', exact: true }).click();
    await create(page, '身份二');
    await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
    await expect(other.getByText('另一个页面更换了访客身份。', { exact: false })).toBeVisible();
    await expect(other.getByRole('button', { name: '准备', exact: true })).toBeDisabled();
    await expect(
      other.getByRole('button', { name: '载入当前访客身份', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  } finally {
    await other.close();
  }
});
test('retains the nickname through offline admission and automatically restores a newly issued identity', async ({
  page,
}) => {
  await page.goto('/play?mode=create');
  await page.getByLabel('昵称', { exact: true }).fill('离线恢复');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('连接');
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('离线恢复');
  await page.context().setOffline(false);
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  expect((await page.request.get('/health/live')).status()).toBe(200);
  const session = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orbit.credentials')!).sessionId,
  );
  await page.context().setOffline(true);
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeDisabled();
  await expect(page.getByText('连接已断开，操作暂不可用。', { exact: false })).toBeVisible();
  await page.screenshot({
    path: 'docs/verification/' + stage + '/disconnected.png',
    fullPage: true,
  });
  await page.context().setOffline(false);
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled({
    timeout: 10000,
  });
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('orbit.credentials')!).sessionId),
  ).toBe(session);
});
test('supports three humans with a bot and a full four-human lobby through real browser entries', async ({
  page,
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const code = await create(page, '真人房主'),
      others = await Promise.all(contexts.map((c) => c.newPage()));
    await join(others[0]!, code, '朋友乙');
    await join(others[1]!, code, '朋友丙');
    await page.getByRole('button', { name: '座位4添加电脑', exact: true }).click();
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('4 / 4');
    await page.getByRole('button', { name: '移除座位4电脑', exact: true }).click();
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('3 / 4');
    await join(others[2]!, code, '朋友丁');
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('4 / 4');
    for (const p of [page, ...others]) {
      await p.getByRole('button', { name: '准备', exact: true }).click();
      await expect(p.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
    }
    await expect(page.getByText('满足服务端开局条件', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始本手' })).toBeEnabled();
    await page.screenshot({
      path: 'docs/verification/' + stage + '/four-humans-ready.png',
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
async function create(page: Page, nickname = '小林', capacity = 4) {
  await page.goto('/play?mode=create');
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('radio', { name: capacity + '人容量', exact: true }).check();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\/[23456789A-HJ-NP-Z]{6}$/);
  return page.url().split('/').at(-1)!;
}
async function join(page: Page, code: string, nickname = '小林', ready = true) {
  await page.goto('/play?mode=join&room=' + code);
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp('/' + (ready ? 'room' : '(?:room|table)') + '/' + code + '$'),
  );
  if (ready) await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
}
test('creates a real room through the production page and restores the private self on reload', async ({
  page,
  network,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: '创建房间', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).fill('小林');
  await page.getByRole('radio', { name: '4人容量', exact: true }).check();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\/[23456789A-HJ-NP-Z]{6}$/);
  await expect(page.getByTestId('lobby-occupancy')).toHaveText('1 / 4');
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  expect(
    network.rooms.store.all().filter((s) => s.row.roomCode === page.url().split('/').at(-1)),
  ).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '开始本手' })).toBeDisabled();
});
for (const count of [1, 2, 3])
  for (const difficulty of ['入门', '标准'])
    test(`solo ${count} ${difficulty} uses real configured bot entities`, async ({
      page,
      network,
    }) => {
      await page.goto('/play?mode=solo');
      await page.getByLabel('昵称', { exact: true }).fill('练习者');
      await page.getByRole('radio', { name: count + '个电脑', exact: true }).check();
      await page.getByRole('radio', { name: difficulty, exact: true }).check();
      await page.getByRole('button', { name: '单人练习', exact: true }).click();
      await expect(page).toHaveURL(/\/room\//);
      await expect(page.getByTestId('lobby-occupancy')).toHaveText(`${count + 1} / ${count + 1}`);
      const code = page.url().split('/').at(-1)!,
        room = network.rooms.store.findCode(code)!;
      expect(
        room.participants.filter(
          (p) =>
            p.botDifficulty === (difficulty === '标准' ? 'standard' : 'basic') && p.leftAt === null,
        ),
      ).toHaveLength(count);
      await expect(page.getByRole('button', { name: '开始本手' })).toBeDisabled();
    });
test('two same-named browsers manage capacity, sparse seats, consent, leave and host expiry', async ({
  page,
  browser,
  network,
  clock,
}) => {
  const other = await browser.newContext(),
    friend = await other.newPage();
  try {
    const code = await create(page),
      url = page.url();
    await join(friend, code);
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('2 / 4');
    expect(await friend.locator('.self-label').count()).toBe(1);
    await expect(friend.getByRole('region', { name: '房主管理' })).toHaveCount(0);
    await page.getByRole('button', { name: '座位4添加电脑', exact: true }).click();
    await expect(friend.getByTestId('seat-3')).toContainText('电脑');
    await page.getByRole('button', { name: '座位3添加电脑', exact: true }).click();
    await expect(friend.getByTestId('lobby-occupancy')).toHaveText('4 / 4');
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await friend.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
    await friend.getByRole('button', { name: '取消准备', exact: true }).click();
    await page.getByRole('button', { name: '提议重新开场', exact: true }).click();
    await expect(friend.getByRole('button', { name: '同意重新开场', exact: true })).toBeEnabled();
    await friend.getByRole('button', { name: '同意重新开场', exact: true }).click();
    await page.getByRole('button', { name: '取消重新开场', exact: true }).click();
    await friend.getByRole('button', { name: '离开房间', exact: true }).click();
    await expect(friend).toHaveURL('http://127.0.0.1:4173/');
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('3 / 4');
    await page.getByRole('button', { name: '移除座位3电脑', exact: true }).click();
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('2 / 4');
    await page.getByLabel('房间容量', { exact: true }).selectOption('2');
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('2 / 2');
    await expect(page.getByTestId('seat-3')).toContainText('电脑');
    const invitation = await page.getByRole('textbox', { name: '邀请链接' }).inputValue();
    expect(invitation).toBe('http://127.0.0.1:4173/play?mode=join&room=' + code);
    expect(invitation).not.toMatch(/token|session/i);
    await page.getByRole('button', { name: '移除座位4电脑', exact: true }).click();
    await expect(page.getByTestId('lobby-occupancy')).toHaveText('1 / 2');
    await join(friend, code, '新房主');
    await page.context().setOffline(true);
    await expect(friend.getByTestId('seat-0')).toContainText('离线保座中');
    await clock.advanceTo(clock.now() + 120001);
    await expect(friend.getByRole('region', { name: '房主管理' })).toBeVisible();
    expect(network.rooms.store.findCode(code)!.row.hostParticipantId).toBe(
      network.rooms.store
        .findCode(code)!
        .participants.find((p) => p.nickname === '新房主' && p.leftAt === null)!.participantId,
    );
    await page.context().setOffline(false);
    await friend.screenshot({
      path: 'docs/verification/' + stage + '/host-transfer-sparse.png',
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});
test('lost create confirmation survives reload and retries the same persisted UUID', async ({
  page,
  network,
  faults,
}) => {
  faults.dropEvent = 'room:create';
  faults.dropNth = 1;
  faults.seen = 0;
  await page.goto('/play?mode=create');
  await page.getByLabel('昵称', { exact: true }).fill('确认丢失');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续设置', exact: true })).toBeVisible();
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orbit.entry-intent.v1')!).steps[0].payload.commandId,
  );
  const existing = network.rooms.store
    .all()
    .filter((s) => s.participants.some((p) => p.nickname === '确认丢失'));
  expect(existing).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: '继续设置', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit.entry-intent.v1')!).steps[0].payload.commandId,
    ),
  ).toBe(before);
  expect(
    network.rooms.store.all().filter((s) => s.participants.some((p) => p.nickname === '确认丢失')),
  ).toHaveLength(1);
  faults.release?.();
});
test('recovers an uncertain ready operation without issuing a second mutation', async ({
  page,
  network,
  faults,
}) => {
  const code = await create(page, '准备确认');
  faults.dropEvent = 'room:ready';
  faults.dropNth = 1;
  faults.seen = 0;
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复房间状态', exact: true })).toBeEnabled({
    timeout: 8000,
  });
  const version = network.rooms.store.findCode(code)!.row.roomVersion;
  await page.getByRole('button', { name: '恢复房间状态', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
  expect(network.rooms.store.findCode(code)!.row.roomVersion).toBe(version);
  faults.release?.();
});
test('recovers a partial three-bot setup with real uncertain second bot commit', async ({
  page,
  network,
  faults,
}) => {
  faults.dropEvent = 'room:bot:add';
  faults.dropNth = 2;
  faults.seen = 0;
  await page.goto('/play?mode=solo');
  await page.getByLabel('昵称', { exact: true }).fill('分步确认');
  await page.getByRole('radio', { name: '3个电脑', exact: true }).check();
  await page.getByRole('button', { name: '单人练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续设置', exact: true })).toBeEnabled({
    timeout: 8000,
  });
  const room = network.rooms.store
    .all()
    .find((s) => s.participants.some((p) => p.nickname === '分步确认'))!;
  expect(room.participants.filter((p) => p.botId && p.leftAt === null)).toHaveLength(2);
  await page.screenshot({
    path: 'docs/verification/' + stage + '/partial-setup.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '继续设置', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.getByTestId('lobby-occupancy')).toHaveText('4 / 4');
  expect(
    network.rooms.store.all().filter((s) => s.participants.some((p) => p.nickname === '分步确认')),
  ).toHaveLength(1);
  faults.release?.();
});
test('shows full-room and connection errors with editable retained fields', async ({
  page,
  browser,
}) => {
  const code = await create(page, '满员房主', 2);
  await page.getByRole('button', { name: '座位2添加电脑', exact: true }).click();
  await expect(page.getByTestId('lobby-occupancy')).toHaveText('2 / 2');
  const context = await browser.newContext(),
    p = await context.newPage();
  try {
    await p.goto('/play?mode=join&room=' + code);
    await p.getByLabel('昵称', { exact: true }).fill('保留昵称');
    await p.getByRole('button', { name: '加入房间', exact: true }).click();
    await expect(p.getByRole('alert')).toContainText('房间已满');
    await expect(p.getByLabel('昵称', { exact: true })).toHaveValue('保留昵称');
    await p.getByRole('button', { name: '修改设置', exact: true }).click();
    await expect(p.getByRole('button', { name: '加入房间', exact: true })).toBeEnabled();
  } finally {
    await context.close();
  }
});
test('takeover disables the old page and never exposes a second self identity', async ({
  page,
}) => {
  const code = await create(page, '同身份');
  const second = await page.context().newPage();
  try {
    await second.goto('/room/' + code);
    await expect(second.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
    await expect(page.getByText('此身份已由另一个页面控制。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '准备', exact: true })).toBeDisabled();
    await page.screenshot({
      path: 'docs/verification/' + stage + '/taken-over.png',
      fullPage: true,
    });
  } finally {
    await second.close();
  }
});
test('shows live private owner cards and a waiting newcomer only public readonly state', async ({
  page,
  browser,
  network,
  clock,
}) => {
  const code = await create(page, '只读本人', 3);
  await page.getByRole('button', { name: '座位2添加电脑', exact: true }).click();
  await expect(page.getByTestId('lobby-occupancy')).toHaveText('2 / 3');
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
  const state = network.rooms.store.findCode(code)!,
    member = state.participants.find((p) => p.sessionId !== null)!,
    control = network.sessions.registry.getCurrent(member.sessionId!)!;
  const command: AuthenticatedCommand = {
    event: 'room:start',
    payload: {
      commandId: crypto.randomUUID(),
      roomId: state.row.roomId,
      expectedRoomVersion: state.row.roomVersion,
    },
    control,
    receivedAt: clock.now(),
  };
  const ack = await network.rooms.execute(command);
  expect(ack.ok).toBe(true);
  network.rooms.afterAck(command, ack);
  await page.goto('/table/' + code);
  await expect(page.getByTestId('self-cards').getByRole('img')).toHaveCount(2);
  await expect(page.getByTestId('action-bar')).toBeVisible();
  const context = await browser.newContext(),
    observer = await context.newPage();
  try {
    await join(observer, code, '下一手', false);
    await expect(observer).toHaveURL(new RegExp('/table/' + code + '$'));
    await observer.goto('/table/' + code);
    await expect(observer.getByTestId('table-scene')).toBeVisible();
    await expect(observer.getByTestId('self-cards')).toHaveCount(0);
    await expect(observer.locator('body')).not.toContainText('静态示意');
    await observer.screenshot({
      path: 'docs/verification/' + stage + '/waiting-readonly.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
] as const)
  test(`production pages keyboard and layout at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const [path, name] of [
      ['/', 'home'],
      ['/play?mode=solo', 'setup'],
      ['/rules', 'rules'],
    ] as const) {
      const r = await page.goto(path);
      expect(r!.status()).toBe(200);
      expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `docs/verification/${stage}/${name}-${width}x${height}.png`,
        fullPage: true,
      });
    }
    await page.goto('/play?mode=create');
    await page.getByLabel('昵称', { exact: true }).fill('小林朋友甲乙丙丁一二三四');
    await page.getByLabel('昵称', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/room\//);
    await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
    expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `docs/verification/${stage}/lobby-${width}x${height}.png`,
      fullPage: true,
    });
    const ready = page.getByRole('button', { name: '准备', exact: true });
    await ready.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
    const box = await page.getByRole('button', { name: '取消准备', exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: '历史记录', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await page.goBack();
    await expect(page.getByRole('heading', { name: '历史记录', exact: true })).toBeVisible();
  });

test('shows a motion-aware waiting indicator until the room can start', async ({ page }) => {
  await create(page, '蜂巢等待');
  const indicator = page.locator('.live-room-status .honeycomb');
  await expect(indicator.locator('span')).toHaveCount(7);
  await expect(indicator.locator('span').first()).toHaveCSS('animation-duration', '2.1s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(indicator.locator('span').first()).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: '座位2添加电脑', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始本手', exact: true })).toBeEnabled();
  await expect(indicator).toHaveCount(0);
});

test('only tilts live hole cards when pointer motion is enabled', async ({ page }) => {
  await create(page, '牌面悬停');
  await page.getByRole('button', { name: '座位2添加电脑', exact: true }).click();
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始本手', exact: true }).click();
  const card = page.getByTestId('self-cards').getByRole('img').first();
  await expect(card).toBeVisible();
  const rest = await card.evaluate((element) => getComputedStyle(element).transform);
  await card.hover({ position: { x: 25, y: 32 } });
  await expect(card).not.toHaveCSS('transform', rest);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('transform', rest);
});
