const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from './app.fixture';
import { readFileSync, writeFileSync } from 'node:fs';
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
  [1280, 720],
  [1440, 900],
])
  test('preferences, focus and persistence at ' + width + 'x' + height, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/');
    const open = page.getByRole('button', { name: '设置', exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '牌桌设置', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('开启音效', { exact: true })).not.toBeChecked();
    await page.getByLabel('花色模式', { exact: true }).selectOption('four');
    await page.getByLabel('统一牌背', { exact: true }).selectOption('orbit-simple');
    await page.getByLabel('减少动画', { exact: true }).check();
    await page.getByLabel('开启音效', { exact: true }).check();
    await page.getByLabel('开启音效', { exact: true }).uncheck();
    await page.screenshot({
      path: 'docs/verification/' + stage + '/settings-' + width + '.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-suit-theme', 'four');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-reduce-motion', 'true');
    await page.reload();
    await open.click();
    await expect(page.getByLabel('花色模式')).toHaveValue('four');
    await expect(page.getByLabel('统一牌背')).toHaveValue('orbit-simple');
    expect(await page.locator('html').evaluate((n) => n.scrollWidth)).toBeLessThanOrEqual(width!);
  });
test('browser decodes all ten genuine audio exports', async ({ page }) => {
  await page.goto('/');
  const result = [];
  for (const id of ['deal', 'flip', 'action', 'win', 'join'])
    for (const format of ['ogg', 'mp3']) {
      const bytes = readFileSync('assets/audio/' + id + '.' + format).toString('base64');
      const decoded = await page.evaluate(async (encoded) => {
        const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
          context = new AudioContext();
        try {
          const buffer = await context.decodeAudioData(data.buffer);
          return { duration: buffer.duration, channels: buffer.numberOfChannels };
        } finally {
          await context.close();
        }
      }, bytes);
      expect(decoded.duration).toBeGreaterThan(0.08);
      expect(decoded.duration).toBeLessThan(0.55);
      expect(decoded.channels).toBe(1);
      result.push({ id, format, ...decoded });
    }
  writeFileSync(
    'docs/verification/' + stage + '-browser-audio.json',
    JSON.stringify(result, null, 2) + '\n',
  );
});
