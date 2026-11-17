import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InterviewSchedule } from '../shared/recruitment.ts';
const origin = 'http://localhost:5173';
const password = 'recruitment-test-password';
function setup(t: TestContext, dbPath = ':memory:') {
  const sent: { to: string; text: string }[] = [];
  const server = createApp({
    dbPath,
    origin,
    disableRateLimit: true,
    mailer: async mail => {
      sent.push(mail);
    }
  });
  let closed = false;
  const close = async () => {
    if (!closed) {
      await server.accounts.close();
      server.db.close();
      closed = true;
    }
  };
  t.after(close);
  async function register(email: string, role = 'non_member') {
    const client = request.agent(server.app);
    await client.post('/api/auth/code').set('Origin', origin).send({ email }).expect(200);
    const code = sent.findLast(mail => mail.to === email)!.text.match(/\d{6}/)![0];
    const { body } = await client
      .post('/api/auth/register')
      .set('Origin', origin)
      .send({ email, code, displayName: '测试用户', password })
      .expect(201);
    server.db.prepare('UPDATE users SET role=? WHERE id=?').run(role, body.user.id);
    return { client, user: body.user };
  }
  return { ...server, register, close };
}
const input = () => ({
  title: '秋季招新面试',
  location: '教学楼 302',
  description: '请携带校园卡。',
  slots: [1, 2].map(day => ({ startAt: Date.now() + day * 86400000, endAt: Date.now() + day * 86400000 + 3600000 }))
});
const apply = (schedule: InterviewSchedule) => ({
  scheduleId: schedule.id,
  slotId: schedule.slots[0].id,
  name: '小林',
  contact: 'student@example.com',
  note: '周日下午'
});
test('only president publishes; admins can read; guests and other accounts cannot read applications', async t => {
  const { app, register, db } = setup(t);
  const president = await register('president@example.com', 'president');
  const admin = await register('admin@example.com', 'admin');
  const student = await register('student@example.com');
  const other = await register('other@example.com', 'member');
  await request(app).post('/api/admin/interviews').set('Origin', origin).send(input()).expect(401);
  await admin.client.post('/api/admin/interviews').set('Origin', origin).send(input()).expect(403);
  await student.client.post('/api/admin/interviews').set('Origin', origin).send(input()).expect(403);
  const { body: schedule } = await president.client
    .post('/api/admin/interviews')
    .set('Origin', origin)
    .send(input())
    .expect(201);
  assert.equal(schedule.slots.length, 2);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='publish-interview'").get());
  await request(app).post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(401);
  const { body: application } = await student.client
    .post('/api/join/applications')
    .set('Origin', origin)
    .send({ ...apply(schedule), userId: other.user.id })
    .expect(201);
  assert.equal(application.userId, student.user.id);
  assert.equal((await student.client.get('/api/join/schedules')).body[0].application.id, application.id);
  const anonymous = (await request(app).get('/api/join/schedules').expect(200)).body[0];
  assert.equal(anonymous.application, null);
  assert.equal((await other.client.get('/api/join/schedules')).body[0].application, null);
  assert.ok(!JSON.stringify(anonymous).includes('student@example.com'));
  await student.client.get('/api/admin/interviews').expect(403);
  await other.client.get('/api/admin/interviews').expect(403);
  await request(app).get('/api/admin/interviews').expect(401);
  for (const manager of [president, admin]) {
    const data = (await manager.client.get('/api/admin/interviews').expect(200)).body;
    assert.equal(data.applications[0].email, 'student@example.com');
    assert.equal(data.applications[0].name, '小林');
  }
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(409);
  db.prepare('UPDATE account_sessions SET expiresAt=0 WHERE userId=?').run(student.user.id);
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(401);
});
test('validates slots, expired choices, invalid references, CSRF and concurrent duplicate applications', async t => {
  const { app, register, db } = setup(t);
  const president = await register('president@example.com', 'president');
  const student = await register('student@example.com');
  const body = input();
  for (const slots of [[], [{ startAt: 1, endAt: 2 }], [{ startAt: 20, endAt: 10 }], [body.slots[0], body.slots[0]]]) {
    await president.client
      .post('/api/admin/interviews')
      .set('Origin', origin)
      .send({ ...body, slots })
      .expect(400);
  }
  await president.client.post('/api/admin/interviews').set('Origin', 'https://evil.test').send(body).expect(403);
  const { body: schedule } = await president.client
    .post('/api/admin/interviews')
    .set('Origin', origin)
    .send(body)
    .expect(201);
  await student.client
    .post('/api/join/applications')
    .set('Origin', origin)
    .send({ ...apply(schedule), scheduleId: randomUUID() })
    .expect(404);
  await student.client
    .post('/api/join/applications')
    .set('Origin', origin)
    .send({ ...apply(schedule), slotId: randomUUID() })
    .expect(400);
  await student.client
    .post('/api/join/applications')
    .set('Origin', origin)
    .send({ ...apply(schedule), name: ' ' })
    .expect(400);
  await student.client.post('/api/join/applications').send(apply(schedule)).expect(403);
  schedule.slots[0].endAt = Date.now() - 1;
  schedule.slots[0].startAt = Date.now() - 1000;
  db.prepare('UPDATE interview_schedules SET data=? WHERE id=?').run(JSON.stringify(schedule), schedule.id);
  assert.equal((await request(app).get('/api/join/schedules')).body[0].expired, false);
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(409);
  const responses = await Promise.all(
    [1, 2].map(() =>
      student.client
        .post('/api/join/applications')
        .set('Origin', origin)
        .send({ ...apply(schedule), slotId: schedule.slots[1].id })
    )
  );
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(db.prepare('SELECT count(*) n FROM interview_applications').get()!.n, 1);
  schedule.slots.forEach((slot: any) => {
    slot.endAt = Date.now() - 1;
  });
  db.prepare('UPDATE interview_schedules SET data=? WHERE id=?').run(JSON.stringify(schedule), schedule.id);
  const historical = (await request(app).get('/api/join/schedules')).body[0];
  assert.equal(historical.expired, true);
  assert.equal(historical.title, body.title);
});
test('migration is additive and interview records survive app restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ipp-recruitment-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'club.sqlite');
  const first = setup(t, dbPath);
  const president = await first.register('president@example.com', 'president');
  const student = await first.register('student@example.com');
  const schedule = (
    await president.client.post('/api/admin/interviews').set('Origin', origin).send(input()).expect(201)
  ).body;
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(201);
  const questions = first.db.prepare('SELECT count(*) n FROM questions').get()!.n;
  await first.close();
  const second = setup(t, dbPath);
  assert.equal(second.db.prepare('SELECT count(*) n FROM interview_applications').get()!.n, 1);
  assert.equal(second.db.prepare('SELECT count(*) n FROM questions').get()!.n, questions);
  const agent = request.agent(second.app);
  await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email: 'student@example.com', password })
    .expect(200);
  assert.equal((await agent.get('/api/join/schedules')).body[0].application.name, '小林');
});
