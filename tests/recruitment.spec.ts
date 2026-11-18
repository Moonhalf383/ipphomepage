import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const origin = 'http://localhost:5173';
const password = 'browser-test-only-password';
test('president publishes choices, visitor sees history, applicant logs in and admin reads application', async ({
  page,
  browser
}, info) => {
  test.setTimeout(60000);
  const title = `招新面试 ${info.project.name}`;
  await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: { email: 'admin@example.com', password }
  });
  await page.goto('/admin?tab=interviews');
  await page.getByRole('button', { name: '发布安排', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill(title);
  await page.getByLabel('地点', { exact: true }).fill('教学楼 302');
  await page.getByLabel('描述（选填）').fill('请携带校园卡。');
  const day = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  await page.getByLabel('开始时间 1').fill(`${day}T14:00`);
  await page.getByLabel('结束时间 1').fill(`${day}T15:00`);
  await page.getByRole('button', { name: '添加时间', exact: true }).click();
  await page.getByLabel('开始时间 2').fill(`${day}T16:00`);
  await page.getByLabel('结束时间 2').fill(`${day}T17:00`);
  await page.locator('.editor-actions').getByRole('button', { name: '发布安排', exact: true }).click();
  await expect(page.getByText('面试安排已发布', { exact: true })).toBeVisible();
  const visitor = await browser.newContext(info.project.use);
  const candidate = await visitor.newPage();
  await candidate.goto(`${origin}/join`);
  await expect(candidate.getByRole('heading', { name: '加入我们', exact: true })).toBeVisible();
  const historical = candidate.locator('.join-schedule').filter({ hasText: '历史面试（已结束）' });
  await expect(historical.getByText('已过期').first()).toBeVisible();
  await expect(historical.getByRole('button', { name: '选择安排' })).toHaveCount(0);
  await candidate.locator('.join-login-prompt').getByRole('link', { name: '登录 / 注册' }).click();
  await candidate.getByRole('button', { name: '邮箱注册', exact: true }).click();
  const email = `join-${info.project.name}@example.com`;
  await candidate.getByLabel('邮箱', { exact: true }).fill(email);
  await candidate.getByLabel('昵称', { exact: true }).fill('新同学');
  await candidate.getByLabel('设置密码', { exact: true }).fill(password);
  await candidate.getByLabel('确认密码', { exact: true }).fill(password);
  const codeSent = candidate.waitForResponse(response => response.url().endsWith('/api/auth/code'));
  await candidate.getByRole('button', { name: '获取验证码' }).click();
  expect((await codeSent).ok()).toBe(true);
  const mails = await (
    await candidate.request.get(`http://localhost:${process.env.E2E_API_PORT || 3001}/__test/mail`)
  ).json();
  const code = mails.findLast((mail: { to: string }) => mail.to === email).text.match(/\d{6}/)[0];
  await candidate.getByLabel('邮箱验证码', { exact: true }).fill(code);
  await candidate.getByRole('button', { name: /完成注册/ }).click();
  await expect(candidate).toHaveURL(`${origin}/join`);
  await candidate.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin }, data: {} });
  await candidate.goto(`${origin}/join`);
  await candidate.locator('.join-login-prompt').getByRole('link', { name: '登录 / 注册' }).click();
  await candidate.getByLabel('邮箱', { exact: true }).fill(email);
  await candidate.getByLabel('密码', { exact: true }).fill(password);
  await candidate.getByRole('button', { name: '登录', exact: true }).click();
  await expect(candidate).toHaveURL(`${origin}/join`);
  const card = candidate
    .locator('.join-schedule')
    .filter({ has: candidate.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: '选择安排' }).click();
  await candidate.getByRole('combobox', { name: '面试时间', exact: true }).selectOption({ index: 1 });
  await candidate.getByLabel('姓名', { exact: true }).fill('林同学');
  await candidate.getByLabel('联系方式', { exact: true }).fill('QQ 123456');
  await candidate.getByLabel('备注（选填）').fill('下午参加');
  await candidate.getByRole('button', { name: '提交填报', exact: true }).click();
  await expect(candidate.getByText('填报已提交', { exact: true })).toBeVisible();
  await expect(card.getByText('已填报', { exact: true })).toBeVisible();
  await candidate.reload();
  await expect(card.getByText('已填报', { exact: true })).toBeVisible();
  await candidate.screenshot({ path: info.outputPath('join-applied.png'), fullPage: true });
  await page.reload();
  await page
    .locator('.interview-list article')
    .filter({ hasText: title })
    .getByRole('button', { name: /填报情况/ })
    .click();
  await expect(page.locator('.record-detail').getByText('林同学', { exact: true })).toBeVisible();
  await expect(page.locator('.record-detail').getByText('QQ 123456', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('interview-applications.png'), fullPage: true });
  const identity = (await (await candidate.request.get(`${origin}/api/auth/me`)).json()).user;
  expect(
    (
      await page.request.put(`/api/admin/users/${identity.id}/role`, {
        headers: { Origin: origin },
        data: { role: 'admin' }
      })
    ).ok()
  ).toBe(true);
  await candidate.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email, password } });
  await candidate.goto(`${origin}/admin?tab=interviews`);
  await expect(candidate.getByRole('heading', { name: '招新面试', exact: true })).toBeVisible();
  await expect(candidate.getByRole('button', { name: '发布安排', exact: true })).toHaveCount(0);
  await candidate
    .locator('.interview-list article')
    .filter({ hasText: title })
    .getByRole('button', { name: /填报情况/ })
    .click();
  await expect(candidate.locator('.record-detail').getByText('林同学', { exact: true })).toBeVisible();
  await visitor.close();
});

