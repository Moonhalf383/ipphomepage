import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Attempt, Question } from '../shared/types';
const origin = 'http://localhost:5173';
async function adminContext(request: APIRequestContext) {
  const login = await request.post('/api/admin/login', {
    headers: { Origin: origin },
    data: { password: 'browser-test-only-password' }
  });
  expect(login.ok()).toBeTruthy();
  return request;
}
async function setMode(request: APIRequestContext, enabled: boolean) {
  await adminContext(request);
  expect(
    (
      await request.put('/api/admin/settings', {
        headers: { Origin: origin },
        data: { enabled, questionCount: 14, passScore: 80, reviewed: true }
      })
    ).ok()
  ).toBeTruthy();
}
async function complete(page: Page, questions: Question[], formal: boolean) {
  if (formal) {
    await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'admin@example.com', password: 'browser-test-only-password' } });
  }
  await page.goto('/assessment');
  await page.getByLabel('证书昵称', { exact: false }).fill('好奇心测试员');
  await page.getByRole('checkbox').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/attempts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: formal ? '开始正式问卷' : '开始演示问卷' }).click();
  const a: Attempt = await (await created).json();
  expect(a.questions.some(q => 'correct' in q || 'explanation' in q)).toBeFalsy();
  await expect(page.locator('.question-panel')).toBeVisible();
  for (let i = 0; i < a.questions.length; i++) {
    const q = a.questions[i],
      known = questions.find(item => item.id === q.id)!;
    if (q.points) for (const correct of known.correct) await page.locator('.answer-option').nth(correct).click();
    else if (q.type === 'text')
      await page.getByRole('textbox', { name: '你的想法' }).fill('一起完善文档，帮助后来的人。');
    else await page.locator('.scale-options label').nth(4).click();
    if (i < a.questions.length - 1) {
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      if (i === 0)
        expect(await page.locator('.question-body').evaluate(e => getComputedStyle(e).animationName)).toBe(
          'surface-switch'
        );
    }
  }
  await page.getByRole('button', { name: '提交并查看结果' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.getByRole('heading', { name: '问卷已通过' })).toBeVisible();
  return a;
}
test('layout at narrow and tablet widths and accessible light/dark entry pages', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Width matrix is run once');
  test.setTimeout(120_000);
  for (const width of [320, 375, 600, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/assessment', '/verify', '/admin', '/account']) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      const overflow = await page.evaluate(() => ({
        ok: document.documentElement.scrollWidth <= innerWidth,
        elements: [...document.querySelectorAll('main *, footer *')]
          .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map(e => `${e.tagName}.${e.className}: ${Math.round(e.getBoundingClientRect().right)}`)
      }));
      expect(overflow.ok, `${route} overflows at ${width}px: ${overflow.elements.join(', ')}`).toBeTruthy();
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of ['/', '/assessment', '/verify', '/admin', '/account']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(
        results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'),
        `${route} ${theme}`
      ).toEqual([]);
    }
  }
});
test('homepage navigation, theme persistence and responsive layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /让好奇心，\s*不断加一。/ })).toBeVisible();
  await expect(page.locator('.blog-card')).toHaveAttribute('href', 'https://ippclub.org/');
  await expect(page.locator('.blogroll-card')).toHaveAttribute('href', 'https://ippclub.org/blogroll/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('homepage-light.png'), fullPage: true });
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('homepage-dark.png'), fullPage: true });
  await page.locator('.quiz-card').click();
  await expect(page.getByRole('heading', { name: /社区规则问卷/ })).toBeVisible();
  expect(errors).toEqual([]);
});
test('demo all five question types, server scoring, PNG download and reload', async ({ page, request }, info) => {
  await setMode(request, false);
  const questions: Question[] = (await (await request.get('/api/admin')).json()).questions;
  const a = await complete(page, questions, false);
  await expect(page.getByRole('heading', { name: '演示结果 · 已通过' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('demo-result.png'), fullPage: true });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载演示纪念图片' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toContain('DEMO');
  const png = await readFile((await file.path())!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await file.saveAs(info.outputPath('certificate-demo.png'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '演示结果 · 已通过' })).toBeVisible();
  const result = (await (await page.request.get(`/api/attempts/${a.id}`)).json()).result;
  expect(result.score).toBe(100);
  expect(result.certificateId).toBeNull();
});
test('formal certificate public verification and revocation', async ({ page, request }, info) => {
  await setMode(request, true);
  const questions: Question[] = (await (await request.get('/api/admin')).json()).questions;
  await complete(page, questions, true);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载证书 PNG' }).click();
  await (await downloaded).saveAs(info.outputPath('certificate-formal.png'));
  await page.getByRole('link', { name: '查看公开验真' }).click();
  await expect(page.getByRole('heading', { name: '有效 · 已通过审核' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('verification.png'), fullPage: true });
  const id = page.url().split('/').pop();
  await request.post(`/api/admin/certificates/${id}/revoke`, { headers: { Origin: origin }, data: {} });
  await page.reload();
  await expect(page.getByRole('heading', { name: '证书已撤销' })).toBeVisible();
});
test('admin UI CRUD, publish safeguard and logout', async ({ page, request }, info) => {
  await setMode(request, false);
  await page.goto('/admin');
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('browser-test-only-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'I++Club控制台' })).toBeVisible();
  await page.getByRole('button', { name: '添加题目', exact: true }).click();
  await page.getByRole('combobox', { name: '题型', exact: true }).selectOption('text');
  await page.getByLabel('题目内容').fill('浏览器测试：你想分享什么？');
  await page.getByRole('button', { name: '保存题目' }).click();
  await expect(page.getByRole('heading', { name: '浏览器测试：你想分享什么？' })).toBeVisible();
  await page.getByRole('button', { name: '编辑：浏览器测试：你想分享什么？' }).click();
  await page.getByLabel('题目内容').fill('浏览器测试：修改后的题目');
  await page.getByRole('button', { name: '保存题目' }).click();
  await page.getByRole('button', { name: '删除：浏览器测试：修改后的题目' }).click();
  await page.getByRole('button', { name: '确认操作' }).click();
  await expect(page.getByRole('heading', { name: '浏览器测试：修改后的题目' })).toHaveCount(0);
  await page.getByRole('button', { name: '问卷设置', exact: true }).click();
  await page.getByRole('switch').check();
  await expect(page.getByRole('button', { name: '保存设置' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /已确认题目、答案和通过分数/ }).check();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('问卷设置已保存', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('admin-settings.png'), fullPage: true });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '邮箱登录', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('draft survives refresh and invalid verification has useful feedback', async ({ page, request }) => {
  await setMode(request, false);
  await page.goto('/assessment');
  await page.getByLabel('证书昵称', { exact: false }).fill('进度测试');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '开始演示问卷' }).click();
  await expect(page.locator('.question-panel')).toBeVisible();
  // Find a scored question without depending on the randomized order.
  const a: Attempt = await (await page.request.get(`/api/attempts/${page.url().split('/').pop()}`)).json();
  const index = a.questions.findIndex(q => q.points > 0);
  await page.locator('.question-dots button').nth(index).click();
  await page.locator('.answer-option').first().click();
  await expect(page.getByText('答案已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('.question-dots button').nth(index).click();
  await expect(page.locator('.answer-option input').first()).toBeChecked();
  await page.goto('/verify');
  await page.getByLabel('证书编号', { exact: true }).fill('not-a-certificate');
  await page.getByRole('button', { name: '查询证书' }).click();
  await expect(page.getByRole('alert')).toContainText('完整证书编号');
  await page.getByLabel('证书编号', { exact: true }).fill('00000000-0000-0000-0000-000000000000');
  await page.getByRole('button', { name: '查询证书' }).click();
  await expect(page.getByRole('alert')).toContainText('未找到该证书');
});

test('email registration entry, user management and mail queue UI', async ({ page, request }, info) => {
  await page.goto('/account');
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(`new-${info.project.name}@example.com`);
  await page.getByLabel('昵称', { exact: true }).fill('新朋友');
  await page.getByLabel('设置密码', { exact: true }).fill('registration-test-password');
  await page.getByLabel('确认密码', { exact: true }).fill('registration-test-password');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByRole('button', { name: /秒后重发/ })).toBeDisabled();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('000000');
  await page.getByRole('button', { name: '完成注册', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('验证码无效');
  await page.goto('/account/admin');
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('browser-test-only-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '用户与邮件', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用户与身份' })).toBeVisible();
  await expect(page.getByText('admin@example.com', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '管理员', exact: true }).check();
  await page.getByLabel('主题', { exact: true }).fill('测试公告');
  await page.getByLabel('正文', { exact: true }).fill('欢迎一起探索。');
  await page.getByRole('button', { name: '确认收件范围' }).click();
  await expect(page.getByRole('dialog', { name: '发送这封邮件？' })).toBeVisible();
  await page.getByRole('button', { name: '确认发送', exact: true }).click();
  await expect(page.getByText('邮件已安排发送，共 1 位收件人。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('users-mail.png'), fullPage: true });
});

test('unified account routes, compact forms and full email password recovery', async ({ page }, info) => {
  await page.goto('/account?mode=register');
  await expect(page.getByRole('heading', { name: '邮箱注册', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '已有账号？' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '直接登录', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '社团管理', exact: true }).click();
  await expect(page).toHaveURL(/\/account\?next=\/admin$/);
  await expect(page.getByRole('heading', { name: '邮箱登录', exact: true })).toBeVisible();
  await expect(page.getByLabel('昵称', { exact: true })).toHaveCount(0);
  await page.goto('/account/admin');
  await expect(page).toHaveURL(/\/account\?next=\/admin$/);
  await expect(page.getByRole('heading', { name: '邮箱登录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  const email = `recovery-${info.project.name}@example.com`;
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('昵称', { exact: true }).fill('邮箱测试');
  await page.getByLabel('设置密码', { exact: true }).fill('original-test-password');
  await page.getByLabel('确认密码', { exact: true }).fill('original-test-password');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  async function lastCode() {
    const response = await page.request.get(`http://localhost:${process.env.E2E_API_PORT || 3001}/__test/mail`);
    const messages = await response.json();
    return messages.findLast((m: any) => m.to === email && m.subject.includes('验证码')).text.match(/\d{6}/)[0];
  }
  await page.getByLabel('邮箱验证码', { exact: true }).fill(await lastCode());
  await page.getByRole('button', { name: '完成注册', exact: true }).click();
  // This account came from an admin redirect; it has no management permission.
  await expect(page.getByRole('alert')).toContainText('暂无管理权限');
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
  await expect(page.getByText('非社员', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '忘记密码？', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('新密码', { exact: true }).fill('updated-test-password');
  await page.getByLabel('确认密码', { exact: true }).fill('updated-test-password');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码', { exact: true }).fill(await lastCode());
  await page.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(page.getByText('密码已更新，请使用新密码登录。', { exact: true })).toBeVisible();
  await page.getByLabel('密码', { exact: true }).fill('updated-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '邮箱登录', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('compact-login.png'), fullPage: true });
  if (info.project.name === 'desktop') {
    const box = await page.locator('.account-card').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(480);
    expect(box!.y + box!.height).toBeLessThan(800);
  }
});

test('console overview is compact and opening questionnaire settings preserves demo mode', async ({ page, request }, info) => {
  await setMode(request, false);
  const before = await (await request.get('/api/config')).json();
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'admin@example.com', password: 'browser-test-only-password' } });
  await page.goto('/admin');
  const overview = page.getByRole('group', { name: '问卷概览', exact: true });
  await expect(overview.getByText('演示中', { exact: true })).toBeVisible();
  for (const label of ['问卷状态','启用题目','每份题数','通过分数']) await expect(overview.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText(/演示题库不能作为/)).toHaveCount(0);
  await expect(overview.getByText('当前规则版本', { exact: true })).toHaveCount(0);
  const first = await overview.locator(':scope > div').first().boundingBox();
  expect(first!.height).toBeLessThan(100);
  await page.getByRole('button', { name: '问卷设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: /开放正式问卷/ })).not.toBeChecked();
  await expect(page.getByText(/规则 v/)).toBeVisible();
  expect(await (await request.get('/api/config')).json()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('console-overview.png'), fullPage: true });
});

test('answer records use independently scrolling list and detail panes with mobile return', async ({ page, request }, info) => {
  await setMode(request, false);
  await page.request.post('/api/auth/login', { headers: { Origin: origin }, data: { email: 'admin@example.com', password: 'browser-test-only-password' } });
  const questions: Question[] = (await (await request.get('/api/admin')).json()).questions;
  const answers = Object.fromEntries(questions.filter(q => q.points).map(q => [q.id,q.correct]));
  for (const displayName of ['分栏测试甲', '分栏测试乙']) {
    const attempt = await (await page.request.post('/api/attempts', { headers: { Origin: origin }, data: { displayName, consent: true } })).json();
    expect((await page.request.post(`/api/attempts/${attempt.id}/submit`, { headers: { Origin: origin }, data: { answers } })).ok()).toBeTruthy();
  }
  await page.goto('/admin');
  await page.getByRole('button', { name: '答题与证书', exact: true }).click();
  const originalViewport = page.viewportSize()!;
  const sizes = info.project.name === 'desktop' ? [{ width: 1280, height: 720 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }] : [originalViewport];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const pane = await page.locator('.records-split').boundingBox();
    expect(pane!.height).toBeGreaterThanOrEqual(size.height * 0.74);
    expect(pane!.height).toBeLessThanOrEqual(size.height * 0.80);
  }
  await page.setViewportSize(originalViewport);
  const list = page.getByRole('region', { name: '答题记录列表', exact: true });
  const detail = page.getByRole('region', { name: '答案详情', exact: true });
  await list.getByRole('button', { name: /分栏测试甲/ }).first().click();
  await expect(detail.getByRole('heading', { name: '分栏测试甲 的答案' })).toBeVisible();
  await expect(detail.locator('.record-answers li')).toHaveCount(14);
  if (info.project.name === 'desktop') {
    const a = await list.boundingBox(), b = await detail.boundingBox();
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    expect(Math.abs(a!.y-b!.y)).toBeLessThan(2);
    const before = await page.evaluate(() => scrollY);
    await detail.evaluate(el => { el.scrollTop = 600; });
    expect(await detail.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await list.getByRole('button', { name: /分栏测试乙/ }).first().click();
  } else {
    await expect(list).not.toBeVisible();
    await detail.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(list).toBeVisible();
    await expect(list.getByRole('button', { name: /分栏测试甲/ }).first()).toBeFocused();
    await list.getByRole('button', { name: /分栏测试乙/ }).first().click();
  }
  await expect(detail.getByRole('heading', { name: '分栏测试乙 的答案' })).toBeVisible();
  await expect(detail.locator('.record-answers li')).toHaveCount(14);
  expect(await detail.evaluate(el => el.scrollTop)).toBe(0);
  if (info.project.name === 'desktop') {
    const firstId = await list.getByRole('button', { name: /分栏测试甲/ }).first().getAttribute('data-record-id');
    const firstRecord = await (await page.request.get(`/api/admin/attempts/${firstId}`)).json();
    let release: () => void = () => {};
    const hold = new Promise<void>(resolve => { release = resolve; });
    let arrived: () => void = () => {};
    const waiting = new Promise<void>(resolve => { arrived = resolve; });
    await page.route(`**/api/admin/attempts/${firstId}`, async route => {
      arrived(); await hold; await route.fulfill({ json: firstRecord });
    });
    await list.getByRole('button', { name: /分栏测试甲/ }).first().click();
    await waiting;
    await list.getByRole('button', { name: /分栏测试乙/ }).first().click();
    await expect(detail.locator('.record-answers li')).toHaveCount(14);
    release();
    await expect(detail.getByRole('heading', { name: '分栏测试乙 的答案' })).toBeVisible();
    await page.unroute(`**/api/admin/attempts/${firstId}`);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('records-split.png'), fullPage: true });
});
