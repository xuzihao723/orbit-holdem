const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { expect, test } from '@playwright/test';

test('browser reaches the actual server through the frontend proxy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '轨道牌桌' })).toBeVisible();
  await expect(page.getByText('服务连接正常', { exact: true })).toBeVisible();
  const response = await page.request.get('/health/live');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  await page.screenshot({ path: 'docs/verification/' + stage + '/startup.png', fullPage: true });
});

test('shows a recoverable message when its health request is refused', async ({ page }) => {
  await page.route('**/health/live', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByText('暂时无法连接服务，请稍后重试。', { exact: true })).toBeVisible();
  await page.unroute('**/health/live');
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByText('服务连接正常', { exact: true })).toBeVisible();
});

test('shows failure rather than success for an HTTP error response', async ({ page }) => {
  await page.route('**/health/live', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('/');
  await expect(page.getByText('暂时无法连接服务，请稍后重试。', { exact: true })).toBeVisible();
});
