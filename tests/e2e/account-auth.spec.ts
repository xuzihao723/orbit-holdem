import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApplicationRuntime } from '../../apps/server/dist/application-runtime.js';
import { createPokerServer } from '../../apps/server/dist/create-server.js';

const stage = process.env.ORBIT_VERIFY_STAGE ?? 'w45-w50';

test('signs in through Google with no password and returns to the invitation', async ({ page }) => {
  const app = createApplicationRuntime({ databasePath: ':memory:' });
  const origin = 'http://127.0.0.1:4174';
  const fakeGoogle = createServer((request, response) => {
    const state = new URL(request.url ?? '/', 'http://localhost').searchParams.get('state');
    if (!state || !/^[\w-]{43}$/.test(state)) {
      response.writeHead(400).end();
      return;
    }
    const callback = origin + '/api/auth/google/callback?code=google-test-code&amp;state=' + state;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<a href="${callback}">选择测试 Google 账号</a>`);
  });
  await new Promise<void>((resolve) => fakeGoogle.listen(0, 'localhost', resolve));
  const googleOrigin = 'http://localhost:' + (fakeGoogle.address() as AddressInfo).port;
  const server = createPokerServer({
    port: 4174,
    webOrigin: origin,
    application: app,
    webDist: resolve('apps/web/dist'),
    accounts: { codeKey: Buffer.alloc(32, 18), deliver: async () => {} },
    google: {
      authorizationUrl: ({ state }) => googleOrigin + '/?state=' + state,
      async identity(code) {
        expect(code).toBe('google-test-code');
        return { subject: 'fake-google-id', email: 'player@gmail.com', nickname: 'Google 玩家' };
      },
    },
  });
  await server.listen();
  try {
    await page.goto(origin + '/play?mode=create');
    await page.getByLabel('昵称', { exact: true }).fill('游客的设置');
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page).toHaveURL(/\/room\//);
    await page.evaluate(() => {
      const key = 'orbit.entry-intent.v1';
      const guestIntent = JSON.parse(localStorage.getItem(key)!);
      localStorage.setItem(key, JSON.stringify({ ...guestIntent, status: 'uncertain' }));
    });
    const invite = origin + '/play?mode=join&room=ABC234';
    await page.goto(invite);
    await page.getByRole('link', { name: '登录后继续' }).click();
    await page.getByRole('link', { name: '旧邮箱账号登录' }).click();
    await expect(page.locator('input[type=password]')).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole('button', { name: '使用 Google 登录' })).toBeEnabled();
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    if (page.viewportSize()!.width === 360)
      await page.screenshot({
        path: `docs/verification/${stage}/google-login-360.png`,
        fullPage: true,
      });
    await expect(page.getByRole('link', { name: '以游客继续' })).toBeVisible();
    await page.getByRole('button', { name: '使用 Google 登录' }).click();
    await page.getByRole('link', { name: '选择测试 Google 账号' }).click();
    await expect(page).toHaveURL(invite);
    await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('Google 玩家');
    await expect(page.getByRole('button', { name: '加入房间', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await page.getByRole('link', { name: '我的账号' }).click();
    await expect(page.getByText('Google 玩家 · p***@gmail.com')).toBeVisible();
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await page.getByRole('link', { name: '创建房间', exact: true }).click();
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page).toHaveURL(/\/room\//);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('orbit.entry-intent.v1')!).status),
    ).toBe('uncertain');
  } finally {
    await server.close();
    await app.close();
    await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
  }
});

test('registers on mobile, uses the account at a table and signs in again after password reset', async ({
  page,
}) => {
  const app = createApplicationRuntime({ databasePath: ':memory:' });
  const outbox: { code: string; email: string }[] = [];
  const origin = 'http://127.0.0.1:4174';
  const server = createPokerServer({
    port: 4174,
    webOrigin: origin,
    application: app,
    webDist: resolve('apps/web/dist'),
    accounts: {
      codeKey: Buffer.alloc(32, 18),
      deliver: async (message) => {
        outbox.push(message);
      },
    },
  });
  await server.listen();
  const email = 'orbit.player@gmail.com';
  const password = 'orbit-long-password-1';
  try {
    const width = page.viewportSize()!.width;
    await page.goto(origin);
    await page.getByRole('link', { name: '登录 / 注册' }).click();
    if (width === 360)
      await page.screenshot({ path: `docs/verification/${stage}/login-360.png`, fullPage: true });
    await page.getByRole('link', { name: '注册账号' }).click();
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByRole('button', { name: '发送验证码', exact: true }).click();
    await expect.poll(() => outbox.length).toBe(1);
    await page.getByLabel('验证码', { exact: true }).fill(outbox[0]!.code);
    await page.getByRole('button', { name: '验证邮箱' }).click();
    await page.getByLabel('昵称', { exact: true }).fill('邮箱玩家');
    await page.getByLabel('设置密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '创建账号' }).click();
    await expect(page.getByRole('link', { name: '我的账号' })).toBeVisible();
    await page.getByRole('link', { name: '创建房间', exact: true }).click();
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(page).toHaveURL(/\/room\//);
    const roomCode = page.url().split('/').at(-1)!;
    await page.goto(origin + '/account');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('link', { name: '登录 / 注册' })).toBeVisible();
    const invitation = origin + '/play?mode=join&room=' + roomCode;
    await page.goto(invitation);
    await page.getByRole('link', { name: '登录后继续' }).click();
    await page.getByRole('link', { name: '忘记密码' }).click();
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByRole('button', { name: '发送验证码', exact: true }).click();
    await expect.poll(() => outbox.length).toBe(2);
    await page.getByLabel('验证码', { exact: true }).fill(outbox[1]!.code);
    await page.getByRole('button', { name: '验证邮箱' }).click();
    await page.getByLabel('设置新密码', { exact: true }).fill('orbit-new-long-password');
    await page.getByRole('button', { name: '重置密码' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill('orbit-new-long-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(invitation);
    await page.getByRole('link', { name: '返回首页', exact: true }).click();
    await expect(page.getByRole('link', { name: '我的账号' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  } finally {
    await server.close();
    await app.close();
  }
});
