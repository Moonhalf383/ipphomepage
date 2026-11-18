import test from 'node:test';
import assert from 'node:assert/strict';
import { accountMail, type AccountMail } from '../server/mail-templates.ts';
import { accountNotifications } from '../server/account-notifications.ts';
import { DatabaseSync } from 'node:sqlite';
import type { Mail } from '../server/mail.ts';
const origin = 'https://iplusplus.club';
const events: AccountMail[] = [
  { kind: 'registration-code', to: 'person@example.com', code: '123456' },
  { kind: 'password-code', to: 'person@example.com', code: '654321' },
  { kind: 'welcome', to: 'person@example.com', name: '新朋友', role: 'non_member' },
  { kind: 'password-changed', to: 'person@example.com', name: '新朋友', at: Date.UTC(2026, 10, 16) },
  { kind: 'role-changed', to: 'person@example.com', name: '新朋友', previous: 'non_member', role: 'member', at: Date.UTC(2026, 10, 16) },
  { kind: 'interview-cancelled', to: 'person@example.com', name: '新朋友', title: '秋季招新面试', location: '教学楼 302', at: Date.UTC(2026, 10, 16) },
  { kind: 'interview-updated', to: 'person@example.com', name: '新朋友', title: '秋季招新面试', location: '新楼 101', at: Date.UTC(2026, 10, 16) }
];
test('all account emails carry equivalent branded HTML and plain-text content', () => {
  for (const event of events) {
    const mail = accountMail(event, origin);
    assert.match(mail.subject, /^【I\+\+ Club】/);
    assert.match(mail.text, /I\+\+ Club/); assert.match(mail.html!, /lang="zh-CN"/);
    assert.match(mail.html!, /#65558f/); assert.match(mail.html!, /#faf8ef/);
    assert.doesNotMatch(mail.html!, /<script|<img|onerror=|<form/i);
    assert.doesNotMatch(mail.text, /社长|president|本喵|猫娘/);
    assert.ok((mail.text.match(/喵/g) ?? []).length <= 1);
    if ('code' in event) {
      assert.match(mail.text, new RegExp(event.code)); assert.match(mail.html!, new RegExp(event.code));
      assert.ok(!mail.subject.includes(event.code));
      assert.match(mail.text, /10 分钟/);
    } else {
      assert.match(mail.text, /https:\/\/iplusplus.club\//);
      assert.match(mail.html!, /href="https:\/\/iplusplus.club\//);
    }
  }
  const password = accountMail(events[3], origin);
  assert.match(password.text, /2026\/11\/16 08:00:00/); assert.match(password.text, /UTC\+08:00/);
});
test('templates escape user content and constrain link origin and header lines', () => {
  const mail = accountMail({ kind: 'welcome', to: 'a@example.com', name: '<b>名字</b>\r\nBcc: attacker', role: 'admin' }, origin);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.doesNotMatch(mail.html!, /<b>名字/); assert.match(mail.html!, /&lt;b&gt;名字&lt;\/b&gt;/);
  assert.throws(() => accountMail(events[0], 'javascript:alert(1)'));
  assert.throws(() => accountMail(events[0], 'https://user:password@example.com'));
  for (const role of ['non_member', 'member', 'admin'] as const) {
    const mail = accountMail({ kind: 'role-changed', to: 'a@example.com', name: '朋友', previous: 'member', role, at: Date.now() }, origin);
    assert.match(mail.text, /请重新登录/); assert.doesNotMatch(mail.text, /社长/);
  }
});
test('notification queue retries failed mail and does not send completed events twice', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('user')");
  let fail = true;
  const sent: Mail[] = [];
  const queue = accountNotifications(db, async m => { if (fail) throw new Error('offline'); sent.push(m); }, origin);
  try {
    queue.enqueue('user', { kind: 'welcome', to: 'a@example.com', name: '朋友', role: 'non_member' });
    await queue.flush();
    assert.equal(db.prepare('SELECT status FROM account_notifications').get()!.status, 'pending');
    assert.equal(db.prepare('SELECT attempts FROM account_notifications').get()!.attempts, 1);
    assert.equal(sent.length, 0);
    fail = false; db.prepare('UPDATE account_notifications SET nextAt=0').run();
    await queue.flush(); await queue.flush();
    assert.equal(sent.length, 1); assert.ok(sent[0].html);
    assert.equal(db.prepare('SELECT status FROM account_notifications').get()!.status, 'sent');
    queue.enqueue('user', { kind: 'password-changed', to: 'a@example.com', name: '朋友', at: Date.now() });
    db.prepare("UPDATE account_notifications SET status='sending' WHERE status='pending'").run();
    queue.close();
    const restarted = accountNotifications(db, async m => { sent.push(m); }, origin);
    try { await restarted.flush(); assert.equal(sent.length, 1); assert.equal(db.prepare("SELECT count(*) n FROM account_notifications WHERE status='failed'").get()!.n, 1); }
    finally { restarted.close(); }
  } finally { queue.close(); db.close(); }
});

test('graceful shutdown drains an active notification and preserves its delivery result', async () => {
  for (const fail of [false,true]) {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('user')");
    let release: () => void = () => {};
    const queue = accountNotifications(db, async () => { await new Promise<void>(r => { release = r; }); if (fail) throw new Error('offline'); }, origin);
    queue.enqueue('user', { kind: 'welcome', to: 'a@example.com', name: '朋友', role: 'non_member' });
    const active = queue.flush();
    const closing = queue.close();
    release(); await active; await closing;
    assert.equal(db.prepare('SELECT status FROM account_notifications').get()!.status, fail ? 'pending' : 'sent');
    db.close();
  }
});
