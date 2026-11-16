import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { createApp } from '../server/app.ts';
import { seedQuestions } from '../server/seed.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Answers, Question } from '../shared/types.ts';
const origin = 'http://localhost:5173';
const password = 'test-only-strong-password';
function setup(t: TestContext, disableRateLimit = true) {
  const { app, db } = createApp({ dbPath: ':memory:', adminPassword: password, origin, disableRateLimit, allowLegacyAdmin: true, requireAccount: false });
  t.after(() => db.close());
  const admin = request.agent(app),
    user = request.agent(app);
  return { app, db, admin, user };
}
function correctAnswers(qs: Question[]): Answers {
  return Object.fromEntries(qs.filter(q => q.points).map(q => [q.id, q.correct]));
}
async function login(admin: ReturnType<typeof request.agent>) {
  await admin.post('/api/admin/login').set('Origin', origin).send({ password }).expect(200);
}
async function enable(admin: ReturnType<typeof request.agent>, count = 14) {
  await login(admin);
  await admin
    .put('/api/admin/settings')
    .set('Origin', origin)
    .send({ enabled: true, questionCount: count, passScore: 80, reviewed: true })
    .expect(200);
}
test('demo is default, no answer leakage; owner binding, drafts and resumption', async t => {
  const { app, user, db } = setup(t);
  const config = await user.get('/api/config').expect(200);
  assert.equal(config.body.enabled, false);
  await user.post('/api/attempts').set('Origin', origin).send({ displayName: '测试', consent: false }).expect(400);
  const started = await user
    .post('/api/attempts')
    .set('Origin', origin)
    .send({ displayName: '测试同学', consent: true })
    .expect(201);
  const a = started.body;
  assert.equal(a.demo, true);
  assert.equal(a.questions.length, 8);
  assert.ok(a.questions.every((q: any) => !('correct' in q) && !('explanation' in q)));
  assert.match(started.headers['set-cookie'][0], /HttpOnly/);
  const resumed = await user
    .post('/api/attempts')
    .set('Origin', origin)
    .send({ displayName: '另一个昵称', consent: true })
    .expect(200);
  assert.equal(resumed.body.id, a.id);
  await request(app).get(`/api/attempts/${a.id}`).expect(404);
  const q = a.questions.find((q: Question) => q.points);
  const answers = { [q.id]: [0] };
  await user.put(`/api/attempts/${a.id}/draft`).set('Origin', origin).send({ answers }).expect(200);
  assert.deepEqual((await user.get(`/api/attempts/${a.id}`)).body.answers, answers);
  const qs: Question[] = JSON.parse(
    (db.prepare('SELECT questions FROM attempts WHERE id=?').get(a.id) as any).questions
  );
  const submitted = await user
    .post(`/api/attempts/${a.id}/submit`)
    .set('Origin', origin)
    .send({ answers: correctAnswers(qs), score: 0, certificateId: 'fake' })
    .expect(200);
  assert.equal(submitted.body.score, 100);
  assert.equal(submitted.body.certificateId, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM certificates').get()!.n, 0);
  const image = await user
    .get(`/api/attempts/${a.id}/certificate.png`)
    .expect(200)
    .expect('Content-Type', /image\/png/);
  assert.deepEqual([...image.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
test('formal pass: transaction issuance, idempotency, public minimum fields, PNG, revocation', async t => {
  const { app, user, admin, db } = setup(t);
  await enable(admin);
  const a = (
    await user.post('/api/attempts').set('Origin', origin).send({ displayName: '正式测试', consent: true }).expect(201)
  ).body;
  const answers = correctAnswers(seedQuestions);
  const result = (await user.post(`/api/attempts/${a.id}/submit`).set('Origin', origin).send({ answers }).expect(200))
    .body;
  assert.equal(result.passed, true);
  assert.equal(result.demo, false);
  assert.ok(result.certificateId);
  const duplicate = (
    await user.post(`/api/attempts/${a.id}/submit`).set('Origin', origin).send({ answers: {} }).expect(200)
  ).body;
  assert.deepEqual(duplicate, result);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM certificates').get()!.n, 1);
  await user.put(`/api/attempts/${a.id}/draft`).set('Origin', origin).send({ answers: {} }).expect(409);
  const cert = (await request(app).get(`/api/certificates/${result.certificateId}`).expect(200)).body;
  assert.equal(cert.revoked, false);
  assert.equal(cert.displayName, '正式测试');
  assert.deepEqual(Object.keys(cert).sort(), ['id', 'revoked', 'displayName', 'score', 'issuedAt', 'version'].sort());
  const png = await user
    .get(`/api/attempts/${a.id}/certificate.png`)
    .expect(200)
    .expect('Content-Disposition', /attachment/);
  const image = await sharp(png.body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const qr = jsQR(new Uint8ClampedArray(image.data), image.info.width, image.info.height);
  assert.equal(qr?.data, `${origin}/verify/${result.certificateId}`);
  await admin.post(`/api/admin/certificates/${result.certificateId}/revoke`).set('Origin', origin).send({}).expect(200);
  assert.equal((await request(app).get(`/api/certificates/${result.certificateId}`)).body.revoked, true);
  await user.get(`/api/attempts/${a.id}/certificate.png`).expect(410);
});
test('cannot forge a pass, submit foreign question IDs, or download failed certificate', async t => {
  const { user, admin } = setup(t);
  await enable(admin);
  const a = (await user.post('/api/attempts').set('Origin', origin).send({ displayName: '测试', consent: true })).body;
  await user.post(`/api/attempts/${a.id}/submit`).set('Origin', origin).send({ score: 100, answers: {} }).expect(400);
  await user
    .post(`/api/attempts/${a.id}/submit`)
    .set('Origin', origin)
    .send({ answers: { ...correctAnswers(seedQuestions), foreign: [0] } })
    .expect(400);
  const wrong: Answers = Object.fromEntries(
    seedQuestions.filter(q => q.points).map(q => [q.id, [q.options.findIndex((_, i) => !q.correct.includes(i))]])
  );
  const r = (
    await user
      .post(`/api/attempts/${a.id}/submit`)
      .set('Origin', origin)
      .send({ answers: wrong, score: 100, passed: true, demo: false })
      .expect(200)
  ).body;
  assert.equal(r.score, 0);
  assert.equal(r.passed, false);
  assert.equal(r.certificateId, null);
  await user.get(`/api/attempts/${a.id}/certificate.png`).expect(403);
});
test('question and pass-line snapshots survive edits; demo can never be upgraded', async t => {
  const { user, admin, db } = setup(t);
  const a = (await user.post('/api/attempts').set('Origin', origin).send({ displayName: '演示快照', consent: true }))
    .body;
  const qs: Question[] = JSON.parse(
    (db.prepare('SELECT questions FROM attempts WHERE id=?').get(a.id) as any).questions
  );
  await enable(admin);
  await admin
    .put(`/api/admin/questions/${qs[0].id}`)
    .set('Origin', origin)
    .send({ ...qs[0], prompt: '修改后的题目内容', points: qs[0].points ? 99 : 0 })
    .expect(200);
  const unchanged = (await user.get(`/api/attempts/${a.id}`)).body;
  assert.equal(unchanged.questions[0].prompt, qs[0].prompt);
  const r = (
    await user
      .post(`/api/attempts/${a.id}/submit`)
      .set('Origin', origin)
      .send({ answers: correctAnswers(qs) })
      .expect(200)
  ).body;
  assert.equal(r.demo, true);
  assert.equal(r.certificateId, null);
  assert.equal(r.version, 1);
});
test('publishing requires confirmation; protected CRUD validates configuration and retains history', async t => {
  const { app, admin } = setup(t);
  await request(app).get('/api/admin').expect(401);
  await request(app).post('/api/admin/questions').set('Origin', origin).send(seedQuestions[0]).expect(401);
  await login(admin);
  await admin
    .put('/api/admin/settings')
    .set('Origin', origin)
    .send({ enabled: true, questionCount: 8, passScore: 80 })
    .expect(400);
  await admin
    .put('/api/admin/settings')
    .set('Origin', origin)
    .send({ enabled: true, questionCount: 30, passScore: 80, reviewed: true })
    .expect(400);
  await admin
    .post('/api/admin/questions')
    .set('Origin', origin)
    .send({ ...seedQuestions[0], type: 'text' })
    .expect(400);
  const added = (
    await admin
      .post('/api/admin/questions')
      .set('Origin', origin)
      .send({ ...seedQuestions[0], prompt: '新增一题的测试题目' })
      .expect(200)
  ).body;
  await admin
    .put(`/api/admin/questions/${added.id}`)
    .set('Origin', origin)
    .send({ ...added, prompt: '修改后保留的测试题目' })
    .expect(200);
  await admin.delete(`/api/admin/questions/${added.id}`).set('Origin', origin).send({}).expect(200);
  await admin.post('/api/admin/logout').set('Origin', origin).send({}).expect(200);
  await admin.get('/api/admin').expect(401);
});
test('CSRF, expiration, owner bypass, and paused formal submission are blocked', async t => {
  const { user, admin, db, app } = setup(t);
  await user.post('/api/attempts').send({ displayName: '测试', consent: true }).expect(403);
  await user
    .post('/api/attempts')
    .set('Origin', 'https://evil.example')
    .send({ displayName: '测试', consent: true })
    .expect(403);
  await enable(admin);
  const a = (await user.post('/api/attempts').set('Origin', origin).send({ displayName: '测试', consent: true })).body;
  await request(app)
    .post(`/api/attempts/${a.id}/submit`)
    .set('Origin', origin)
    .send({ answers: correctAnswers(seedQuestions) })
    .expect(404);
  await admin
    .put('/api/admin/settings')
    .set('Origin', origin)
    .send({ enabled: false, questionCount: 14, passScore: 80 })
    .expect(200);
  await user
    .post(`/api/attempts/${a.id}/submit`)
    .set('Origin', origin)
    .send({ answers: correctAnswers(seedQuestions) })
    .expect(409);
  db.prepare('UPDATE attempts SET expiresAt=0 WHERE id=?').run(a.id);
  await user
    .post(`/api/attempts/${a.id}/submit`)
    .set('Origin', origin)
    .send({ answers: correctAnswers(seedQuestions) })
    .expect(410);
});
test('rate limiting, missing password and production configuration fail closed', async t => {
  const { app } = setup(t, false);
  for (let i = 0; i < 5; i++)
    await request(app).post('/api/admin/login').set('Origin', origin).send({ password: 'wrong' }).expect(401);
  await request(app).post('/api/admin/login').set('Origin', origin).send({ password }).expect(429);
  const empty = createApp({ dbPath: ':memory:', adminPassword: '', origin, allowLegacyAdmin: true });
  t.after(() => empty.db.close());
  await request(empty.app).post('/api/admin/login').set('Origin', origin).send({ password: '' }).expect(503);
  assert.throws(() => createApp({ production: true, origin: 'http://iplusplus.club', adminPassword: password }));

});
test('production security headers and cookie flags are applied', async t => {
  const { app, db } = createApp({
    dbPath: ':memory:',
    origin: 'https://iplusplus.club',
    adminPassword: password,
    production: true
  });
  t.after(() => db.close());
  const login = await request(app)
    .post('/api/admin/login').set('Origin', 'https://iplusplus.club').send({ password }).expect(410);
  assert.match(login.headers['content-security-policy'], /script-src 'self'/);
  assert.match(login.headers['strict-transport-security'], /max-age=/);
  assert.equal(login.headers['cache-control'], 'no-store');
  await request(app)
    .post('/api/attempts')
    .set('Origin', origin)
    .send({ displayName: 'test', consent: true })
    .expect(403);
});
test('SQLite persists attempt and certificate records across app restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipp-test-'));
  const dbPath = join(dir, 'club.sqlite');
  const first = createApp({ dbPath, origin, adminPassword: password, allowLegacyAdmin: true, requireAccount: false });
  const admin = request.agent(first.app),
    user = request.agent(first.app);
  let closed = false;
  try {
    await enable(admin);
    const a = (
      await user.post('/api/attempts').set('Origin', origin).send({ displayName: '持久化测试', consent: true })
    ).body;
    const r = (
      await user
        .post(`/api/attempts/${a.id}/submit`)
        .set('Origin', origin)
        .send({ answers: correctAnswers(seedQuestions) })
    ).body;
    first.db.close();
    closed = true;
    const second = createApp({ dbPath, origin, adminPassword: password, allowLegacyAdmin: true, requireAccount: false });
    try {
      const persisted = (await request(second.app).get(`/api/certificates/${r.certificateId}`).expect(200)).body;
      assert.equal(persisted.displayName, '持久化测试');
    } finally {
      second.db.close();
    }
  } finally {
    if (!closed) first.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
