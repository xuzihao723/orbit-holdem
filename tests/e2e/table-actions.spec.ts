const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from './table.fixture';
import type { Page, Browser } from '@playwright/test';
async function create(page: Page) {
  await page.goto('/play?mode=create');
  await page.getByLabel('昵称', { exact: true }).fill('牌桌房主');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  return page.url().split('/').at(-1)!;
}
async function join(page: Page, code: string, index: number) {
  await page.goto('/play?mode=join&room=' + code);
  await page.getByLabel('昵称', { exact: true }).fill('朋友' + index);
  await page.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(page.getByRole('button', { name: '准备', exact: true })).toBeEnabled();
}
async function twoPlayers(page: Page, browser: Browser) {
  const context = await browser.newContext(),
    other = await context.newPage(),
    code = await create(page);
  await join(other, code, 1);
  for (const p of [page, other]) await p.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始本手', exact: true }).click();
  for (const p of [page, other]) await expect(p).toHaveURL(new RegExp('/table/' + code));
  return { context, other, code };
}
test('renders actual LIFE04 main pot, side pot and separate refund after UI all-ins', async ({
  page,
  browser,
  network,
  faults,
}) => {
  faults.scenario = 'sidepots';
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const code = await create(page),
      others = await Promise.all(contexts.map((c) => c.newPage())),
      pages = [page, ...others];
    for (const [i, p] of others.entries()) await join(p, code, i + 1);
    for (const p of pages) await p.getByRole('button', { name: '准备', exact: true }).click();
    await page.getByRole('button', { name: '开始本手', exact: true }).click();
    for (const p of pages) await expect(p).toHaveURL(/\/table\//);
    while (network.rooms.store.findCode(code)!.hand!.phase !== 'settled') {
      const hand = network.rooms.store.findCode(code)!.hand!,
        p = pages[hand.betting!.actorSeatId!]!;
      await p.getByRole('button', { name: /^全押 \d/ }).click();
      const dialog = p.getByRole('dialog', { name: '确认全押', exact: true });
      if (await dialog.count())
        await p.getByRole('button', { name: '确认全押', exact: true }).click();
      await expect
        .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
        .toBeGreaterThan(hand.handVersion);
    }
    const result = page.getByRole('dialog', { name: '本手结算', exact: true });
    await expect(result.getByRole('heading', { name: '本手结算', exact: true })).toBeInViewport();
    await expect(result.getByRole('heading', { name: '主池 · 300', exact: true })).toBeVisible();
    await expect(result.getByRole('heading', { name: '边池 1 · 300', exact: true })).toBeVisible();
    await expect(result.getByText('朋友2 退回 150', { exact: true })).toBeVisible();
    expect(network.rooms.store.findCode(code)!.hand!.players.map((p) => p.stack)).toEqual([
      300, 300, 150,
    ]);
    await page.screenshot({
      path: 'docs/verification/' + stage + '/sidepots-refund.png',
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test('shows an actual split pot without inventing private cards', async ({
  page,
  browser,
  network,
  faults,
}) => {
  faults.scenario = 'tie';
  const { context, other, code } = await twoPlayers(page, browser),
    pages = [page, other];
  try {
    while (network.rooms.store.findCode(code)!.hand!.phase !== 'settled') {
      const hand = network.rooms.store.findCode(code)!.hand!,
        p = pages[hand.betting!.actorSeatId!]!;
      const button = p.getByTestId('action-bar').getByRole('button', { name: /^(过牌|跟注 \d)/ });
      await button.click();
      await expect
        .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
        .toBeGreaterThan(hand.handVersion);
    }
    expect(network.rooms.store.findCode(code)!.hand!.players.map((p) => p.stack)).toEqual([
      2000, 2000,
    ]);
    await expect(
      page
        .getByRole('dialog', { name: '本手结算', exact: true })
        .getByText('牌桌房主 获得 20', { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('dialog', { name: '本手结算', exact: true })
        .getByText('朋友1 获得 20', { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test('all-in confirmation closes on an actual controller takeover without sending', async ({
  page,
  browser,
  network,
}) => {
  const { context, other, code } = await twoPlayers(page, browser);
  const hand = network.rooms.store.findCode(code)!.hand!,
    p = hand.betting!.actorSeatId === 0 ? page : other,
    takeover = await p.context().newPage();
  try {
    await p.getByRole('button', { name: /^全押 \d/ }).click();
    await expect(p.getByRole('dialog', { name: '确认全押', exact: true })).toBeVisible();
    await takeover.goto('/table/' + code);
    await expect(takeover.getByTestId('self-cards')).toBeVisible();
    await expect(p.getByRole('dialog', { name: '确认全押', exact: true })).toHaveCount(0);
    expect(network.rooms.store.findCode(code)!.hand!.handVersion).toBe(hand.handVersion);
  } finally {
    await takeover.close();
    await context.close();
  }
});
test('short all-in call has no invented raise range and only pays the remaining stack', async ({
  page,
  browser,
  network,
  faults,
}) => {
  faults.scenario = 'short';
  const { context, other, code } = await twoPlayers(page, browser);
  try {
    await expect(page.getByLabel('加注至', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '全押 5', exact: true }).click();
    await page.getByRole('button', { name: '确认全押', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
    const hand = network.rooms.store.findCode(code)!.hand!;
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(2015);
    expect(hand.result!.refunds.map((r) => r.amount)).toEqual([5]);
    await expect(other.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('one human completes a hand against an actual standard worker', async ({
  page,
  network,
  clock,
  faults,
}) => {
  faults.scenario = 'standard';
  await page.goto('/play?mode=solo');
  await page.getByLabel('昵称', { exact: true }).fill('标准练习');
  await page.getByRole('radio', { name: '1个电脑', exact: true }).check();
  await page.getByRole('radio', { name: '标准', exact: true }).check();
  await page.getByRole('button', { name: '单人练习', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  const code = page.url().split('/').at(-1)!;
  await page.getByRole('button', { name: '准备', exact: true }).click();
  await page.getByRole('button', { name: '开始本手', exact: true }).click();
  await expect(page).toHaveURL(/\/table\//);
  let actions = 0;
  while (network.rooms.store.findCode(code)!.hand!.phase !== 'settled') {
    const hand = network.rooms.store.findCode(code)!.hand!;
    const participant = network.rooms.store
      .findCode(code)!
      .participants.find((p) => p.seatId === hand.betting!.actorSeatId)!;
    if (participant.sessionId !== null) {
      const button = page
        .getByTestId('action-bar')
        .getByRole('button', { name: /^(过牌|跟注 \d)/ });
      if (hand.players.find((p) => p.seatId === participant.seatId)!.stack > 0) {
        await expect(
          button.or(page.getByRole('button', { name: /^全押 \d/ })).first(),
        ).toBeEnabled();
        if (await button.count()) await button.click();
        else {
          await page.getByRole('button', { name: /^全押 \d/ }).click();
          const confirm = page.getByRole('button', { name: '确认全押', exact: true });
          if (await confirm.count()) await confirm.click();
        }
      }
    } else {
      await clock.advanceTo(clock.now() + 1600);
    }
    await expect
      .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion, { timeout: 10000 })
      .toBeGreaterThan(hand.handVersion);
    if (++actions > 100) throw Error('BOT_UI_ACTION_LIMIT');
  }
  await expect(page.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
  expect(network.bots.diagnostics.workerJobs).toBeGreaterThan(0);
  expect(network.rooms.store.findCode(code)!.hand!.settlementCount).toBe(1);
});
test('cancels an all-in confirmation when the actual server turn expires', async ({
  page,
  browser,
  network,
  clock,
}) => {
  const { context, other, code } = await twoPlayers(page, browser);
  try {
    const before = network.rooms.store.findCode(code)!.hand!,
      actor = before.betting!.actorSeatId;
    const p = actor === 0 ? page : other;
    await p.getByRole('button', { name: /^全押 \d/ }).click();
    await expect(p.getByRole('dialog', { name: '确认全押', exact: true })).toBeVisible();
    const deadline = network.rooms.store.findCode(code)!.turnClock!.deadline;
    await clock.advanceTo(deadline + 1);
    await expect(p.getByRole('dialog', { name: '确认全押', exact: true })).toHaveCount(0);
    const after = network.rooms.store.findCode(code)!.hand!;
    expect(after.handVersion).toBe(before.handVersion + 1);
    expect(after.players.find((x) => x.seatId === actor)!.folded).toBe(true);
    expect(after.players.some((x) => x.allIn)).toBe(false);
  } finally {
    await context.close();
  }
});
test('shows added amount and never resends an acknowledged-but-lost old turn', async ({
  page,
  browser,
  network,
  faults,
}) => {
  const { context, other, code } = await twoPlayers(page, browser);
  try {
    const before = network.rooms.store.findCode(code)!.hand!,
      actor = before.betting!.actorSeatId!,
      p = actor === 0 ? page : other,
      player = before.players.find((x) => x.seatId === actor)!;
    await p.getByLabel('加注至', { exact: true }).fill('100');
    await expect(
      p.getByText(
        '本次投入 ' + (100 - player.streetCommitted) + '，已投入 ' + player.streetCommitted + '。',
        { exact: true },
      ),
    ).toBeVisible();
    faults.dropEvent = 'game:action';
    faults.seen = 0;
    faults.dropNth = 1;
    await p.getByRole('button', { name: '加注至 100', exact: true }).click();
    await expect
      .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
      .toBe(before.handVersion + 1);
    await expect(p.getByRole('alert')).toContainText('确认尚未收到', { timeout: 8000 });
    await p.getByRole('button', { name: '原请求重试', exact: true }).click();
    await expect(p.getByRole('button', { name: '原请求重试', exact: true })).toHaveCount(0);
    const ids = faults.commands
      .filter((c) => c.event === 'game:action')
      .slice(-2)
      .map((c) => c.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    const after = network.rooms.store.findCode(code)!.hand!;
    expect(player.stack - after.players.find((x) => x.seatId === actor)!.stack).toBe(
      100 - player.streetCommitted,
    );
    expect(after.handVersion).toBe(before.handVersion + 1);
  } finally {
    faults.release?.();
    await context.close();
  }
});
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
]) {
  test(
    'actual table remains operable at ' + width + 'x' + height,
    async ({ page, browser, network }) => {
      await page.setViewportSize({ width: width!, height: height! });
      const { context, other, code } = await twoPlayers(page, browser);
      try {
        const hand = network.rooms.store.findCode(code)!.hand!,
          actor = hand.betting!.actorSeatId!;
        const target = actor === 0 ? page : other;
        if (actor !== 0) await target.setViewportSize({ width: width!, height: height! });
        await expect(target.getByTestId('self-cards')).toBeVisible();
        const button = target
          .getByTestId('action-bar')
          .getByRole('button', { name: /^(跟注 \d|过牌)/ });
        await expect(button).toBeEnabled();
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await target.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(
          width!,
        );
        await target.screenshot({
          path: 'docs/verification/' + stage + '/table-' + width + 'x' + height + '.png',
          fullPage: true,
        });
        await button.focus();
        await target.keyboard.press('Enter');
        await expect
          .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
          .toBe(hand.handVersion + 1);
      } finally {
        await context.close();
      }
    },
  );
}
for (const humans of [2, 3, 4])
  test(
    humans + ' humans complete a real hand and prepare without automatic restart',
    async ({ page, browser, network }) => {
      const contexts = await Promise.all(
        Array.from({ length: humans - 1 }, () => browser.newContext()),
      );
      try {
        const code = await create(page),
          others = await Promise.all(contexts.map((c) => c.newPage())),
          pages = [page, ...others];
        for (const [i, p] of others.entries()) await join(p, code, i + 1);
        for (const p of pages) await p.getByRole('button', { name: '准备', exact: true }).click();
        await expect(page.getByRole('button', { name: '开始本手', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '开始本手', exact: true }).click();
        for (const p of pages) await expect(p).toHaveURL(new RegExp('/table/' + code));
        let actions = 0;
        while (network.rooms.store.findCode(code)?.hand?.phase !== 'settled') {
          const hand = network.rooms.store.findCode(code)!.hand!;
          const participant = network.rooms.store
            .findCode(code)!
            .participants.find((p) => p.seatId === hand.betting!.actorSeatId && p.leftAt === null)!;
          const index = network.rooms.store
            .findCode(code)!
            .participants.filter((p) => p.sessionId !== null)
            .findIndex((p) => p.participantId === participant.participantId);
          const acting = pages[index]!;
          const passive = acting
            .getByTestId('action-bar')
            .getByRole('button', { name: /^(过牌|跟注 \d+)/ });
          await expect(passive).toBeEnabled();
          await passive.click();
          await expect
            .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
            .toBeGreaterThan(hand.handVersion);
          if (++actions > 100) throw Error('UI_HAND_ACTION_LIMIT');
        }
        const state = network.rooms.store.findCode(code)!;
        expect(state.hand!.players.reduce((n, p) => n + p.stack, 0)).toBe(humans * 2000);
        await expect(page.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '准备下一手', exact: true }).click();
        await expect(page).toHaveURL(new RegExp('/room/' + code));
        await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
        expect(network.rooms.store.findCode(code)!.hand!.phase).toBe('settled');
      } finally {
        await Promise.all(contexts.map((c) => c.close()));
      }
    },
  );
