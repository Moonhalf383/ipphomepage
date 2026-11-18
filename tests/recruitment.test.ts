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
  return { ...server, register, close, sent };
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

test('president edits schedules with booked slots locked; other roles cannot manage', async t => {
  const { app, register, db, accounts, sent } = setup(t);
  const president = await register('edit-p@example.com', 'president');
  const admin = await register('edit-a@example.com', 'admin');
  const student = await register('edit-s@example.com');
  const { body: schedule } = await president.client
    .post('/api/admin/interviews').set('Origin', origin).send(input()).expect(201);
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(schedule)).expect(201);
  const url = `/api/admin/interviews/${schedule.id}`;
  const editBody = () => ({
    title: '改期面试', location: '新楼 101', description: '',
    slots: [
      { id: schedule.slots[0].id, startAt: schedule.slots[0].startAt, endAt: schedule.slots[0].endAt },
      { startAt: Date.now() + 3 * 86400000, endAt: Date.now() + 3 * 86400000 + 3600000 }
    ]
  });
  await admin.client.put(url).set('Origin', origin).send(editBody()).expect(403);
  await admin.client.post(`${url}/cancel`).set('Origin', origin).send({}).expect(403);
  await admin.client.delete(url).set('Origin', origin).expect(403);
  await student.client.put(url).set('Origin', origin).send(editBody()).expect(403);
  const { body: edited } = await president.client.put(url).set('Origin', origin).send(editBody()).expect(200);
  assert.equal(edited.title, '改期面试');
  assert.equal(edited.slots[0].id, schedule.slots[0].id);
  assert.notEqual(edited.slots[1].id, schedule.slots[1].id);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='edit-interview'").get());
  await accounts.flushNotifications();
  const update = sent.findLast(mail => mail.to === 'edit-s@example.com' && mail.text.includes('信息有更新'));
  assert.ok(update, 'applicant receives update notice');
  assert.match(update!.text, /新楼 101/);
  // Booked slot cannot move or disappear.
  const moved = editBody();
  moved.slots[0] = { ...moved.slots[0], startAt: moved.slots[0].startAt + 60_000, endAt: moved.slots[0].endAt + 60_000 };
  await president.client.put(url).set('Origin', origin).send(moved).expect(409);
  await president.client.put(url).set('Origin', origin).send({ ...editBody(), slots: [editBody().slots[1]] }).expect(409);
  await president.client.put(url).set('Origin', origin)
    .send({ ...editBody(), slots: [{ id: randomUUID(), startAt: Date.now() + 86400000, endAt: Date.now() + 90000000 }] }).expect(400);
  // Application keeps its slot; applicant receives an update notice.
  const publicList = (await student.client.get('/api/join/schedules').expect(200)).body;
  const mine = publicList.find((s: InterviewSchedule) => s.id === schedule.id);
  assert.equal(mine.title, '改期面试');
  assert.equal(mine.application.slotId, schedule.slots[0].id);
  assert.equal(mine.cancelledAt, null);
  // Legacy rows without cancelledAt normalize to null.
  const legacy = { ...edited } as Partial<InterviewSchedule>;
  delete legacy.cancelledAt;
  db.prepare('UPDATE interview_schedules SET data=? WHERE id=?').run(JSON.stringify(legacy), schedule.id);
  const normalized = (await student.client.get('/api/join/schedules').expect(200)).body;
  assert.equal(normalized.find((s: InterviewSchedule) => s.id === schedule.id).cancelledAt, null);
});

test('cancel notifies applicants and blocks applications and edits; delete requires no applications', async t => {
  const { app, register, db, accounts, sent } = setup(t);
  const president = await register('cancel-p@example.com', 'president');
  const student = await register('cancel-s@example.com');
  const { body: first } = await president.client.post('/api/admin/interviews').set('Origin', origin).send(input()).expect(201);
  const { body: second } = await president.client
    .post('/api/admin/interviews').set('Origin', origin).send({ ...input(), title: '无人填报' }).expect(201);
  await student.client.post('/api/join/applications').set('Origin', origin).send(apply(first)).expect(201);
  const { body: cancelled } = await president.client
    .post(`/api/admin/interviews/${first.id}/cancel`).set('Origin', origin).send({}).expect(200);
  assert.ok(cancelled.cancelledAt > 0);
  await accounts.flushNotifications();
  const notice = sent.findLast(mail => mail.to === 'cancel-s@example.com' && mail.text.includes('已被取消'));
  assert.ok(notice, 'applicant receives cancellation notice');
  assert.match(notice!.text, /秋季招新面试/);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='cancel-interview'").get());
  await student.client.post('/api/join/applications').set('Origin', origin)
    .send({ ...apply(first), slotId: first.slots[1].id }).expect(409);
  await president.client.put(`/api/admin/interviews/${first.id}`).set('Origin', origin)
    .send({ title: 'x', location: 'y', description: '', slots: first.slots }).expect(409);
  await president.client.post(`/api/admin/interviews/${first.id}/cancel`).set('Origin', origin).send({}).expect(409);
  await president.client.delete(`/api/admin/interviews/${first.id}`).set('Origin', origin).expect(409);
  assert.equal(db.prepare('SELECT count(*) n FROM interview_applications WHERE scheduleId=?').get(first.id)!.n, 1);
  await president.client.delete(`/api/admin/interviews/${second.id}`).set('Origin', origin).expect(200);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action='delete-interview'").get());
  const list = (await student.client.get('/api/join/schedules').expect(200)).body;
  assert.ok(!list.some((s: InterviewSchedule) => s.id === second.id));
  const kept = list.find((s: InterviewSchedule) => s.id === first.id);
  assert.ok(kept.cancelledAt > 0);
  assert.ok(kept.application);
  await president.client.delete(`/api/admin/interviews/${randomUUID()}`).set('Origin', origin).expect(404);
});
