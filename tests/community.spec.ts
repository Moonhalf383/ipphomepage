import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEME_PRESETS } from '../src/theme/presets';

// 这些用例断言的是版式与交互，不是名单内容，所以统一跑在固定的演示成员上，
// 真实 people.json 增删成员不会让它们变红。见 src/content/PeopleProvider.tsx。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ipp:demo-people', '1'));
});

test('member books filter by group/year/search and expose full profiles and bookmark links', async ({ page }, info) => {
  await page.goto('/people');
  await expect(page.locator('.person-book')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: '站娘 · 待施工' })).toBeVisible();
  await expect(page.locator('.mascot, .mascot-head, .mascot-gaze')).toHaveCount(0);
  await expect(page.locator('.demo-people-notice')).toContainText('均为虚构');
  const book = page.locator('[data-person-id="dev-person-01"]');
  await expect(book.locator('.person-bookmark')).toHaveCount(4);
  await expect(page.locator('.person-content .person-avatar.lead-avatar')).toHaveCount(1);
  await expect(page.locator('.person-book').first()).toHaveAttribute('data-person-id', 'dev-person-01');
  expect(await book.locator('.person-content .person-avatar').evaluate(e => getComputedStyle(e).borderRadius)).toBe(
    '4px'
  );
  expect(
    await page
      .locator('[data-person-id="dev-person-02"] .person-content .person-avatar')
      .evaluate(e => getComputedStyle(e).borderRadius)
  ).toBe('20px');
  await book.getByRole('button', { name: /全部4条链接/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.profile-links a')).toHaveCount(4);
  await expect(dialog.locator('.profile-links a').first()).toHaveAttribute('rel', 'noopener noreferrer');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(book.getByRole('button', { name: /全部4条链接/ })).toBeFocused();
  await book.getByRole('button', { name: /完整简介/ }).click();
  await expect(dialog.locator('.person-full-description')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  // Missing runtime image has a real fallback (separate from build-time file validation).
  await book.locator('.person-content img').evaluate(img => img.setAttribute('src', '/not-an-avatar.png'));
  await expect(book.locator('.avatar-fallback')).toBeVisible();
  await page.getByRole('button', { name: '支持者', exact: true }).click();
  await expect(page.locator('.person-book')).toHaveCount(4);
  await page.getByRole('button', { name: '核心成员', exact: true }).click();
  await expect(page.locator('.person-book')).toHaveCount(8);
  await page.getByRole('button', { name: '所有人', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索成员' }).fill('没有这样的名字');
  await expect(page.getByRole('heading', { name: '这一页还没有找到。' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.person-book')).toHaveCount(12);
  const years = await page.getByRole('combobox', { name: '年级', exact: true }).locator('option').allTextContents();
  expect(years.length).toBeGreaterThan(2);
  await page.getByRole('combobox', { name: '年级', exact: true }).selectOption({ index: 1 });
  expect(await page.locator('.person-book').count()).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: '年级', exact: true }).selectOption('all');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('people-books.png'), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('.person-book')).toHaveCount(12);
});

test('people filters use custom surfaces while focus rings stay on the interactive controls', async ({ page }) => {
  await page.goto('/people');

  const search = page.getByRole('searchbox', { name: '搜索成员' });
  await search.focus();
  await expect(search.locator('xpath=..')).toHaveCSS('outline-style', 'solid');
  await expect(search.locator('xpath=..')).toHaveCSS('outline-width', '2px');
  await expect(search.locator('xpath=..')).toHaveCSS('outline-offset', '-2px');
  await expect(search).toHaveCSS('outline-style', 'none');

  const year = page.getByRole('combobox', { name: '年级', exact: true });
  const customizable = await page.evaluate(() => CSS.supports('appearance', 'base-select'));
  await expect(year).toHaveCSS('appearance', customizable ? 'base-select' : 'none');
  await expect(year).toHaveCSS('min-height', '48px');
  await expect(year).toHaveCSS('border-radius', '12px');
  await expect(page.locator('.year-select > svg')).toBeVisible();
  await year.focus();
  await expect(year.locator('xpath=..')).toHaveCSS('outline-style', 'none');
  await expect(year).toHaveCSS('outline-style', 'solid');
  await expect(year).toHaveCSS('outline-width', '2px');
  await expect(year).toHaveCSS('outline-offset', '-2px');
});

test('projects show real sources and events have an honest empty state', async ({ page }, info) => {
  await page.goto('/projects');
  await expect(page.locator('.project-card')).toHaveCount(4);
  const engine = page.locator('[data-project-id="dora-ssr"]');
  await expect(engine.getByRole('link', { name: /源码仓库/ })).toHaveAttribute(
    'href',
    'https://github.com/IppClub/Dora-SSR'
  );
  await expect(page.locator('[data-project-id="luv-sense-digital"]')).toContainText('IppClub 提供技术支持');
  await engine.locator('summary').click();
  await expect(engine.locator('.project-license')).toContainText('Spine Runtime');
  await page.getByRole('button', { name: '语言工具', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'YueScript', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部项目', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('projects.png'), fullPage: true, animations: 'disabled' });
  await page
    .locator('.creation-links')
    .getByRole('link', { name: /关注赛事展台/ })
    .click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByText('目前暂无已公布赛事。', { exact: true })).toBeVisible();
  await expect(page.locator('.event-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /报名/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('events-empty.png'), fullPage: true, animations: 'disabled' });
  await page.goto('/');
  await expect(page.locator('.home-events').getByRole('link', { name: '查看赛事展台' })).toHaveAttribute(
    'href',
    '/events'
  );
  await expect(page.locator('.main-nav a')).toHaveCount(5);
  await page.locator('.main-nav').getByRole('link', { name: '成员名录', exact: true }).click();
  await expect(page).toHaveURL(/\/people$/);
});

test('visible cards, artwork and UI switches use finite expressive motion', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Hover requires a fine pointer');
  const moved = async (selector: string, property: 'translate' | 'scale' | 'rotate' = 'translate') => {
    const locator = page.locator(selector).first();
    await locator.hover();
    await expect
      .poll(() => locator.evaluate((element, property) => getComputedStyle(element)[property as 'translate'], property))
      .not.toBe('none');
  };
  await page.goto('/');
  for (const selector of ['.service-card', '.project-card', '.person-book', '.home-events', '.home-values']) {
    const element = page.locator(selector).first();
    await expect(element).toBeVisible();
    expect(await element.evaluate(e => getComputedStyle(e).transitionDuration)).not.toMatch(/^(0s,?\s*)+$/);
  }
  await moved('.home-events');
  await page.locator('.project-card').first().hover();
  await expect
    .poll(() =>
      page
        .locator('.project-card .project-art svg')
        .first()
        .evaluate(e => getComputedStyle(e).scale)
    )
    .not.toBe('none');
  const firstPersonBook = page.locator('.person-book').first();
  await firstPersonBook.hover();
  await expect
    .poll(() =>
      firstPersonBook.locator('.person-avatar').evaluate(e => getComputedStyle(e).translate)
    )
    .not.toBe('none');
  await expect
    .poll(() =>
      firstPersonBook.evaluate(book => {
        const cover = book.querySelector<HTMLElement>('.person-cover');
        const spine = book.querySelector<HTMLElement>('.person-spine');
        if (!cover || !spine) throw new Error('Member book is missing its cover or spine');
        return Math.abs(cover.getBoundingClientRect().top - spine.getBoundingClientRect().top);
      })
    )
    .toBeLessThan(0.5);

  await page.goto('/projects');
  await moved('.project-card');
  await moved('.project-hero-symbol', 'rotate');
  const languageFilter = page.getByRole('button', { name: '语言工具', exact: true });
  expect(await languageFilter.evaluate(e => getComputedStyle(e).transitionProperty)).toContain('translate');
  expect(await languageFilter.evaluate(e => getComputedStyle(e).transitionProperty)).toContain('border-radius');
  await languageFilter.click();
  // The filter lives in the URL, so React Router applies it in a transition: poll past the node swap
  // rather than reading the old element, which is already detached and reports empty computed styles.
  await expect
    .poll(() => page.locator('.project-gallery').evaluate(e => getComputedStyle(e).animationName))
    .toBe('surface-switch');
  await expect
    .poll(() =>
      page
        .locator('.project-card')
        .first()
        .evaluate(e => getComputedStyle(e).animationName)
    )
    .toBe('card-cascade');

  await page.goto('/people');
  await expect(page.locator('.person-book')).toHaveCount(12);
  await page.locator('main').evaluate(e => Promise.all(e.getAnimations().map(a => a.finished.catch(() => {}))));
  await page.locator('.construction-sign').hover();
  await expect.poll(() => page.locator('.construction-sign').evaluate(e => getComputedStyle(e).rotate)).toBe('0deg');
  await page.getByRole('button', { name: '支持者', exact: true }).click();
  expect(await page.locator('.people-sections').evaluate(e => getComputedStyle(e).animationName)).toBe(
    'surface-switch'
  );

  await page.goto('/events');
  await page.waitForTimeout(500);
  await page.locator('.events-empty').hover();
  await expect.poll(() => page.locator('.events-empty').evaluate(e => getComputedStyle(e).translate)).not.toBe('none');
  await expect.poll(() => page.locator('.empty-ticket').evaluate(e => getComputedStyle(e).translate)).not.toBe('none');

  await page.goto('/assessment');
  await expect(page.locator('.notice')).toBeVisible();
  await page.waitForTimeout(400);
  await page.locator('.notice').hover();
  await expect.poll(() => page.locator('.notice').evaluate(e => getComputedStyle(e).translate)).not.toBe('none');
  for (const route of ['/assessment', '/verify', '/admin']) {
    await page.goto(route);
    const card = page.locator('.surface-card').first();
    await expect(card).toBeVisible();
    await moved('.surface-card');
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/projects');
  const card = page.locator('.project-card').first();
  await card.hover();
  expect(await card.evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  expect(await card.evaluate(e => getComputedStyle(e).translate)).toBe('none');
});

test('illustration fills/ink/edges stay fixed across light/dark for every theme seed', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Mode/color matrix is checked once');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const preset of THEME_PRESETS) {
    await page.getByRole('button', { name: '选择主题色' }).click();
    await page.getByRole('radio', { name: preset.name }).check();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    const light = await page.locator('.art-tile').evaluateAll(tiles =>
      tiles.map(tile => {
        const s = getComputedStyle(tile);
        return [s.backgroundColor, s.color, s.boxShadow];
      })
    );
    await page.getByRole('button', { name: '切换深色模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await page.locator('.art-tile').evaluateAll(tiles =>
      tiles.map(tile => {
        const s = getComputedStyle(tile);
        return [s.backgroundColor, s.color, s.boxShadow];
      })
    );
    expect(dark).toEqual(light);
    await page.getByRole('button', { name: '切换浅色模式' }).click();
  }
  await page.goto('/people');
  await expect(page.locator('.mascot')).toHaveCount(0);
  await page.getByRole('button', { name: '选择主题色' }).click();
  await page.getByRole('radio', { name: '松石青' }).check();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  const lightSign = await page.locator('.construction-sign').evaluate(e => {
    const s = getComputedStyle(e);
    return [s.backgroundColor, s.color, s.boxShadow];
  });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  expect(
    await page.locator('.construction-sign').evaluate(e => {
      const s = getComputedStyle(e);
      return [s.backgroundColor, s.color, s.boxShadow];
    })
  ).toEqual(lightSign);
});

test('mobile bottom nav renders its icons and keeps the active label clear of the pill', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Narrow-viewport matrix is checked once');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const links = page.locator('.main-nav a');
  await expect(links).toHaveCount(5);
  // 全局规则藏了导航图标，移动端要靠同特异度的规则盖回来；漏掉就整排图标消失。
  await expect(links.locator('svg:not(.nav-caret)')).toHaveCount(5);
  for (let i = 0; i < 5; i++) await expect(links.nth(i).locator('svg:not(.nav-caret)')).toBeVisible();
  const active = page.locator('.main-nav a.active');
  await expect(active.locator('span')).toBeVisible();
  const geom = await active.evaluate(a => {
    const pill = getComputedStyle(a, '::before');
    const link = a.getBoundingClientRect();
    const labelElement = a.querySelector('span');
    if (!labelElement) throw new Error('Active navigation link is missing its label');
    const label = labelElement.getBoundingClientRect();
    return { pillBottom: parseFloat(pill.top) + parseFloat(pill.height), labelTop: label.top - link.top };
  });
  expect(geom.labelTop).toBeGreaterThanOrEqual(geom.pillBottom);
});

test('community pages fit narrow screens and pass light/dark accessibility checks', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Viewport/accessibility matrix is checked once');
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const route of ['/', '/people', '/projects', '/events']) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      if (route === '/' || route === '/people') await expect(page.locator('.person-book').first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        ok: document.documentElement.scrollWidth <= innerWidth,
        nodes: [...document.querySelectorAll('main *, header *, footer *')]
          .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 10)
          .map(e => `${e.tagName}.${e.className}`)
      }));
      expect(overflow.ok, `${route} at ${width}: ${overflow.nodes.join(', ')}`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const route of ['/people', '/projects', '/events']) {
    await page.goto(route);
    if (route === '/people') await expect(page.locator('.person-book')).toHaveCount(12);
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => (document.documentElement.dataset.theme = mode), mode);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(
        result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'),
        `${route}/${mode}`
      ).toEqual([]);
    }
  }
});
