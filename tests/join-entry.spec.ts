import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('temporary recruitment button leads the hero actions without a banner or narrow-screen overflow', async ({
  page
}, info) => {
  test.setTimeout(90_000);
  for (const width of [320, 375, 600, 601, 700, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const join = page.locator('.hero-actions .join-entry');
    const explore = page.locator('.hero-actions .hero-explore');
    await expect(join).toBeVisible();
    await expect(join).toHaveAttribute('href', '/join');
    await expect(page.locator('.join-banner')).toHaveCount(0);
    const joinBox = (await join.boundingBox())!;
    const exploreBox = (await explore.boundingBox())!;
    // The join entry owns the first action row; secondary actions stack below it,
    // left-aligned, at every width (see src/join-entry.css).
    expect(joinBox.y + joinBox.height).toBeLessThanOrEqual(exploreBox.y + 1);
    expect(Math.abs(joinBox.x - exploreBox.x)).toBeLessThan(2);
    expect(await join.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThan(
      await explore.evaluate(e => parseFloat(getComputedStyle(e).fontSize))
    );
    expect(await join.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(
      await explore.evaluate(e => getComputedStyle(e).backgroundColor)
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `overflow at ${width}px: ${await page.evaluate(() =>
        [...document.querySelectorAll('header *,main *,footer *')]
          .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8)
          .map(e => `${e.tagName}.${e.className}`)
          .join(', ')
      )}`
    ).toBe(true);
    expect(joinBox.y).toBeLessThan(650);
    if (width === 375 || width === 1440) await page.screenshot({ path: info.outputPath(`hero-join-${width}.png`) });
  }
  await page.locator('.join-entry').click();
  await expect(page).toHaveURL('/join');
  await expect(page.getByRole('heading', { name: '加入我们', exact: true })).toBeVisible();
});

test('recruitment button has finite hover, focus and press feedback with a stable target', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Fine-pointer feedback is checked once');
  await page.goto('/');
  const button = page.locator('.join-entry');
  await expect(button).toBeVisible();
  // 入场动画作用在 hero-actions 等后代上，等整棵文档的动画结束再量几何。
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  const baseShadow = await button.evaluate(e => getComputedStyle(e).boxShadow);
  const before = (await button.boundingBox())!;
  await page.mouse.move(before.x + 1, before.y + before.height / 2);
  await expect.poll(() => button.evaluate(e => e.matches(':hover'))).toBe(true);
  await expect.poll(() => button.evaluate(e => getComputedStyle(e).boxShadow)).not.toBe(baseShadow);
  await expect.poll(() => button.locator('svg').evaluate(e => getComputedStyle(e).translate)).not.toBe('none');
  const after = (await button.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  await button.focus();
  expect(await button.evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe('none');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page).toHaveURL('/join');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await button.hover();
  expect(await button.evaluate(e => e.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
});

test('recruitment accent remains accessible in light and dark modes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Theme accessibility matrix is checked once');
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
    const token = theme === 'light' ? '--md-sys-color-primary' : '--md-sys-color-primary-container';
    expect(
      await page.locator('.join-entry').evaluate(e => getComputedStyle(e).getPropertyValue('--join-entry-bg').trim())
    ).toBe(
      await page.evaluate(token => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), token)
    );
    const results = await new AxeBuilder({ page })
      .include('.hero-actions')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});