test('account mode and console switches animate without remounting fields; reduced motion skips effects', async ({
  page
}) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as any).switchAnimations = [];
    Element.prototype.animate = function (...args) {
      if (this.matches('.account-page, .console-content, .records-answer'))
        (window as any).switchAnimations.push(this.className);
      return original.apply(this, args);
    };
  });
  await page.goto('/account?next=/join');
  await page.getByLabel('邮箱', { exact: true }).fill('draft@example.com');
  await page.getByLabel('邮箱', { exact: true }).evaluate(input => {
    (input as any).__identity = 'same-input';
  });
  await page.waitForTimeout(400);
  const initial = await page.evaluate(() => (window as any).switchAnimations.length);
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await expect(page.getByRole('heading', { name: '邮箱注册' })).toBeVisible();
  expect(await page.getByLabel('邮箱', { exact: true }).evaluate(input => (input as any).__identity)).toBe(
    'same-input'
  );
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('draft@example.com');
  expect(await page.evaluate(() => (window as any).switchAnimations.length)).toBeGreaterThan(initial);
  await expect(page).toHaveURL(/next=%2Fjoin.*mode=register/);
  await page.getByRole('button', { name: '直接登录' }).click();
  await page.getByRole('button', { name: '忘记密码？' }).click();
  await expect(page.getByRole('heading', { name: '重设密码' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => (window as any).switchAnimations.length);
  await page.getByRole('button', { name: '直接登录' }).click();
  await expect(page.getByRole('heading', { name: '邮箱登录' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).switchAnimations.length)).toBe(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.request.post('/api/auth/login', {
    headers: { Origin: origin },
    data: { email: 'admin@example.com', password }
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '添加题目', exact: true }).click();
  await page.getByRole('textbox', { name: '题目内容', exact: true }).fill('尚未保存的题目内容');
  await page.getByRole('button', { name: '题库管理', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '题目内容', exact: true })).toHaveValue('尚未保存的题目内容');
  const beforeTab = await page.evaluate(() => (window as any).switchAnimations.length);
  await page.getByRole('button', { name: '招新面试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '招新面试', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).switchAnimations.length)).toBeGreaterThan(beforeTab);
});

test('join page fits narrow viewports and meets light/dark accessibility checks', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/join');
    await expect(page.locator('.join-schedule').first()).toBeVisible();
    const overflow = await page.evaluate(() => ({
      ok: document.documentElement.scrollWidth <= innerWidth,
      nodes: [...document.querySelectorAll('header *, main *, footer *')]
        .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
        .map(e => `${e.tagName}.${e.className}:${e.getBoundingClientRect().right}`)
        .slice(0, 15)
    }));
    expect(overflow.ok, `overflow at ${width}: ${overflow.nodes.join(', ')}`).toBe(true);
    await expect(page.locator('.main-nav a[href="/join"]')).toBeVisible();
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  }
});

