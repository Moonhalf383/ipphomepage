import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedQuestions } from '../server/seed.ts';
import type { Mail } from '../server/mail.ts';
const origin = 'http://localhost:5173';
const password = 'strong-password-test-2026';
function setup(t: any, initialPresidentEmail?: string) {
  const sent: Mail[] = [];
  const server = createApp({ dbPath: ':memory:', origin, disableRateLimit: true, initialPresidentEmail, mailer: async m => { sent.push(m); }, bulkMailer: async m => { sent.push(m); } });
  t.after(() => { server.accounts.close(); server.db.close(); });
  const agent = () => request.agent(server.app);
  async function register(email: string, role = 'non_member') {
    const client = agent();
    await client.post('/api/auth/code').set('Origin', origin).send({ email }).expect(200);
    const code = sent.findLast(m => m.to === email)!.text.match(/\d{6}/)![0];
    const r = await client.post('/api/auth/register').set('Origin', origin).send({ email, password, code, displayName: email.split('@')[0] }).expect(201);
    if (role !== 'non_member') server.db.prepare('UPDATE users SET role=? WHERE id=?').run(role, r.body.user.id);
    return { client, user: r.body.user, code };
  }
  return { ...server, sent, agent, register };
}
test('verified registration hashes credentials and consumes each code once', async t => {
  const { register, db, agent } = setup(t);
  const { client, user, code } = await register('person@example.com');
  assert.equal(user.role, 'non_member');
  assert.equal(user.passwordHash, undefined);
  assert.match(String(db.prepare('SELECT passwordHash FROM users').get()!.passwordHash), /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal((await client.get('/api/auth/me')).body.user.id, user.id);
  await agent().post('/api/auth/register').set('Origin', origin).send({ email: user.email, password, code, displayName: '再次注册' }).expect(400);
  await client.post('/api/auth/logout').set('Origin', origin).send({}).expect(200);
  assert.equal((await client.get('/api/auth/me')).body.user, null);
  await client.post('/api/auth/login').set('Origin', origin).send({ email: user.email, password: 'wrong' }).expect(401);
  const login = await client.post('/api/auth/login').set('Origin', origin).send({ email: 'PERSON@EXAMPLE.COM', password }).expect(200);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  const cookieToken = login.headers['set-cookie'][0].split('=')[1].split(';')[0];
  assert.notEqual(String(db.prepare('SELECT token FROM account_sessions').get()!.token), cookieToken);
  await agent().post('/api/auth/login').set('Origin', 'https://evil.test').send({ email: user.email, password }).expect(403);
});
test('registration rejects expired and exhausted codes and handles concurrent reuse', async t => {
  const { app, db, sent } = setup(t);
  const input = { email: 'code@example.com', password, displayName: '测试' };
  await request(app).post('/api/auth/register').set('Origin', origin).send({ ...input, code: '000000' }).expect(400);
  await request(app).post('/api/auth/code').set('Origin', origin).send(input).expect(200);
  const code = sent[0].text.match(/\d{6}/)![0];
  for (let i = 0; i < 5; i++) await request(app).post('/api/auth/register').set('Origin', origin).send({ ...input, code: '000000' }).expect(400);
  await request(app).post('/api/auth/register').set('Origin', origin).send({ ...input, code }).expect(400);
  db.prepare('UPDATE email_codes SET failures=0,expiresAt=0').run();
  await request(app).post('/api/auth/register').set('Origin', origin).send({ ...input, code }).expect(400);
  db.prepare('UPDATE email_codes SET failures=0,expiresAt=?').run(Date.now() + 60000);
  const results = await Promise.all([1,2].map(() => request(app).post('/api/auth/register').set('Origin', origin).send({ ...input, code })));
  assert.deepEqual(results.map(r => r.status).sort(), [201,400]);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get()!.n, 1);
});
test('role hierarchy and session revocation enforce account permissions', async t => {
  const { register, agent } = setup(t);
  const guest = await register('guest@example.com');
  const member = await register('member@example.com', 'member');
  const admin = await register('admin@example.com', 'admin');
  const president = await register('president@example.com', 'president');
  await agent().get('/api/admin/users').expect(401);
  await guest.client.get('/api/admin').expect(403);
  await member.client.get('/api/admin/users').expect(403);
  const listing = (await admin.client.get('/api/admin/users').expect(200)).body;
  assert.ok(listing.users.every((u: any) => ['non_member','member','admin'].includes(u.role)));
  assert.ok(listing.users.find((u: any) => u.id === president.user.id).editableRoles.length === 0);
  assert.equal((await president.client.get('/api/auth/me')).body.user.role, 'admin');
  const role = (client: any, id: string, value: string) => client.put(`/api/admin/users/${id}/role`).set('Origin', origin).send({ role: value });
  await role(admin.client, guest.user.id, 'admin').expect(403);
  await role(admin.client, president.user.id, 'member').expect(403);
  await role(admin.client, admin.user.id, 'member').expect(403);
  await role(admin.client, guest.user.id, 'member').expect(200);
  assert.equal((await guest.client.get('/api/auth/me')).body.user, null);
  await role(president.client, member.user.id, 'admin').expect(200);
  await member.client.post('/api/auth/login').set('Origin', origin).send({ email: member.user.email, password }).expect(200);
  await member.client.get('/api/admin').expect(200);
  await role(president.client, member.user.id, 'member').expect(200);
  await member.client.get('/api/admin').expect(401);
  await role(president.client, admin.user.id, 'president').expect(400);
});
test('formal assessments are account-owned and report scores with email to administrators', async t => {
  const { register, app, db, agent } = setup(t);
  const admin = await register('admin@example.com', 'admin');
  const person = await register('student@example.com');
  const stranger = await register('other@example.com');
  await admin.client.put('/api/admin/settings').set('Origin', origin).send({ enabled: true, reviewed: true, questionCount: 14, passScore: 80 }).expect(200);
  const start = (client: any) => client.post('/api/attempts').set('Origin', origin).send({ displayName: '学生', consent: true });
  await start(request(app)).expect(401);
  const a = (await start(person.client).expect(201)).body;
  await stranger.client.get(`/api/attempts/${a.id}`).expect(404);
  const another = agent();
  await another.post('/api/auth/login').set('Origin', origin).send({ email: person.user.email, password }).expect(200);
  assert.equal((await start(another).expect(200)).body.id, a.id);
  await another.get(`/api/attempts/${a.id}`).expect(200);
  await another.post(`/api/attempts/${a.id}/submit`).set('Origin', origin).send({ answers: Object.fromEntries(seedQuestions.filter(q => q.points).map(q => [q.id,q.correct])) }).expect(200);
  const record = (await admin.client.get('/api/admin')).body.attempts[0];
  assert.equal(record.email, person.user.email); assert.equal(record.result.score, 100);
  assert.equal((await another.get('/api/auth/attempts')).body[0].id, a.id);
  assert.equal(db.prepare('SELECT userId FROM attempts').get()!.userId, person.user.id);
});
test('mail selection is deduplicated and queue status records private deliveries', async t => {
  const { register, sent, accounts, db } = setup(t);
  const admin = await register('admin@example.com', 'admin');
  const member = await register('member@example.com', 'member');
  const guest = await register('guest@example.com');
  await guest.client.post('/api/admin/mail').set('Origin', origin).send({}).expect(403);
  const body = { subject: '活动通知', text: '周末见！', roles: ['member'], userIds: [member.user.id, guest.user.id], confirm: true };
  await admin.client.post('/api/admin/mail').set('Origin', origin).send({ ...body, subject: 'x\r\nBcc: injected' }).expect(400);
  const job = (await admin.client.post('/api/admin/mail').set('Origin', origin).send(body).expect(202)).body;
  assert.equal(job.recipients, 2);
  await accounts.flushMail();
  const mail = sent.filter(m => m.subject === body.subject);
  assert.equal(mail.length, 2); assert.ok(mail.every(m => m.to === member.user.email || m.to === guest.user.email));
  await accounts.flushMail(); assert.equal(sent.filter(m => m.subject === body.subject).length, 2);
  const status = (await admin.client.get('/api/admin/mail')).body[0];
  assert.equal(status.sent, 2); assert.equal(status.pending, 0);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='send-mail'").get());
});
test('production disables the shared admin password and reports missing SMTP configuration', async t => {
  const { app, db, accounts } = createApp({ dbPath: ':memory:', production: true, origin: 'https://iplusplus.club', adminPassword: 'strong-legacy-password', allowLegacyAdmin: true });
  t.after(() => { accounts.close(); db.close(); });
  await request(app).post('/api/auth/code').set('Origin', 'https://iplusplus.club').send({ email: 'a@example.com' }).expect(503);
  await request(app).post('/api/admin/login').set('Origin', 'https://iplusplus.club').send({ password: 'strong-legacy-password' }).expect(410);
  await request(app).get('/api/admin').expect(401);
});

