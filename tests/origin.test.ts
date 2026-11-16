import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { loadDevelopmentOrigins, normalizeOrigin } from '../server/origin.ts';

const lan = 'http://10.208.77.171:5173';
test('LAN origin rejection is reproducible; explicit dev origin permits only exact trusted sources', async () => {
  const primary = 'http://localhost:5173';
  for (const allowed of [[], [lan]]) {
    const { app, db } = createApp({
      dbPath: ':memory:',
      production: false,
      origin: primary,
      developmentOrigins: allowed,
      disableRateLimit: true
    });
    try {
      const res = await request(app)
        .post('/api/attempts')
        .set('Origin', lan)
        .send({ displayName: '来源测试', consent: true });
      assert.equal(res.status, allowed.length ? 201 : 403);
      if (!allowed.length) assert.equal(res.body.code, 'UNTRUSTED_ORIGIN');
      await request(app)
        .post('/api/attempts')
        .set('Origin', primary)
        .send({ displayName: '来源测试', consent: true })
        .expect(201);
      for (const hostile of [
        lan + '.evil.test',
        'http://10.208.77.172:5173',
        'http://10.208.77.171:5174',
        'https://10.208.77.171:5173',
        'null',
        lan + '/',
        lan + ', ' + primary
      ]) {
        await request(app)
          .post('/api/attempts')
          .set('Origin', hostile)
          .set('Host', '10.208.77.171:5173')
          .set('X-Forwarded-Host', 'localhost:5173')
          .send({})
          .expect(403);
      }
      await request(app).post('/api/attempts').send({}).expect(403);
    } finally {
      db.close();
    }
  }
});
test('production ignores all dev exceptions and keeps exact CSRF/admin checks', async () => {
  const { app, db } = createApp({
    dbPath: ':memory:',
    production: true,
    origin: 'https://iplusplus.club/',
    adminPassword: 'test-only-secure-password',
    developmentOrigins: [lan, 'https://evil.test'],
    disableRateLimit: true
  });
  try {
    for (const origin of [lan, 'https://evil.test', 'https://iplusplus.club.evil.test']) {
      await request(app)
        .post('/api/admin/login')
        .set('Origin', origin)
        .send({ password: 'test-only-secure-password' })
        .expect(403);
    }
    await request(app)
      .post('/api/admin/login')
      .set('Origin', 'https://iplusplus.club')
      .send({ password: 'wrong' })
      .expect(410);
  } finally {
    db.close();
  }
});
test('local dev configuration is explicit, validated, and never read in production', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipp-origins-'));
  try {
    assert.deepEqual(loadDevelopmentOrigins(false, root), []);
    writeFileSync(join(root, 'dev.local.json'), JSON.stringify({ allowedOrigins: [lan + '/'] }));
    assert.deepEqual(loadDevelopmentOrigins(false, root), [lan]);
    writeFileSync(join(root, 'dev.local.json'), '{broken');
    assert.deepEqual(loadDevelopmentOrigins(true, root), []);
    assert.throws(() => loadDevelopmentOrigins(false, root));
    for (const invalid of [
      '*',
      'http://*.test',
      'https://user:password@example.com',
      'https://example.com/path',
      'https://example.com/?x=1',
      'file:///tmp/x',
      'null'
    ])
      assert.throws(() => normalizeOrigin(invalid));
    assert.equal(normalizeOrigin('https://EXAMPLE.COM:443/'), 'https://example.com');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
