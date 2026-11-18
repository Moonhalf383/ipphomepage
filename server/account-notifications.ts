import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Mailer } from './mail.ts';
import { accountMail, type AccountMail } from './mail-templates.ts';
type Notification = Extract<AccountMail, { kind: 'welcome' | 'password-changed' | 'role-changed' | 'interview-cancelled' | 'interview-updated' }>;
const DAY = 86_400_000;
export function accountNotifications(db: DatabaseSync, mailer: Mailer | undefined, origin: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_notifications (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, nextAt INTEGER NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS account_notifications_pending ON account_notifications(status,nextAt);`);
  // An interrupted SMTP send can have been accepted. Retain it for manual verification.
  db.prepare("UPDATE account_notifications SET status='failed' WHERE status='sending'").run();
  function enqueue(userId: string, event: Notification) {
    db.prepare('INSERT INTO account_notifications(id,userId,event,nextAt,createdAt) VALUES (?,?,?,?,?)')
      .run(randomUUID(), userId, JSON.stringify(event), Date.now(), Date.now());
  }
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  async function deliver() {
    if (!mailer) return;
    {
      db.prepare("DELETE FROM account_notifications WHERE status IN ('sent','failed') AND createdAt<?").run(Date.now() - 30 * DAY);
      for (let i = 0; i < 10 && !stopped; i++) {
        const row = db.prepare("SELECT * FROM account_notifications WHERE status='pending' AND nextAt<=? ORDER BY createdAt,rowid LIMIT 1").get(Date.now());
        if (!row) break;
        const claimed = db.prepare("UPDATE account_notifications SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'").run(row.id);
        if (claimed.changes !== 1) continue;
        let delivered = false;
        try { await mailer(accountMail(JSON.parse(String(row.event)) as Notification, origin)); delivered = true; }
        catch { console.error('Account notification delivery failed', row.id); }
        const attempts = Number(row.attempts) + 1;
        // At most five attempts over 24 hours; other account operations remain independent.
        const expired = Date.now() - Number(row.createdAt) > DAY;
        const status = delivered ? 'sent' : attempts >= 5 || expired ? 'failed' : 'pending';
        db.prepare('UPDATE account_notifications SET status=?,nextAt=? WHERE id=?')
          .run(status, Date.now() + Math.min(60_000 * 2 ** (attempts - 1), HOUR), row.id);
      }
    }
  }
  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    if (stopped || !mailer) return Promise.resolve();
    inFlight = deliver().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  const timer = mailer ? setInterval(() => { void flush().catch(() => console.error('Account notification queue failed')); }, 2000) : undefined;
  timer?.unref();
  return { enqueue, flush, close: async () => { stopped = true; clearInterval(timer); await inFlight; } };
}
const HOUR = 3_600_000;
