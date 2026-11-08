import { test, expect } from './release.fixture';
import {
  createUiRoom,
  joinUiRoom,
  startUiHand,
  finishUiHand,
  returnUiToRoom,
} from '../helpers/ui-hand-driver';
for (const humans of [2, 3, 4])
  test(
    humans + ' independent humans complete ten consecutive hands through production HTTP',
    async ({ page, browser, network, clock }) => {
      const contexts = await Promise.all(
        Array.from({ length: humans - 1 }, () => browser.newContext()),
      );
      try {
        const code = await createUiRoom(page),
          others = await Promise.all(contexts.map((c) => c.newPage())),
          pages = [page, ...others];
        for (const [i, p] of others.entries()) await joinUiRoom(p, code, i + 1);
        const identities = await Promise.all(
          pages.map((p) =>
            p.evaluate(() => JSON.parse(localStorage.getItem('orbit.credentials')!).sessionId),
          ),
        );
        expect(new Set(identities).size).toBe(humans);
        for (let i = 0; i < 10; i++) {
          await startUiHand(pages);
          await finishUiHand(network, clock, code, pages);
          if (i < 9) await returnUiToRoom(pages, code);
        }
      } finally {
        await Promise.all(contexts.map((c) => c.close()));
      }
    },
  );
for (const bots of [1, 2, 3])
  for (const difficulty of ['入门', '标准'])
    test(
      'one human with ' + bots + ' ' + difficulty + ' bots completes an actual hand',
      async ({ page, network, clock }) => {
        await page.goto('/play?mode=solo');
        await page.getByLabel('昵称', { exact: true }).fill('电脑矩阵');
        await page.getByRole('radio', { name: bots + '个电脑', exact: true }).check();
        await page.getByRole('radio', { name: difficulty, exact: true }).check();
        await page.getByRole('button', { name: '单人练习', exact: true }).click();
        await expect(page).toHaveURL(/\/room\//);
        const code = page.url().split('/').at(-1)!;
        await startUiHand([page]);
        await finishUiHand(network, clock, code, [page]);
      },
    );
for (const [humans, bots] of [
  [2, 1],
  [2, 2],
  [3, 1],
])
  test(
    humans + ' humans mixed with ' + bots + ' bots',
    async ({ page, browser, network, clock }) => {
      const contexts = await Promise.all(
        Array.from({ length: humans! - 1 }, () => browser.newContext()),
      );
      try {
        const code = await createUiRoom(page),
          others = await Promise.all(contexts.map((c) => c.newPage())),
          pages = [page, ...others];
        for (const [i, p] of others.entries()) await joinUiRoom(p, code, i + 1);
        for (let i = 0; i < bots!; i++)
          await page
            .getByRole('button', { name: '座位' + (humans! + i + 1) + '添加电脑', exact: true })
            .click();
        await startUiHand(pages);
        await finishUiHand(network, clock, code, pages);
      } finally {
        await Promise.all(contexts.map((c) => c.close()));
      }
    },
  );
for (const capacity of [2, 3])
  test(
    'capacity ' + capacity + ' rejects an extra entrant after a real full table',
    async ({ page, browser, network, clock }) => {
      const contexts = await Promise.all(
        Array.from({ length: capacity }, () => browser.newContext()),
      );
      try {
        const code = await createUiRoom(page, capacity),
          others = await Promise.all(contexts.map((c) => c.newPage())),
          pages = [page, ...others.slice(0, capacity - 1)];
        for (const [i, p] of others.slice(0, capacity - 1).entries())
          await joinUiRoom(p, code, i + 1);
        const extra = others.at(-1)!;
        await extra.goto('/play?mode=join&room=' + code);
        await extra.getByLabel('昵称', { exact: true }).fill('满座外');
        await extra.getByRole('button', { name: '加入房间', exact: true }).click();
        await expect(extra.getByRole('alert')).toContainText('房间已满');
        await startUiHand(pages);
        await finishUiHand(network, clock, code, pages);
      } finally {
        await Promise.all(contexts.map((c) => c.close()));
      }
    },
  );
test('a lone human cannot start and the fifth person cannot take a fourth occupied seat', async ({
  page,
  browser,
}) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  try {
    const code = await createUiRoom(page);
    await page.getByRole('button', { name: '准备', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始本手', exact: true })).toBeDisabled();
    const others = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [i, p] of others.slice(0, 2).entries()) await joinUiRoom(p, code, i + 1);
    const contenders = others.slice(2);
    await Promise.all(
      contenders.map(async (p, i) => {
        await p.goto('/play?mode=join&room=' + code);
        await p.getByLabel('昵称', { exact: true }).fill('末座候选' + i);
      }),
    );
    await Promise.all(
      contenders.map((p) => p.getByRole('button', { name: '加入房间', exact: true }).click()),
    );
    await expect.poll(() => contenders.filter((p) => p.url().includes('/room/')).length).toBe(1);
    const refused = contenders.find((p) => !p.url().includes('/room/'))!;
    await expect(refused.getByRole('alert')).toContainText('房间已满');
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