test('president edits, cancels and deletes schedules; applicant sees cancellation', async ({ page, browser }, info) => {
  test.setTimeout(60000);
  const title = `管理面试 ${info.project.name}`;
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'admin@example.com', password } });
  const day = new Date(Date.now() + 86400000 * 6).toISOString().slice(0, 10);
  const create = async (name: string) => {
    await page.goto('/admin?tab=interviews');
    await page.getByRole('button', { name: '发布安排', exact: true }).click();
    await page.getByLabel('标题', { exact: true }).fill(name);
    await page.getByLabel('地点', { exact: true }).fill('教学楼 302');
    await page.getByLabel('开始时间 1').fill(`${day}T14:00`);
    await page.getByLabel('结束时间 1').fill(`${day}T15:00`);
    await page.locator('.editor-actions').getByRole('button', { name: '发布安排', exact: true }).click();
    await expect(page.getByText('面试安排已发布', { exact: true })).toBeVisible();
  };
  await create(title);
  await create(`${title} 待删除`);
  const card = () => page.locator('.interview-list article').filter({ hasText: title }).filter({ hasNotText: '待删除' });
  // Edit: rename and relocate.
  await card().getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑面试安排', exact: true })).toBeVisible();
  await page.getByLabel('地点', { exact: true }).fill('新楼 101');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('面试安排已更新', { exact: true })).toBeVisible();
  await expect(card().getByText('新楼 101', { exact: true })).toBeVisible();
  // Applicant applies through the API, then the booked slot becomes locked in the editor.
  const schedules = await (await page.request.get('/api/join/schedules')).json();
  const target = schedules.find((s: { title: string }) => s.title === title);
  const visitor = await browser.newContext(info.project.use);
  const candidate = await visitor.newPage();
  await candidate.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email: 'admin@example.com', password } });
  expect((await candidate.request.post(`${origin}/api/join/applications`, {
    headers: { Origin: origin },
    data: { scheduleId: target.id, slotId: target.slots[0].id, name: '管理测试', contact: 'QQ 1', note: '' }
  })).ok()).toBe(true);
  await page.reload();
  await card().getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel(/开始时间 1（已有填报，不可修改）/)).toBeDisabled();
  await expect(page.getByRole('button', { name: '移除时间 1' })).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // Delete is disabled with applications; the empty schedule can be deleted after confirmation.
  await expect(card().getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  const empty = page.locator('.interview-list article').filter({ hasText: `${title} 待删除` });
  await empty.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('安排已删除', { exact: true })).toBeVisible();
  await expect(empty).toHaveCount(0);
  // Cancel after confirmation; applicant view updates.
  await card().getByRole('button', { name: '取消安排', exact: true }).click();
  await page.getByRole('button', { name: '确认取消', exact: true }).click();
  await expect(page.getByText('安排已取消，填报者将收到邮件通知', { exact: true })).toBeVisible();
  await expect(card().getByText('已取消', { exact: true })).toBeVisible();
  await expect(card().getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
  await expect(card().getByRole('button', { name: '取消安排', exact: true })).toHaveCount(0);
  await candidate.goto(`${origin}/join`);
  const publicCard = candidate.locator('.join-schedule').filter({ hasText: title }).filter({ hasNotText: '待删除' });
  await expect(publicCard.getByText('已取消', { exact: true })).toBeVisible();
  await expect(publicCard.getByText('该安排已取消，本次填报不再生效，请留意邮件通知。', { exact: true })).toBeVisible();
  await expect(publicCard.getByRole('button', { name: '选择安排' })).toHaveCount(0);
  await expect.poll(async () => {
    const mails = await (await candidate.request.get(`http://localhost:${process.env.E2E_API_PORT || 3001}/__test/mail`)).json();
    return mails.some((m: { text: string }) => m.text.includes('已被取消') && m.text.includes(title));
  }, { timeout: 15000 }).toBe(true);
  await page.screenshot({ path: info.outputPath('interview-manage.png'), fullPage: true });
  await visitor.close();
});

test('editing a schedule keeps second-precision booked slots intact', async ({ page }, info) => {
  const title = `秒级时间 ${info.project.name}`;
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'admin@example.com', password } });
  const startAt = Date.now() + 86400000 * 7 + 37_000;
  const created = await (await page.request.post('/api/admin/interviews', {
    headers: { Origin: origin },
    data: { title, location: '老地点', description: '', slots: [{ startAt, endAt: startAt + 3600_000 + 12_000 }] }
  })).json();
  expect((await page.request.post('/api/join/applications', {
    headers: { Origin: origin },
    data: { scheduleId: created.id, slotId: created.slots[0].id, name: '秒级测试', contact: 'QQ 2', note: '' }
  })).ok()).toBe(true);
  await page.goto('/admin?tab=interviews');
  const card = page.locator('.interview-list article').filter({ hasText: title });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('地点', { exact: true }).fill('新地点 202');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('面试安排已更新', { exact: true })).toBeVisible();
  const schedules = await (await page.request.get('/api/join/schedules')).json();
  const updated = schedules.find((s: { id: string }) => s.id === created.id);
  expect(updated.location).toBe('新地点 202');
  expect(updated.slots[0].startAt).toBe(startAt);
  expect(updated.slots[0].endAt).toBe(startAt + 3600_000 + 12_000);
});
