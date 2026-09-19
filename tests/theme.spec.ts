import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { THEME_PRESETS } from '../src/theme/presets';

async function settled(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', 'reveal');
}
async function pixel(image: Buffer, x: number, y: number) {
  return [
    ...(await sharp(image)
      .extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer())
  ];
}

test('preset and custom HCT palettes persist through routes/reloads; picker works on mobile', async ({
  page
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '选择主题色' }).click();
  const dialog = page.getByRole('dialog', { name: '主题设置' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('radio', { name: '鸢尾紫' })).toBeChecked();
  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary')
  );
  await page.getByRole('radio', { name: '松石青' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#008577');
  await settled(page);
  const after = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary')
  );
  expect(after).not.toBe(before);
  await page.getByRole('textbox', { name: '自定义主题色', exact: true }).fill('#zzzzzz');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('完整的十六进制颜色');
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#008577');
  await page.getByRole('textbox', { name: '自定义主题色', exact: true }).fill('#336699');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#336699');
  await settled(page);
  await page.screenshot({ path: info.outputPath('theme-picker.png'), fullPage: true });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '选择主题色' })).toBeFocused();
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  await page.locator('.main-nav').getByRole('link', { name: '证书验真' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#336699');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#336699');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '选择主题色' }).click();
  await page.getByRole('button', { name: '恢复默认色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#6750a4');
  await settled(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('circular reveal keeps old pixels outside and new pixels inside, in both directions', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Root snapshot pixel geometry is checked once at DPR 1');
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = original.call(this, keyframes, options);
      if (typeof options === 'object' && options.pseudoElement === '::view-transition-new(root)') {
        animation.pause();
        animation.currentTime = 100;
        (window as any).themeAnimation = animation;
      }
      return animation;
    };
  });
  await page.goto('/');
  for (const [i, mode] of ['深色', '浅色'].entries()) {
    const button = page.getByRole('button', { name: `切换${mode}模式` });
    const bounds = (await button.boundingBox())!;
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    const inside = { x, y: bounds.y + bounds.height + 16 };
    const before = await page.screenshot();
    await page.evaluate(() => {
      (window as any).themeAnimation = null;
    });
    await button.click();
    await page.waitForFunction(() => !!(window as any).themeAnimation);
    const keyframes = await page.evaluate(() => (window as any).themeAnimation.effect.getKeyframes());
    expect(keyframes[0].clipPath).toBe(`circle(0px at ${x}px ${y}px)`);
    const during = await page.screenshot({ path: info.outputPath(`circle-${i}-midpoint.png`), animations: 'allow' });
    expect(await pixel(during, 2, 2)).toEqual(await pixel(before, 2, 2));
    expect(await pixel(during, inside.x, inside.y)).not.toEqual(await pixel(before, inside.x, inside.y));
    await page.evaluate(() => (window as any).themeAnimation.finish());
    await settled(page);
    const after = await page.screenshot();
    expect(await pixel(during, inside.x, inside.y)).toEqual(await pixel(after, inside.x, inside.y));
    expect(await pixel(after, 2, 2)).not.toEqual(await pixel(before, 2, 2));
  }
});

test('hover has spatial feedback, parallax resets, and route changes animate without remount tricks', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Hover requires a fine pointer');
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.id === 'main') {
        (window as any).routeAnimationFrames = keyframes;
        (window as any).routeAnimationOptions = options;
      }
      return original.call(this, keyframes, options);
    };
  });
  await page.goto('/');
  const cta = page.locator('.hero-actions .link-button');
  await cta.hover();
  await expect.poll(() => cta.evaluate(e => getComputedStyle(e).translate)).not.toBe('none');
  await page.locator('#hero-title').hover();
  expect(
    await page
      .locator('.title-letter')
      .first()
      .evaluate(e => getComputedStyle(e).animationName)
  ).toBe('title-hop');
  await page.locator('.blog-card').hover();
  await expect.poll(() => page.locator('.book-page').evaluate(e => getComputedStyle(e).rotate)).not.toBe('none');
  const art = page.locator('.hero-art');
  await art.scrollIntoViewIfNeeded();
  const bounds = (await art.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.4);
  await expect.poll(() => art.evaluate(e => (e as HTMLElement).style.getPropertyValue('--pointer-x'))).not.toBe('');
  await page.mouse.move(2, 2);
  await expect.poll(() => art.evaluate(e => (e as HTMLElement).style.getPropertyValue('--pointer-x'))).toBe('');
  await page.evaluate(() => {
    (window as any).routeAnimationFrames = null;
  });
  await page.locator('.main-nav').getByRole('link', { name: '素质问卷', exact: true }).click();
  await expect(page).toHaveURL(/\/assessment$/);
  await expect(page.locator('main h1')).toContainText('社区规则问卷');
  await expect.poll(() => page.evaluate(() => (window as any).routeAnimationFrames)).not.toBeNull();
  const frames = await page.evaluate(() => (window as any).routeAnimationFrames);
  expect(frames[0].opacity).toBe(0);
  expect(frames[0].filter).toBe('blur(5px)');
  expect(frames[0].clipPath).toContain('inset');
  expect(frames[1].opacity).toBe(1);
  expect(frames[1].filter).toBe('blur(0)');
  expect(await page.evaluate(() => (window as any).routeAnimationOptions.duration)).toBe(500);
});

