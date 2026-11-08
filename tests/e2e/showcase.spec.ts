import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './release.fixture';
import { createUiRoom, finishUiHand, joinUiRoom, startUiHand } from '../helpers/ui-hand-driver';

const out = 'test-results/w42-showcase';
const origin = 'http://127.0.0.1:4173';
const viewport = { width: 1280, height: 800 };

test('records a local showcase with independent identities and real actions', async ({
  browser,
  network,
  clock,
}) => {
  mkdirSync(out, { recursive: true });
  async function chapter(
    name: string,
    work: (page: Page, addGuest: () => Promise<Page>) => Promise<void>,
  ) {
    const context = await browser.newContext({
      baseURL: origin,
      viewport,
      recordVideo: { dir: out, size: viewport },
    });
    const companions: BrowserContext[] = [];
    const page = await context.newPage();
    const recording = page.video()!;
    try {
      await work(page, async () => {
        const guest = await browser.newContext({ baseURL: origin });
        companions.push(guest);
        return guest.newPage();
      });
      await delay(1500);
    } finally {
      await Promise.all(companions.map((guest) => guest.close()));
      await context.close();
    }
    await recording.saveAs(out + '/' + name + '.webm');
  }
  await chapter('01-home', async (page) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '轨道牌桌', exact: true })).toBeVisible();
    await page.screenshot({ path: out + '/home.png' });
  });
  await chapter('02-solo', async (page) => {
    await page.goto('/play?mode=solo');
    await page.getByLabel('昵称', { exact: true }).fill('本地演示');
    await page.getByRole('radio', { name: '1个电脑', exact: true }).check();
    await page.getByRole('radio', { name: '入门', exact: true }).check();
    await delay(700);
    await page.getByRole('button', { name: '单人练习', exact: true }).click();
    await expect(page).toHaveURL(/\/room\//);
    const code = page.url().split('/').at(-1)!;
    await startUiHand([page]);
    await delay(900);
    await finishUiHand(network, clock, code, [page]);
  });
  for (const humans of [2, 3, 4]) {
    const name = humans === 2 ? '03-two' : humans === 3 ? '04-three' : '05-mixed';
    await chapter(name, async (page, addGuest) => {
      const code = await createUiRoom(page);
      const pages = [page];
      const mixed = humans === 4;
      for (let i = 1; i < (mixed ? 2 : humans); i++) {
        const guest = await addGuest();
        await joinUiRoom(guest, code, i);
        pages.push(guest);
      }
      if (mixed) {
        await page.getByRole('button', { name: '座位3添加电脑', exact: true }).click();
        await page.getByLabel('添加电脑难度').selectOption('standard');
        await page.getByRole('button', { name: '座位4添加电脑', exact: true }).click();
      }
      await delay(1100);
      await startUiHand(pages);
      if (humans === 2) await page.screenshot({ path: out + '/table.png' });
      await delay(1100);
      await finishUiHand(network, clock, code, pages);
    });
  }
  await chapter('06-reconnect', async (page, addGuest) => {
    const code = await createUiRoom(page);
    const other = await addGuest();
    await joinUiRoom(other, code, 1);
    await startUiHand([page, other]);
    const version = network.rooms.store.findCode(code)!.hand!.handVersion;
    await page.context().setOffline(true);
    await expect(page.getByText('连接已断开，操作暂不可用。', { exact: false })).toBeVisible();
    await delay(5000);
    await page.context().setOffline(false);
    await expect(page.locator('.live-table')).toHaveAttribute('data-hand-version', String(version));
    await expect(page.getByRole('button', { name: '弃牌', exact: true })).toBeEnabled();
    await delay(800);
    await page.getByRole('button', { name: '弃牌', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '本手结算' })).toBeVisible();
  });
  await chapter('07-replay', async (page, addGuest) => {
    const code = await createUiRoom(page);
    const other = await addGuest();
    await joinUiRoom(other, code, 1);
    await startUiHand([page, other]);
    await page.getByRole('button', { name: '弃牌', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '本手结算' })).toBeVisible();
    await page.goto('/history');
    await delay(900);
    await page.getByRole('link', { name: '查看回放', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await delay(800);
    await page.getByRole('button', { name: '末步', exact: true }).click();
    await expect(page.getByText('其余玩家弃牌', { exact: true })).toBeVisible();
    await page.screenshot({ path: out + '/replay.png', fullPage: true });
  });
  const mobile = await browser.newContext({
    baseURL: origin,
    viewport: { width: 360, height: 640 },
  });
  const companion = await browser.newContext({ baseURL: origin });
  try {
    const page = await mobile.newPage();
    const other = await companion.newPage();
    const code = await createUiRoom(page);
    await joinUiRoom(other, code, 1);
    await startUiHand([page, other]);
    await expect(page.getByRole('button', { name: '弃牌', exact: true })).toBeEnabled();
    await page.screenshot({ path: out + '/mobile-360.png', fullPage: true });
  } finally {
    await companion.close();
    await mobile.close();
  }
});
