import { test, expect } from '@playwright/test';
test('temporary homepage entry is prominent, responsive and links to recruitment', async ({ page }, info) => {
  test.setTimeout(60_000);
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const banner = page.locator('.join-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('href', '/join');
    expect((await banner.boundingBox())!.y).toBeLessThan(220);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('temporary-join-home.png'), fullPage: true });
  await page.locator('.join-banner').click();
  await expect(page).toHaveURL('/join');
  await expect(page.getByRole('heading', { name: '加入我们', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('join-public.png'), fullPage: true });
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.locator('.main-nav a[href="/projects"]').focus();
    await expect(page.locator('.nav-menu')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.nav-menu')).toBeHidden();
  }
});
