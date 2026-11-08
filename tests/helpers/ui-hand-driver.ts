import { expect, type Page } from '@playwright/test';
import type { ApplicationRuntime } from '../../apps/server/dist/application-runtime.js';
import type { FakeClock } from './fake-clock.js';
export async function createUiRoom(page: Page, capacity = 4) {
  await page.goto('/play?mode=create');
  await page.getByLabel('昵称', { exact: true }).fill('模式房主');
  await page.getByRole('radio', { name: capacity + '人容量', exact: true }).check();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
  return page.url().split('/').at(-1)!;
}
export async function joinUiRoom(page: Page, code: string, index: number) {
  await page.goto('/play?mode=join&room=' + code);
  await page.getByLabel('昵称', { exact: true }).fill('朋友' + index);
  await page.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(page).toHaveURL(/\/room\//);
}
export async function startUiHand(pages: Page[]) {
  for (const p of pages) {
    await p.getByRole('button', { name: '准备', exact: true }).click();
    await expect(p.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
  }
  await pages[0]!.getByRole('button', { name: '开始本手', exact: true }).click();
  for (const p of pages) await expect(p).toHaveURL(/\/table\//);
}
export async function finishUiHand(
  network: ApplicationRuntime,
  clock: FakeClock,
  code: string,
  pages: Page[],
) {
  let actions = 0;
  while (network.rooms.store.findCode(code)!.hand!.phase !== 'settled') {
    const room = network.rooms.store.findCode(code)!,
      hand = room.hand!,
      actor = room.participants.find(
        (p) => p.seatId === hand.betting!.actorSeatId && p.leftAt === null,
      )!;
    if (actor.sessionId === null) await clock.advanceTo(clock.now() + 1600);
    else {
      const index = room.participants
          .filter((p) => p.sessionId !== null && p.leftAt === null)
          .findIndex((p) => p.participantId === actor.participantId),
        page = pages[index]!;
      await expect(page.locator('.live-table')).toHaveAttribute(
        'data-hand-version',
        String(hand.handVersion),
      );
      const passive = page
        .getByTestId('action-bar')
        .getByRole('button', { name: /^(过牌|跟注 \d)/ });
      if (await passive.count()) await passive.click();
      else {
        await page.getByRole('button', { name: /^全押 \d/ }).click();
        const confirm = page.getByRole('button', { name: '确认全押', exact: true });
        if (await confirm.count()) await confirm.click();
      }
    }
    await expect
      .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion, { timeout: 10000 })
      .toBeGreaterThan(hand.handVersion);
    if (++actions > 200) throw Error('RELEASE_UI_HAND_LIMIT');
  }
  const settled = network.rooms.store.findCode(code)!.hand!;
  expect(settled.settlementCount).toBe(1);
  expect(settled.players.reduce((n, p) => n + p.stack, 0)).toBe(settled.initialChipTotal);
  for (const page of pages)
    await expect(page.getByRole('dialog', { name: '本手结算', exact: true })).toBeVisible();
  return actions;
}
export async function returnUiToRoom(pages: Page[], code: string) {
  for (const page of pages) {
    await page
      .getByRole('dialog', { name: '本手结算', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await page.getByRole('link', { name: '返回等待房间', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/room/' + code + '$'));
  }
}
