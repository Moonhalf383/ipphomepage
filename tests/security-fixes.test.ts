import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';

const origin = 'http://localhost:5173';
const password = 'test-only-strong-password';

test('guest token is always server-rotated; preset tokens cannot fixate ownership', async t => {
  const { app, db } = createApp({ dbPath: ':memory:', origin, disableRateLimit: true, requireAccount: false, adminPassword: password, allowLegacyAdmin: true });
  t.after(() => db.close());
  const preset = 'a'.repeat(64);
  const victim = request.agent(app);
  const created = await victim
    .post('/api/attempts')
    .set('Origin', origin)
    .set('Cookie', `ipp_guest=${preset}`)
    .send({ displayName: '固定化测试', consent: true })
    .expect(201);
  const setCookie = (created.headers['set-cookie'] as unknown as string[]).join(';');
  const issued = /ipp_guest=([a-f0-9]{64})/.exec(setCookie)?.[1];
  assert.ok(issued && issued !== preset, 'server must issue a fresh token instead of reusing the client value');
  // An attacker holding the preset token cannot read the victim's attempt.
  await request(app)
    .get(`/api/attempts/${created.body.id}`)
    .set('Origin', origin)
    .set('Cookie', `ipp_guest=${preset}`)
    .expect(404);
  // The victim (holding the rotated cookie) can read it.
  await victim.get(`/api/attempts/${created.body.id}`).expect(200);
  // Creating again resumes the same unfinished attempt under the newest token.
  const again = await victim
    .post('/api/attempts')
    .set('Origin', origin)
    .send({ displayName: '固定化测试', consent: true })
    .expect(200);
  assert.equal(again.body.id, created.body.id);
  await victim.get(`/api/attempts/${created.body.id}`).expect(200);
});

test('production requires an account for attempts even when the quiz is paused', async t => {
  const { app, db } = createApp({ dbPath: ':memory:', origin: 'https://iplusplus.club', production: true, adminPassword: password });
  t.after(() => db.close());
  await request(app)
    .post('/api/attempts')
    .set('Origin', 'https://iplusplus.club')
    .send({ displayName: '匿名', consent: true })
    .expect(401);
});

test('validation errors do not expose internal zod patterns', async t => {
  const { app, db } = createApp({ dbPath: ':memory:', origin, disableRateLimit: true, requireAccount: false, adminPassword: password, allowLegacyAdmin: true });
  t.after(() => db.close());
  const res = await request(app)
    .post('/api/attempts')
    .set('Origin', origin)
    .send({ displayName: 'a\u202eb', consent: true })
    .expect(400);
  assert.doesNotMatch(res.body.error, /must match|Invalid string|\\u202a/);
  assert.match(res.body.error, /请求参数不合法/);
});

test('verification tables store email digests, not plaintext addresses', async t => {
  const { app, db } = createApp({ dbPath: ':memory:', origin, disableRateLimit: true, mailer: async () => {} });
  t.after(() => db.close());
  await request(app)
    .post('/api/auth/password/code')
    .set('Origin', origin)
    .send({ email: 'digest-check@example.test' })
    .expect(200);
  const reset = db.prepare('SELECT email FROM password_reset_codes').all() as { email: string }[];
  assert.equal(reset.length, 1);
  assert.match(reset[0].email, /^[a-f0-9]{64}$/);
  await request(app)
    .post('/api/auth/code')
    .set('Origin', origin)
    .send({ email: 'digest-check2@example.test' })
    .expect(200);
  const reg = db.prepare('SELECT email FROM email_codes').all() as { email: string }[];
  assert.ok(reg.length >= 1 && reg.every(r => /^[a-f0-9]{64}$/.test(r.email)));
});

test('legacy plaintext verification rows are migrated to digests on startup', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ipp-fix-'));
  const dbPath = join(dir, 'club.sqlite');
  const first = createApp({ dbPath, origin, disableRateLimit: true, mailer: async () => {} });
  await request(first.app)
    .post('/api/auth/password/code')
    .set('Origin', origin)
    .send({ email: 'legacy@example.test' })
    .expect(200);
  // Simulate a pre-fix plaintext row.
  first.db.prepare('UPDATE password_reset_codes SET email=?').run('legacy@example.test');
  first.db.close();
  const second = createApp({ dbPath, origin, disableRateLimit: true, mailer: async () => {} });
  t.after(() => {
    second.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const rows = second.db.prepare('SELECT email FROM password_reset_codes').all() as { email: string }[];
  assert.equal(rows.length, 1);
  assert.match(rows[0].email, /^[a-f0-9]{64}$/);
});
