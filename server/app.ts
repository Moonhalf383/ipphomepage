import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { seedQuestions } from './seed.ts';
import { answersSchema, drawQuestions, grade, questionSchema, validateAnswers } from './domain.ts';
import { certificatePng } from './certificate.ts';
import { normalizeOrigin, trustedOrigins } from './origin.ts';
import type { Answers, Question, Result, Settings } from '../shared/types.ts';
import { installAccounts } from './accounts.ts';
import { installRecruitment } from './recruitment.ts';
import { smtpMailer, type Mailer } from './mail.ts';

type Row = Record<string, any>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const HOUR = 3600_000;
export function createApp(
  options: {
    dbPath?: string;
    adminPassword?: string;
    origin?: string;
    production?: boolean;
    developmentOrigins?: string[];
    disableRateLimit?: boolean;
    mailer?: Mailer;
    bulkMailer?: Mailer;
    initialPresidentEmail?: string;
    allowLegacyAdmin?: boolean;
    requireAccount?: boolean;
  } = {}
) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = normalizeOrigin(options.origin ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173');
  const allowedOrigins = trustedOrigins(origin, production, options.developmentOrigins);
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';
  if (production && !origin.startsWith('https://'))
    throw new Error('生产环境需要 HTTPS PUBLIC_ORIGIN');
  const allowLegacyAdmin = !production && (options.allowLegacyAdmin ?? false);
  const requireAccount = options.requireAccount ?? true;
  const dbPath = options.dbPath ?? process.env.DATABASE_PATH ?? './data/club.sqlite';
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, questions TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL, displayName TEXT NOT NULL, demo INTEGER NOT NULL, createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL, result TEXT
    );
    CREATE TABLE IF NOT EXISTS certificates (id TEXT PRIMARY KEY, attemptId TEXT UNIQUE NOT NULL REFERENCES attempts(id), revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);
  `);
  if (!db.prepare('SELECT id FROM settings WHERE id=1').get()) {
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO settings VALUES (1, ?)').run(
        JSON.stringify({ enabled: false, questionCount: 8, passScore: 80, version: 1 })
      );
      const insert = db.prepare('INSERT INTO questions VALUES (?, ?)');
      seedQuestions.forEach(q => insert.run(q.id, JSON.stringify(q)));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const settings = (): Settings => JSON.parse((db.prepare('SELECT data FROM settings WHERE id=1').get() as Row).data);
  const questions = (): Question[] =>
    (db.prepare('SELECT data FROM questions ORDER BY id').all() as Row[]).map(q => JSON.parse(q.data));
  const saveSettings = (s: Settings) => db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(s));
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      strictTransportSecurity: production ? undefined : false,
      contentSecurityPolicy: production
        ? {
            directives: {
              'script-src': ["'self'"],
              'style-src': ["'self'", "'unsafe-inline'"],
              'img-src': ["'self'", 'data:'],
              'font-src': ["'self'"],
              'connect-src': ["'self'"],
              'object-src': ["'none'"],
              'frame-ancestors': ["'none'"]
            }
          }
        : false
    })
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowedOrigins.has(req.get('origin') ?? '')) {
      res
        .status(403)
        .json({
          code: 'UNTRUSTED_ORIGIN',
          error: production
            ? '页面来源与站点配置不一致，请通过正式站点地址访问；若仍出现此提示，请联系管理员。'
            : '当前页面地址未获开发服务器信任。请使用 PUBLIC_ORIGIN 配置的地址，或将实际协议、主机和端口加入 dev.local.json 的 allowedOrigins 后重启服务。'
        });
      return;
    }
    next();
  });
  const limiter = (limit: number, windowMs = 15 * 60_000) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => !!options.disableRateLimit,
      message: { error: '操作过于频繁，请稍后再试' }
    });
  app.use('/api', limiter(300));
  const cookies = { httpOnly: true, sameSite: 'strict' as const, secure: production, path: '/' };
  const accounts = installAccounts(app, db, {
    production, origin, disableRateLimit: options.disableRateLimit,
    mailer: options.mailer ?? smtpMailer(), bulkMailer: options.bulkMailer ?? smtpMailer('BULK_'),
    initialPresidentEmail: options.initialPresidentEmail ?? process.env.INITIAL_PRESIDENT_EMAIL
  });
  installRecruitment(app, db, accounts, limiter(30, HOUR));
  const admin: express.RequestHandler = (req, res, next) => {
    if (!allowLegacyAdmin || accounts.current(req)) return accounts.requireAdmin(req, res, next);
    const token = req.cookies.ipp_admin;
    const session =
      typeof token === 'string' &&
      (db.prepare('SELECT expiresAt FROM sessions WHERE token=?').get(hash(token)) as Row | undefined);
    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: '请先登录管理后台' });
      return;
    }
    next();
  };
  function ownAttempt(req: express.Request): Row {
    const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(String(req.params.id)) as Row | undefined;
    const owns = row && (row.userId
      ? accounts.current(req)?.id === row.userId
      : typeof req.cookies.ipp_guest === 'string' && row.owner === hash(req.cookies.ipp_guest));
    if (!owns) {
      throw Object.assign(new Error('答题记录不存在或当前浏览器无权访问'), { status: 404 });
    }
    return row;
  }
  function publicAttempt(row: Row) {
    return {
      id: row.id,
      questions: (JSON.parse(row.questions) as Question[]).map(({ correct, explanation, active, ...q }) => q),
      answers: JSON.parse(row.answers),
      demo: !!row.demo,
      passScore: JSON.parse(row.settings).passScore,
      expiresAt: row.expiresAt,
      result: row.result ? JSON.parse(row.result) : null
    };
  }
  function assertOpen(row: Row) {
    if (row.expiresAt < Date.now()) throw Object.assign(new Error('本次问卷已过期，请重新开始'), { status: 410 });
    if (!row.demo && !settings().enabled)
      throw Object.assign(new Error('管理员已暂停正式审核，请稍后重试'), { status: 409 });
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => {
    const s = settings();
    const pool = questions().filter(q => q.active);
    res.json({ ...s, available: pool.length >= s.questionCount && pool.some(q => q.points > 0) });
  });
  app.post('/api/attempts', limiter(12, HOUR), (req, res) => {
    const input = z
      .object({
        displayName: z
          .string()
          .trim()
          .min(1)
          .max(24)
          .regex(/^[^\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]+$/u),
        consent: z.literal(true)
      })
      .parse(req.body);
    const s = settings();
    const user = accounts.current(req);
    if (s.enabled && requireAccount && !user) {
      res.status(401).json({ error: '请先登录，再开始正式问卷' }); return;
    }
    const selected = drawQuestions(questions(), s.questionCount);
    let token = req.cookies.ipp_guest;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) token = randomBytes(32).toString('hex');
    res.cookie('ipp_guest', token, { ...cookies, maxAge: 24 * HOUR });
    const now = Date.now(),
      id = randomUUID();
    const owner = user ? `user:${user.id}` : hash(token);
    // At most one unfinished attempt per account or anonymous browser.
    const existing = db
      .prepare(
        'SELECT * FROM attempts WHERE owner=? AND result IS NULL AND expiresAt>? ORDER BY createdAt DESC LIMIT 1'
      )
      .get(owner, now) as Row | undefined;
    if (existing) {
      res.json(publicAttempt(existing));
      return;
    }
    db.prepare(
      'INSERT INTO attempts (id,owner,questions,settings,displayName,demo,createdAt,expiresAt,userId) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(
      id,
      owner,
      JSON.stringify(selected),
      JSON.stringify(s),
      input.displayName,
      s.enabled ? 0 : 1,
      now,
      now + HOUR,
      user?.id ?? null
    );
    res.status(201).json(publicAttempt(db.prepare('SELECT * FROM attempts WHERE id=?').get(id) as Row));
  });
  app.get('/api/attempts/:id', (req, res) => res.json(publicAttempt(ownAttempt(req))));
  app.put('/api/attempts/:id/draft', (req, res) => {
    const row = ownAttempt(req);
    if (row.result) {
      res.status(409).json({ error: '已提交的答案不可修改' });
      return;
    }
    assertOpen(row);
    const answers = answersSchema.parse(req.body.answers);
    validateAnswers(JSON.parse(row.questions), answers, false);
    db.prepare('UPDATE attempts SET answers=? WHERE id=?').run(JSON.stringify(answers), row.id);
    res.json({ ok: true });
  });
  app.post('/api/attempts/:id/submit', (req, res) => {
    const row = ownAttempt(req);
    if (row.result) {
      res.json(JSON.parse(row.result));
      return;
    } // Idempotent issuance.
    assertOpen(row);
    const answers: Answers = answersSchema.parse(req.body.answers);
    const score = grade(JSON.parse(row.questions), answers);
    const snapshot: Settings = JSON.parse(row.settings);
    const passed = score.earned * 100 >= snapshot.passScore * score.total;
    const certificateId = passed && !row.demo ? randomUUID() : null;
    const result: Result = {
      ...score,
      passed,
      certificateId,
      displayName: row.displayName,
      demo: !!row.demo,
      issuedAt: new Date().toISOString(),
      version: snapshot.version,
      passScore: snapshot.passScore
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE attempts SET answers=?,result=? WHERE id=?').run(
        JSON.stringify(answers),
        JSON.stringify(result),
        row.id
      );
      if (certificateId) db.prepare('INSERT INTO certificates (id,attemptId) VALUES (?,?)').run(certificateId, row.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json(result);
  });
  app.get('/api/attempts/:id/certificate.png', limiter(30), async (req, res) => {
    const row = ownAttempt(req);
    const result: Result | null = row.result && JSON.parse(row.result);
    if (!result?.passed) {
      res.status(403).json({ error: '仅通过问卷后可下载' });
      return;
    }
    if (
      result.certificateId &&
      (db.prepare('SELECT revoked FROM certificates WHERE id=?').get(result.certificateId) as Row)?.revoked
    ) {
      res.status(410).json({ error: '该证书已撤销，不可下载' });
      return;
    }
    const image = await certificatePng(result, origin);
    res
      .type('png')
      .attachment(`IPlusPlus-${result.demo ? 'DEMO' : result.certificateId}.png`)
      .send(image);
  });
  app.get('/api/certificates/:id', (req, res) => {
    const row = db
      .prepare('SELECT c.id,c.revoked,a.result FROM certificates c JOIN attempts a ON a.id=c.attemptId WHERE c.id=?')
      .get(String(req.params.id)) as Row | undefined;
    if (!row) {
      res.status(404).json({ error: '未找到该证书，请核对完整编号' });
      return;
    }
    const r: Result = JSON.parse(row.result);
    res.json({
      id: row.id,
      revoked: !!row.revoked,
      displayName: r.displayName,
      score: r.score,
      issuedAt: r.issuedAt,
      version: r.version
    });
  });
  app.post('/api/admin/login', limiter(5), (req, res) => {
    if (!allowLegacyAdmin) { res.status(410).json({ error: '请使用邮箱账号登录' }); return; }
    const { password } = z.object({ password: z.string().max(512) }).parse(req.body);
    if (!adminPassword) {
      res.status(503).json({ error: '管理员尚未配置，请在服务器设置 ADMIN_PASSWORD' });
      return;
    }
    if (!timingSafeEqual(Buffer.from(hash(password)), Buffer.from(hash(adminPassword)))) {
      res.status(401).json({ error: '管理密码不正确' });
      return;
    }
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(token), Date.now() + 8 * HOUR);
    res.cookie('ipp_admin', token, { ...cookies, maxAge: 8 * HOUR }).json({ ok: true });
  });
  app.post('/api/admin/logout', admin, (req, res) => {
    if (typeof req.cookies.ipp_session === 'string') db.prepare('DELETE FROM account_sessions WHERE token=?').run(hash(req.cookies.ipp_session));
    if (typeof req.cookies.ipp_admin === 'string') db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.cookies.ipp_admin));
    res.clearCookie('ipp_session', cookies);
    res.clearCookie('ipp_admin', cookies).json({ ok: true });
  });
  app.get('/api/admin', admin, (req, res) => {
    const attempts = (
      db
        .prepare('SELECT a.id,a.displayName,a.demo,a.createdAt,a.result,a.userId,u.email FROM attempts a LEFT JOIN users u ON u.id=a.userId ORDER BY a.createdAt DESC LIMIT 100')
        .all() as Row[]
    ).map(r => ({ ...r, demo: !!r.demo, result: r.result ? JSON.parse(r.result) : null }));
    const certs = db.prepare('SELECT id,revoked FROM certificates ORDER BY rowid DESC LIMIT 100').all();
    res.json({ settings: settings(), questions: questions(), attempts, certificates: certs, user: accounts.current(req) ? accounts.publicUser(accounts.current(req)!) : null });
  });
  app.get('/api/admin/attempts/:id', admin, (req, res) => {
    const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(String(req.params.id)) as Row | undefined;
    if (!row) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    res.json({ ...publicAttempt(row), displayName: row.displayName });
  });
  app.put('/api/admin/settings', admin, (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        questionCount: z.number().int().min(1).max(30),
        passScore: z.number().int().min(1).max(100),
        reviewed: z.boolean().optional()
      })
      .parse(req.body);
    const old = settings();
    if (input.enabled && !old.enabled && !input.reviewed) {
      res.status(400).json({ error: '请先确认题库已经社团审核' });
      return;
    }
    drawQuestions(questions(), input.questionCount);
    const next = {
      enabled: input.enabled,
      questionCount: input.questionCount,
      passScore: input.passScore,
      version: old.version + 1
    };
    saveSettings(next);
    res.json(next);
  });
  const updateQuestion: express.RequestHandler = (req, res) => {
    const parsed = questionSchema.parse(req.body);
    const id = req.method === 'POST' ? randomUUID() : String(req.params.id);
    if (req.method !== 'POST' && !db.prepare('SELECT id FROM questions WHERE id=?').get(id)) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }
    const next = { ...parsed, id };
    const pool = questions()
      .filter(q => q.id !== id)
      .concat(next);
    const s = settings();
    if (s.enabled) drawQuestions(pool, s.questionCount);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO questions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(
        id,
        JSON.stringify(next)
      );
      saveSettings({ ...s, version: s.version + 1 });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json(next);
  };
  app.post('/api/admin/questions', admin, updateQuestion);
  app.put('/api/admin/questions/:id', admin, updateQuestion);
  app.delete('/api/admin/questions/:id', admin, (req, res) => {
    const pool = questions().filter(q => q.id !== req.params.id);
    const s = settings();
    if (s.enabled) drawQuestions(pool, s.questionCount);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM questions WHERE id=?').run(String(req.params.id));
      saveSettings({ ...s, version: s.version + 1 });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });
  app.post('/api/admin/certificates/:id/revoke', admin, (req, res) => {
    const changed = db.prepare('UPDATE certificates SET revoked=1 WHERE id=?').run(String(req.params.id));
    if (!changed.changes) {
      res.status(404).json({ error: '证书不存在' });
      return;
    }
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  if (production) {
    app.use(express.static(resolve('dist'), { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  const onError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map(i => i.message).join('；') });
      return;
    }
    if (error.status && error.status < 500) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof Error && /题目|计分|答案|选项|量表|简答|问卷/.test(error.message)) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: '服务暂时不可用，请稍后重试' });
  };
  app.use(onError);
  return { app, db, accounts };
}
