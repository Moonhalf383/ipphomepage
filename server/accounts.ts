import type express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Account, Role } from '../shared/accounts.ts';
import type { Mailer } from './mail.ts';
import { accountMail } from './mail-templates.ts';
import { accountNotifications } from './account-notifications.ts';
const scrypt = promisify(derive);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const HOUR = 3_600_000;
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12, '密码至少需要 12 位').max(128, '密码最多 128 位');
const nameSchema = z.string().trim().min(1).max(24).regex(/^[^\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]+$/u);
type Row = Record<string, any>;
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  const actual = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export function installAccounts(app: express.Express, db: DatabaseSync, options: {
  production: boolean; disableRateLimit?: boolean; mailer?: Mailer; bulkMailer?: Mailer; initialPresidentEmail?: string; origin: string;
}) {
  const legacyUsers = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as Row | undefined;
  if (legacyUsers?.sql.includes("'guest'")) {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE users_roles_next (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, displayName TEXT NOT NULL,
        passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'non_member'
        CHECK(role IN ('non_member','member','admin','president')), createdAt INTEGER NOT NULL
      );
      INSERT INTO users_roles_next SELECT id,email,displayName,passwordHash,
        CASE WHEN role='guest' THEN 'non_member' ELSE role END,createdAt FROM users;
      DROP TABLE users;
      ALTER TABLE users_roles_next RENAME TO users;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Account migration failed foreign-key validation');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys=ON'); }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'non_member'
      CHECK(role IN ('non_member','member','admin','president')), createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_sessions (
      token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_codes (
      email TEXT PRIMARY KEY, codeHash TEXT NOT NULL, expiresAt INTEGER NOT NULL,
      sentAt INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      email TEXT PRIMARY KEY, codeHash TEXT NOT NULL, expiresAt INTEGER NOT NULL,
      sentAt INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, target TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_jobs (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL, text TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_deliveries (
      jobId TEXT NOT NULL REFERENCES mail_jobs(id), userId TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(jobId,userId)
    );
    CREATE INDEX IF NOT EXISTS account_sessions_user ON account_sessions(userId);
    CREATE UNIQUE INDEX IF NOT EXISTS single_president ON users(role) WHERE role='president';
  `);
  // Additive migration preserves all existing assessment records.
  if (!(db.prepare('PRAGMA table_info(attempts)').all() as Row[]).some(c => c.name === 'userId'))
    db.exec('ALTER TABLE attempts ADD COLUMN userId TEXT REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS attempts_user ON attempts(userId,createdAt)');
  // Verification tables key rows by a one-way email digest, never plaintext addresses.
  const emailKey = (email: string) => hash(`email-key:${email}`);
  for (const table of ['email_codes', 'password_reset_codes']) {
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE email LIKE '%@%'`).all() as Row[]) {
      db.prepare(`DELETE FROM ${table} WHERE email=?`).run(row.email);
      db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?,?,?,?,?)`).run(emailKey(row.email), row.codeHash, row.expiresAt, row.sentAt, row.failures);
    }
  }
  const notifications = accountNotifications(db, options.mailer, options.origin);
  const initialPresidentEmail = options.initialPresidentEmail ? emailSchema.parse(options.initialPresidentEmail) : undefined;
  db.prepare('INSERT OR IGNORE INTO account_secrets VALUES (?,?)').run('email-code-hmac', randomBytes(32).toString('hex'));
  const codeSecret = Buffer.from(String(db.prepare('SELECT value FROM account_secrets WHERE name=?').get('email-code-hmac')!.value), 'hex');
  const codeHash = (email: string, code: string) => createHmac('sha256', codeSecret).update(`${email}:${code}`).digest('hex');
  const cookies = { httpOnly: true, sameSite: 'strict' as const, secure: options.production, path: '/' };
  type InternalAccount = Omit<Account, 'role'> & { role: Role | 'president' };
  const publicUser = (u: Row): Account => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role === 'president' ? 'admin' : u.role, createdAt: u.createdAt, canManageAdmins: u.role === 'president' });
  function current(req: express.Request): InternalAccount | null {
    const token = req.cookies.ipp_session;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const user = db.prepare(`SELECT u.* FROM users u JOIN account_sessions s ON s.userId=u.id WHERE s.token=? AND s.expiresAt>?`)
      .get(hash(token), Date.now()) as Row | undefined;
    return user ? { ...publicUser(user), role: user.role } : null;
  }
  const requireUser: express.RequestHandler = (req, res, next) => {
    if (!current(req)) { res.status(401).json({ error: '请先登录' }); return; } next();
  };
  const requireAdmin: express.RequestHandler = (req, res, next) => {
    const user = current(req);
    if (!user) { res.status(401).json({ error: '请先登录管理后台' }); return; }
    if (!['admin', 'president'].includes(user.role)) { res.status(403).json({ error: '仅管理员可访问' }); return; }
    next();
  };
  const limit = (count: number, windowMs = 15 * 60_000) => rateLimit({
    limit: count, windowMs, skip: () => !!options.disableRateLimit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后再试' }
  });
  function accountLimit(key: string, max: number, windowMs: number) {
    const now = Date.now();
    db.prepare('DELETE FROM account_limits WHERE expiresAt<=?').run(now);
    db.prepare(`INSERT INTO account_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, now + windowMs);
    const row = db.prepare('SELECT count FROM account_limits WHERE key=?').get(key) as Row;
    if (!options.disableRateLimit && row.count > max) throw Object.assign(new Error('操作过于频繁，请稍后再试'), { status: 429 });
  }
  function session(res: express.Response, id: string) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM account_sessions WHERE expiresAt<=?').run(Date.now());
    db.prepare('INSERT INTO account_sessions VALUES (?,?,?)').run(hash(token), id, Date.now() + 8 * HOUR);
    res.cookie('ipp_session', token, { ...cookies, maxAge: 8 * HOUR });
  }
  app.get('/api/auth/me', (req, res) => { const user = current(req); res.json({ user: user ? publicUser(user) : null }); });
  app.post('/api/auth/code', limit(5, HOUR), async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    if (!options.mailer) { res.status(503).json({ error: '邮件服务暂不可用，请稍后再试' }); return; }
    accountLimit(`code:${email}`, 5, HOUR);
    const previous = db.prepare('SELECT sentAt FROM email_codes WHERE email=?').get(emailKey(email)) as Row | undefined;
    if (previous && Date.now() - previous.sentAt < 60_000) { res.status(429).json({ error: '请一分钟后再获取验证码' }); return; }
    const generic = { ok: true, message: '如该邮箱可以注册，验证码将发送至邮箱' };
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) { res.json(generic); return; }
    const code = String(randomInt(100000, 1000000));
    const digest = codeHash(email, code);
    db.prepare(`INSERT INTO email_codes VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET codeHash=excluded.codeHash,expiresAt=excluded.expiresAt,sentAt=excluded.sentAt,failures=0`)
      .run(emailKey(email), digest, Date.now() + 10 * 60_000, Date.now());
    try {
      await options.mailer(accountMail({ kind: 'registration-code', to: email, code }, options.origin));
    } catch {
      db.prepare('DELETE FROM email_codes WHERE email=? AND codeHash=?').run(emailKey(email), digest);
      res.status(503).json({ error: '邮件发送失败，请稍后再试' }); return;
    }
    res.json(generic);
  });
  app.post('/api/auth/register', limit(10, HOUR), async (req, res) => {
    const input = z.object({ email: emailSchema, password: passwordSchema, displayName: nameSchema, code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    accountLimit(`register:${input.email}`, 10, HOUR);
    const digest = codeHash(input.email, input.code);
    const validCode = () => {
      const row = db.prepare('SELECT * FROM email_codes WHERE email=?').get(emailKey(input.email)) as Row | undefined;
      return row && row.expiresAt > Date.now() && row.failures < 5 && timingSafeEqual(Buffer.from(digest), Buffer.from(row.codeHash));
    };
    if (!validCode()) {
      db.prepare('UPDATE email_codes SET failures=failures+1 WHERE email=?').run(emailKey(input.email));
      res.status(400).json({ error: '验证码无效或已过期，请重新获取' }); return;
    }
    const encoded = await passwordHash(input.password);
    // Recheck after asynchronous hashing: a code is consumed exactly once, including concurrent requests.
    if (!validCode() || db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) {
      res.status(400).json({ error: '无法完成注册，请检查验证码或直接登录' }); return;
    }
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      const initialPresident = input.email === initialPresidentEmail && !db.prepare("SELECT id FROM users WHERE role='president'").get();
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, input.email, input.displayName, encoded, initialPresident ? 'president' : 'non_member', Date.now());
      if (initialPresident) db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(), id, 'verified:initial-president', id, Date.now());
      db.prepare('DELETE FROM email_codes WHERE email=?').run(emailKey(input.email));
      notifications.enqueue(id, { kind: 'welcome', to: input.email, name: input.displayName, role: initialPresident ? 'admin' : 'non_member' });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    session(res, id);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id) as Row) });
  });
  const resetDigest = (email: string, code: string) => codeHash(`password-reset:${email}`, code);
  let recoveryDeliveries = 0;
  app.post('/api/auth/password/code', limit(5, HOUR), (req, res) => {
    const email = emailSchema.parse(req.body.email);
    if (!options.mailer) { res.status(503).json({ error: '邮件服务暂不可用，请稍后再试' }); return; }
    if (recoveryDeliveries >= 10) { res.status(503).json({ error: '邮件服务繁忙，请稍后再试' }); return; }
    accountLimit(`reset-send:${email}`, 5, HOUR);
    const now = Date.now();
    const previous = db.prepare('SELECT * FROM password_reset_codes WHERE email=?').get(emailKey(email)) as Row | undefined;
    if (previous && now - previous.sentAt < 60_000) { res.status(429).json({ error: '请一分钟后再获取验证码' }); return; }
    const generic = { ok: true, message: '如果该邮箱已注册，你将收到重设密码验证码' };
    const code = String(randomInt(100000, 1000000));
    const digest = resetDigest(email, code);
    db.prepare(`INSERT INTO password_reset_codes VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET codeHash=excluded.codeHash,expiresAt=excluded.expiresAt,sentAt=excluded.sentAt,failures=0`)
      .run(emailKey(email), digest, now + 10 * 60_000, now);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
      recoveryDeliveries++;
      // SMTP work runs independently of the HTTP response for both known and unknown addresses.
      void Promise.resolve().then(() => options.mailer!(accountMail({ kind: 'password-code', to: email, code }, options.origin)))
        .catch(() => console.error('Password recovery email delivery failed'))
        .finally(() => { recoveryDeliveries--; });
    }
    res.json(generic);
  });
  app.post('/api/auth/password/reset', limit(10, HOUR), async (req, res) => {
    const input = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/), password: passwordSchema }).parse(req.body);
    accountLimit(`reset-verify:${input.email}`, 10, HOUR);
    const digest = resetDigest(input.email, input.code);
    const validCode = () => {
      const row = db.prepare('SELECT * FROM password_reset_codes WHERE email=?').get(emailKey(input.email)) as Row | undefined;
      return row && row.expiresAt > Date.now() && row.failures < 5 && timingSafeEqual(Buffer.from(digest), Buffer.from(row.codeHash));
    };
    if (!validCode()) {
      db.prepare('UPDATE password_reset_codes SET failures=failures+1 WHERE email=?').run(emailKey(input.email));
      res.status(400).json({ error: '验证码无效或已过期，请重新获取' }); return;
    }
    const encoded = await passwordHash(input.password);
    db.exec('BEGIN IMMEDIATE');
    try {
      const user = db.prepare('SELECT id,displayName FROM users WHERE email=?').get(input.email) as Row | undefined;
      if (!validCode() || !user) {
        db.exec('ROLLBACK'); res.status(400).json({ error: '验证码无效或已过期，请重新获取' }); return;
      }
      const consumed = db.prepare('DELETE FROM password_reset_codes WHERE email=? AND codeHash=? AND expiresAt>? AND failures<5').run(emailKey(input.email), digest, Date.now());
      if (consumed.changes !== 1) throw new Error('Password reset code consumption failed');
      db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(encoded, user.id);
      db.prepare('DELETE FROM account_sessions WHERE userId=?').run(user.id);
      const at = Date.now();
      db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(), user.id, 'reset-password', user.id, at);
      notifications.enqueue(user.id, { kind: 'password-changed', to: input.email, name: user.displayName, at });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.clearCookie('ipp_session', cookies).json({ ok: true });
  });
  // A fixed dummy hash prevents unregistered email addresses from taking a fast password-check path.
  const dummy = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
  app.post('/api/auth/login', limit(10), async (req, res) => {
    const input = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(req.body);
    accountLimit(`login:${input.email}`, 10, 15 * 60_000);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as Row | undefined;
    const matches = await passwordMatches(input.password, user?.passwordHash ?? dummy);
    if (!user || !matches) { res.status(401).json({ error: '邮箱或密码不正确' }); return; }
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as Row | undefined;
      if (!fresh || fresh.passwordHash !== user.passwordHash) {
        db.exec('ROLLBACK'); res.status(401).json({ error: '密码已更新，请重新登录' }); return;
      }
      if (typeof req.cookies.ipp_session === 'string') db.prepare('DELETE FROM account_sessions WHERE token=?').run(hash(req.cookies.ipp_session));
      session(res, fresh.id);
      db.exec('COMMIT');
      res.json({ user: publicUser(fresh) });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  app.post('/api/auth/logout', (req, res) => {
    if (typeof req.cookies.ipp_session === 'string') db.prepare('DELETE FROM account_sessions WHERE token=?').run(hash(req.cookies.ipp_session));
    res.clearCookie('ipp_session', cookies).json({ ok: true });
  });
  app.get('/api/auth/attempts', requireUser, (req, res) => {
    res.json(db.prepare('SELECT id,displayName,demo,createdAt,result FROM attempts WHERE userId=? ORDER BY createdAt DESC LIMIT 100')
      .all(current(req)!.id).map(r => ({ ...r, demo: !!r.demo, result: r.result ? JSON.parse(String(r.result)) : null })));
  });
  const audit = (actor: string, action: string, target: string) => db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(), actor, action, target, Date.now());
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const input = z.object({ page: z.coerce.number().int().min(1).default(1), query: z.string().max(100).default(''), role: z.enum(['non_member','member','admin','all']).default('all') }).parse(req.query);
    const where = `(?='all' OR u.role=? OR (?='admin' AND u.role='president')) AND (instr(lower(u.email),lower(?))>0 OR instr(lower(u.displayName),lower(?))>0)`;
    const params = [input.role, input.role, input.role, input.query, input.query];
    const actor = current(req)!;
    const users = db.prepare(`SELECT u.*, (SELECT count(*) FROM attempts a WHERE a.userId=u.id) AS attempts,
      (SELECT json_extract(a.result,'$.score') FROM attempts a WHERE a.userId=u.id AND a.result IS NOT NULL ORDER BY a.createdAt DESC LIMIT 1) AS latestScore
      FROM users u WHERE ${where} ORDER BY u.createdAt DESC,u.id LIMIT 50 OFFSET ?`).all(...params, (input.page - 1) * 50) as Row[];
    res.json({ users: users.map(u => ({ ...publicUser(u), attempts: u.attempts, latestScore: u.latestScore,
      editableRoles: u.id === actor.id || u.role === 'president' || (actor.role !== 'president' && u.role === 'admin') ? [] : actor.role === 'president' ? ['non_member','member','admin'] : ['non_member','member'] })), total: (db.prepare(`SELECT count(*) n FROM users u WHERE ${where}`).get(...params) as Row).n });
  });
  app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    const actor = current(req)!;
    const role = z.enum(['non_member','member','admin']).parse(req.body.role);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(String(req.params.id)) as Row | undefined;
    if (!user) { res.status(404).json({ error: '用户不存在' }); return; }
    if (user.id === actor.id || user.role === 'president' || (actor.role !== 'president' && (user.role === 'admin' || role === 'admin'))) {
      res.status(403).json({ error: '无权更改此身份' }); return;
    }
    if (role === user.role) { res.json({ ok: true }); return; }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET role=? WHERE id=?').run(role, user.id);
      db.prepare('DELETE FROM account_sessions WHERE userId=?').run(user.id);
      audit(actor.id, 'set-role', `${user.id}:${role}`);
      notifications.enqueue(user.id, { kind: 'role-changed', to: user.email, name: user.displayName, previous: publicUser(user).role, role, at: Date.now() });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  });
  app.get('/api/admin/mail/config', requireAdmin, (_req, res) => res.json({ available: !!options.bulkMailer }));
  app.post('/api/admin/mail', requireAdmin, limit(10, HOUR), (req, res) => {
    if (!options.bulkMailer) { res.status(503).json({ error: '公告邮件尚未开放' }); return; }
    const input = z.object({ subject: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/), text: z.string().trim().min(1).max(20000),
      roles: z.array(z.enum(['non_member','member','admin'])).max(3).default([]), userIds: z.array(z.string().uuid()).max(500).default([]), confirm: z.literal(true) }).parse(req.body);
    const recipients = (db.prepare('SELECT id,email,role FROM users').all() as Row[]).filter(u => input.roles.includes(u.role === 'president' ? 'admin' : u.role as Role) || input.userIds.includes(u.id));
    if (!recipients.length) { res.status(400).json({ error: '请选择收件人' }); return; }
    const actor = current(req)!;
    accountLimit(`mail:${actor.id}`, 10, HOUR);
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO mail_jobs VALUES (?,?,?,?,?)').run(id, actor.id, input.subject, input.text, Date.now());
      const insert = db.prepare('INSERT INTO mail_deliveries(jobId,userId,email) VALUES (?,?,?)');
      recipients.forEach(u => insert.run(id, u.id, u.email));
      audit(actor.id, 'send-mail', `${id}:${recipients.length}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.status(202).json({ id, recipients: recipients.length });
  });
  app.get('/api/admin/mail', requireAdmin, (_req, res) => res.json(db.prepare(`SELECT j.id,j.subject,j.createdAt,
    count(*) total, sum(d.status='sent') sent, sum(d.status='failed') failed, sum(d.status IN ('pending','sending')) pending
    FROM mail_jobs j JOIN mail_deliveries d ON d.jobId=j.id GROUP BY j.id ORDER BY j.createdAt DESC LIMIT 50`).all()));
  let running = false;
  let stopped = false;
  // Ambiguous deliveries after a crash are not automatically resent (avoid duplicate messages).
  db.prepare("UPDATE mail_deliveries SET status='failed' WHERE status='sending'").run();
  async function flushMail() {
    if (running || stopped || !options.bulkMailer) return;
    running = true;
    try {
      for (let n = 0; n < 20 && !stopped; n++) {
        const row = db.prepare(`SELECT d.*,j.subject,j.text FROM mail_deliveries d JOIN mail_jobs j ON j.id=d.jobId WHERE d.status='pending' ORDER BY j.createdAt LIMIT 1`).get() as Row | undefined;
        if (!row) break;
        db.prepare("UPDATE mail_deliveries SET status='sending' WHERE jobId=? AND userId=?").run(row.jobId, row.userId);
        let status = 'sent';
        try { await options.bulkMailer({ to: row.email, subject: row.subject, text: row.text }); } catch { status = 'failed'; }
        if (!stopped) db.prepare('UPDATE mail_deliveries SET status=? WHERE jobId=? AND userId=?').run(status, row.jobId, row.userId);
      }
    } finally { running = false; }
  }
  const timer = options.bulkMailer ? setInterval(() => { void flushMail().catch(() => console.error('Mail queue processing failed')); }, 3000) : undefined;
  timer?.unref();
  return { current, publicUser, requireAdmin, requireUser, notify: notifications.enqueue, flushMail, flushNotifications: notifications.flush, close: async () => { stopped = true; clearInterval(timer); await notifications.close(); } };
}
