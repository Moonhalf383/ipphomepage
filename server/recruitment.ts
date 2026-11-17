import type express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { installAccounts } from './accounts.ts';
import type { InterviewApplication, InterviewSchedule } from '../shared/recruitment.ts';
const slotSchema = z
  .object({ startAt: z.number().int().positive().max(8.64e15), endAt: z.number().int().positive().max(8.64e15) })
  .refine(slot => slot.endAt > slot.startAt, '结束时间必须晚于开始时间');
const scheduleSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(80),
    location: z.string().trim().min(1, '请填写地点').max(160),
    description: z.string().trim().max(2000),
    slots: z.array(slotSchema).min(1, '请添加可选时间').max(20)
  })
  .superRefine((value, context) => {
    const sorted = [...value.slots].sort((a, b) => a.startAt - b.startAt);
    if (sorted.some((slot, index) => index > 0 && slot.startAt < sorted[index - 1].endAt))
      context.addIssue({ code: 'custom', message: '可选时间不能重叠' });
    if (value.slots.some(slot => slot.endAt <= Date.now()))
      context.addIssue({ code: 'custom', message: '请设置尚未结束的时间' });
  });
const applicationSchema = z.object({
  scheduleId: z.string().uuid(),
  slotId: z.string().uuid(),
  name: z.string().trim().min(1, '请填写姓名').max(40),
  contact: z.string().trim().min(1, '请填写联系方式').max(100),
  note: z.string().trim().max(1000)
});
export function installRecruitment(
  app: express.Express,
  db: DatabaseSync,
  accounts: ReturnType<typeof installAccounts>,
  limiter: express.RequestHandler
) {
  db.exec(`CREATE TABLE IF NOT EXISTS interview_schedules (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS interview_applications (
    id TEXT PRIMARY KEY, scheduleId TEXT NOT NULL REFERENCES interview_schedules(id), slotId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, contact TEXT NOT NULL, note TEXT NOT NULL,
    createdAt INTEGER NOT NULL, UNIQUE(scheduleId,userId)
  );
  CREATE INDEX IF NOT EXISTS interview_applications_user ON interview_applications(userId);`);
  const schedules = () =>
    db
      .prepare('SELECT data FROM interview_schedules ORDER BY createdAt DESC,id')
      .all()
      .map(row => JSON.parse(String(row.data)) as InterviewSchedule);
  app.get('/api/join/schedules', (req, res) => {
    const user = accounts.current(req);
    const applications = user
      ? (db
          .prepare('SELECT * FROM interview_applications WHERE userId=?')
          .all(user.id) as unknown as InterviewApplication[])
      : [];
    const now = Date.now();
    res.json(
      schedules().map(schedule => ({
        ...schedule,
        expired: schedule.slots.every(slot => slot.endAt <= now),
        application: applications.find(item => item.scheduleId === schedule.id) ?? null
      }))
    );
  });
  app.post('/api/join/applications', accounts.requireUser, limiter, (req, res) => {
    const input = applicationSchema.parse(req.body);
    const user = accounts.current(req)!;
    const row = db.prepare('SELECT data FROM interview_schedules WHERE id=?').get(input.scheduleId);
    if (!row) {
      res.status(404).json({ error: '安排不存在' });
      return;
    }
    const schedule = JSON.parse(String(row.data)) as InterviewSchedule;
    const slot = schedule.slots.find(item => item.id === input.slotId);
    if (!slot) {
      res.status(400).json({ error: '请选择此安排的可选时间' });
      return;
    }
    if (slot.endAt <= Date.now()) {
      res.status(409).json({ error: '该时间已过期，请选择其他时间' });
      return;
    }
    const application: InterviewApplication = { ...input, userId: user.id, id: randomUUID(), createdAt: Date.now() };
    const inserted = db
      .prepare('INSERT INTO interview_applications VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(scheduleId,userId) DO NOTHING')
      .run(
        application.id,
        schedule.id,
        slot.id,
        user.id,
        application.name,
        application.contact,
        application.note,
        application.createdAt
      );
    if (!inserted.changes) {
      res.status(409).json({ error: '你已填报该安排' });
      return;
    }
    res.status(201).json(application);
  });
  app.get('/api/admin/interviews', accounts.requireAdmin, (_req, res) => {
    res.json({
      schedules: schedules(),
      applications: db
        .prepare(
          `SELECT a.*,u.email,u.displayName FROM interview_applications a JOIN users u ON u.id=a.userId ORDER BY a.createdAt DESC,a.id`
        )
        .all()
    });
  });
  app.post('/api/admin/interviews', accounts.requireAdmin, limiter, (req, res) => {
    const actor = accounts.current(req)!;
    if (actor.role !== 'president') {
      res.status(403).json({ error: '仅社长可发布面试安排' });
      return;
    }
    const input = scheduleSchema.parse(req.body);
    const schedule: InterviewSchedule = {
      ...input,
      id: randomUUID(),
      slots: input.slots.map(slot => ({ ...slot, id: randomUUID() })),
      createdAt: Date.now()
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO interview_schedules VALUES (?,?,?,?)').run(
        schedule.id,
        JSON.stringify(schedule),
        actor.id,
        schedule.createdAt
      );
      db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(
        randomUUID(),
        actor.id,
        'publish-interview',
        schedule.id,
        schedule.createdAt
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(schedule);
  });
}