test('title counter always wipes out after hexadecimal counting speeds up', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Hover requires a fine pointer');
  await page.goto('/');
  const line = page.locator('.counting-line');
  const plaque = line.locator('.title-plaque');
  const closedClip = await plaque.evaluate(element => getComputedStyle(element).clipPath);

  await line.hover();
  await expect(line).toHaveClass(/is-lit/);
  await expect
    .poll(async () => {
      const text = (await line.locator('.title-counter').textContent()) ?? '';
      return Number.parseInt(text.replace('i = ', ''), 16);
    })
    .toBeGreaterThan(0xe);
  await expect.poll(() => plaque.evaluate(element => getComputedStyle(element).clipPath)).not.toBe(closedClip);

  await page.mouse.move(2, 2);
  await expect(line).not.toHaveClass(/is-lit/);
  await expect
    .poll(() => plaque.evaluate(element => element.getAnimations().some(animation => animation.playState === 'running')))
    .toBe(true);
  await expect.poll(() => plaque.evaluate(element => getComputedStyle(element).clipPath)).toBe(closedClip);
  const stoppedAt = await line.locator('.title-counter').textContent();
  await page.waitForTimeout(150);
  expect(await line.locator('.title-counter').textContent()).toBe(stoppedAt);

  await line.hover();
  await expect(line).toHaveClass(/is-lit/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(line).not.toHaveClass(/is-lit/);
  await expect.poll(() => plaque.evaluate(element => getComputedStyle(element).clipPath)).toBe(closedClip);
});

test('reduced motion and missing/failed View Transition API preserve usable theme controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as any).transitionCalls = 0;
    document.startViewTransition = (() => {
      (window as any).transitionCalls++;
      throw new Error('unsupported');
    }) as any;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => (window as any).transitionCalls)).toBe(0);
  expect(await page.locator('.hero-copy h1').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  expect(await page.locator('main').evaluate(e => e.getAnimations().length)).toBe(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', 'reveal');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '切换浅色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settled(page);
  expect(await page.evaluate(() => (window as any).transitionCalls)).toBe(1);
  await page.evaluate(() => {
    (document as any).startViewTransition = undefined;
  });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
});

test('theme changes preserve typed form state even if browser storage is denied', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      }
    })
  );
  await page.goto('/assessment');
  await page.getByRole('textbox', { name: /证书昵称/ }).fill('我的未提交昵称');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  await expect(page.getByRole('textbox', { name: /证书昵称/ })).toHaveValue('我的未提交昵称');
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '选择主题色' }).click();
  await page.getByRole('radio', { name: '海盐蓝' }).check();
  await settled(page);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-seed', '#3768c4');
  await expect(page.getByRole('textbox', { name: /证书昵称/ })).toHaveValue('我的未提交昵称');
});

test('rapid requests settle on last intent; keyboard theme toggle uses button center', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.mode-toggle')!;
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  const toggle = page.getByRole('button', { name: '切换浅色模式' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settled(page);
  await expect(page.getByRole('button', { name: '切换深色模式' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('six generated palettes have accessible light/dark pages and a usable narrow dialog', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Color/width matrix is run once');
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '选择主题色' }).click();
  for (const preset of THEME_PRESETS) {
    await page.getByRole('radio', { name: preset.name }).check();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    for (const mode of ['light', 'dark']) {
      const current = await page.locator('html').getAttribute('data-theme');
      if (current !== mode) await page.locator('.mode-toggle').click();
      for (const surface of ['page', 'dialog']) {
        if (surface === 'dialog') await page.getByRole('button', { name: '选择主题色' }).click();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(
          results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'),
          `${preset.name}/${mode}/${surface}`
        ).toEqual([]);
      }
      await page.getByRole('button', { name: '完成', exact: true }).click();
    }
    await page.getByRole('button', { name: '选择主题色' }).click();
  }
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 740 });
    const bounds = (await page.getByRole('dialog').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  }
});