test('initial president requires verified ownership of the configured email', async t => {
  const { register, db } = setup(t, 'Owner@Example.com');
  const guest = await register('visitor@example.com');
  assert.equal(guest.user.role, 'non_member');
  const owner = await register('owner@example.com');
  assert.equal(owner.user.role, 'admin');
  assert.equal(owner.user.canManageAdmins, true);
  assert.throws(() => db.prepare("INSERT INTO users VALUES ('second-owner','second@example.com','另一个','hash','president',1)").run());
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='verified:initial-president'").get());
});

test('role migration retains account sessions and maps registered guests to non-members', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipp-roles-'));
  const dbPath = join(dir, 'test.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,displayName TEXT NOT NULL,passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'guest' CHECK(role IN ('guest','member','admin','president')),createdAt INTEGER NOT NULL);
    INSERT INTO users VALUES ('old-user','old@example.com','旧账号','hash','guest',1);
    CREATE TABLE account_sessions (token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),expiresAt INTEGER NOT NULL);
    INSERT INTO account_sessions VALUES ('old-session','old-user',9999999999999);`);
  legacy.close();
  const server = createApp({ dbPath, origin });
  try {
    assert.equal(server.db.prepare('SELECT role FROM users').get()!.role, 'non_member');
    assert.equal(server.db.prepare('SELECT userId FROM account_sessions').get()!.userId, 'old-user');
    assert.deepEqual(server.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => server.db.prepare("UPDATE users SET role='guest'").run());
  } finally { server.accounts.close(); server.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('password recovery consumes purpose-bound code, preserves role and revokes sessions', async t => {
  const { register, app, sent, db, agent } = setup(t);
  const owner = await register('recover@example.com', 'president');
  const second = agent();
  await second.post('/api/auth/login').set('Origin', origin).send({ email: owner.user.email, password }).expect(200);
  await owner.client.post('/api/auth/password/code').set('Origin', origin).send({ email: owner.user.email }).expect(200);
  const code = sent.findLast(m => m.to === owner.user.email)!.text.match(/\d{6}/)![0];
  const newPassword = 'new-password-recovery-2026';
  await request(app).post('/api/auth/register').set('Origin', origin).send({ email: 'new@example.com', displayName: '其他用户', password: newPassword, code }).expect(400);
  const reset = (candidate: string) => request(app).post('/api/auth/password/reset').set('Origin', origin).send({ email: owner.user.email, code, password: candidate });
  await reset('short').expect(400);
  const results = await Promise.all([reset(newPassword), reset(newPassword)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200,400]);
  assert.equal((await owner.client.get('/api/auth/me')).body.user, null);
  assert.equal((await second.get('/api/auth/me')).body.user, null);
  await second.post('/api/auth/login').set('Origin', origin).send({ email: owner.user.email, password }).expect(401);
  const login = await second.post('/api/auth/login').set('Origin', origin).send({ email: owner.user.email, password: newPassword }).expect(200);
  assert.equal(login.body.user.role, 'admin'); assert.equal(login.body.user.canManageAdmins, true);
  await reset(newPassword).expect(400);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_log WHERE action='reset-password'").get()!.n, 1);
});

test('password recovery rejects wrong, exhausted and expired codes and uses generic missing-user responses', async t => {
  const { register, app, sent, db } = setup(t);
  const owner = await register('expired@example.com');
  const send = (email: string) => request(app).post('/api/auth/password/code').set('Origin', origin).send({ email });
  const response = await send(owner.user.email).expect(200);
  const missing = await send('missing@example.com').expect(200);
  assert.deepEqual(response.body, missing.body);
  assert.equal(sent.filter(m => m.to === 'missing@example.com').length, 0);
  await send(owner.user.email).expect(429);
  await send('missing@example.com').expect(429);
  const code = sent.findLast(m => m.to === owner.user.email)!.text.match(/\d{6}/)![0];
  const reset = (value: string) => request(app).post('/api/auth/password/reset').set('Origin', origin).send({ email: owner.user.email, code: value, password: 'replacement-password-2026' });
  for (let i=0; i<5; i++) await reset('000000').expect(400);
  await reset(code).expect(400);
  db.prepare('UPDATE password_reset_codes SET failures=0,expiresAt=0').run();
  await reset(code).expect(400);
  await request(app).post('/api/auth/password/code').set('Origin', 'https://evil.test').send({ email: owner.user.email }).expect(403);
});

test('recovery responds before SMTP completes and rejects old-password login racing a reset', async t => {
  let resolveDelivery: () => void = () => {};
  let delayMail = false;
  let deliveredCode = '';
  const server = createApp({ dbPath: ':memory:', origin, disableRateLimit: true, mailer: async m => {
    deliveredCode = m.text.match(/\d{6}/)![0];
    if (delayMail) await new Promise<void>(resolve => { resolveDelivery = resolve; });
  } });
  t.after(() => { resolveDelivery(); server.accounts.close(); server.db.close(); });
  const user = request.agent(server.app);
  const email = 'racing@example.com';
  await user.post('/api/auth/code').set('Origin', origin).send({ email }).expect(200);
  await user.post('/api/auth/register').set('Origin', origin).send({ email, password, code: deliveredCode, displayName: '并发测试' }).expect(201);
  delayMail = true;
  await user.post('/api/auth/password/code').set('Origin', origin).send({ email }).timeout({ response: 500 }).expect(200);
  resolveDelivery();
  const reset = request(server.app).post('/api/auth/password/reset').set('Origin', origin).send({ email, code: deliveredCode, password: 'racing-replacement-password' });
  const login = request.agent(server.app);
  const [resetResult, loginResult] = await Promise.all([reset, login.post('/api/auth/login').set('Origin', origin).send({ email, password })]);
  assert.equal(resetResult.status, 200);
  assert.ok([200,401].includes(loginResult.status));
  assert.equal((await login.get('/api/auth/me')).body.user, null);
});

test('successful registration, password change and role change enqueue exactly one branded notice', async t => {
  const { register, app, sent, accounts, db } = setup(t);
  const person = await register('notices@example.com');
  const admin = await register('operator@example.com', 'admin');
  assert.equal(db.prepare("SELECT count(*) n FROM account_notifications WHERE json_extract(event,'$.kind')='welcome'").get()!.n, 2);
  await accounts.flushNotifications();
  const welcome = sent.find(m => m.to === person.user.email && m.subject.includes('账号已准备好'))!;
  assert.ok(welcome.html); assert.match(welcome.text, /当前身份：非社员/);
  const update = () => admin.client.put(`/api/admin/users/${person.user.id}/role`).set('Origin', origin).send({ role: 'member' });
  await update().expect(200); await update().expect(200);
  await accounts.flushNotifications();
  const roleMails = sent.filter(m => m.to === person.user.email && m.subject.includes('身份已更新'));
  assert.equal(roleMails.length, 1); assert.match(roleMails[0].text, /原身份：非社员/); assert.match(roleMails[0].text, /新身份：社员/);
  await admin.client.put(`/api/admin/users/${person.user.id}/role`).set('Origin', origin).send({ role: 'admin' }).expect(403);
  await accounts.flushNotifications();
  assert.equal(sent.filter(m => m.subject.includes('身份已更新')).length, 1);
  await request(app).post('/api/auth/password/code').set('Origin', origin).send({ email: person.user.email }).expect(200);
  const code = sent.findLast(m => m.to === person.user.email && m.subject.includes('重设密码验证码'))!.text.match(/\d{6}/)![0];
  const reset = () => request(app).post('/api/auth/password/reset').set('Origin', origin).send({ email: person.user.email, code, password: 'updated-notification-password' });
  await reset().expect(200); await reset().expect(400);
  await accounts.flushNotifications(); await accounts.flushNotifications();
  const changed = sent.filter(m => m.to === person.user.email && m.subject.includes('密码已更新'));
  assert.equal(changed.length, 1); assert.ok(changed[0].html); assert.doesNotMatch(changed[0].text, /updated-notification-password/);
});

test('account state changes and notifications commit together; queued events persist across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipp-notifications-'));
  const dbPath = join(dir, 'test.sqlite');
  const sent: Mail[] = [];
  let server = createApp({ dbPath, origin, disableRateLimit: true, mailer: async m => { sent.push(m); } });
  try {
    const email = 'persistent@example.com';
    await request(server.app).post('/api/auth/code').set('Origin', origin).send({ email }).expect(200);
    const code = sent[0].text.match(/\d{6}/)![0];
    server.db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON account_notifications BEGIN SELECT RAISE(ABORT,'simulate storage failure'); END");
    const register = () => request(server.app).post('/api/auth/register').set('Origin', origin).send({ email, code, password, displayName: '持久化测试' });
    await register().expect(500);
    assert.equal(server.db.prepare('SELECT count(*) n FROM users').get()!.n, 0);
    assert.equal(server.db.prepare('SELECT count(*) n FROM email_codes').get()!.n, 1);
    server.db.exec('DROP TRIGGER fail_notice');
    await register().expect(201);
    server.accounts.close(); server.db.close();
    server = createApp({ dbPath, origin, disableRateLimit: true, mailer: async m => { sent.push(m); } });
    await server.accounts.flushNotifications();
    assert.equal(sent.filter(m => m.subject.includes('账号已准备好')).length, 1);
  } finally { server.accounts.close(); server.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
