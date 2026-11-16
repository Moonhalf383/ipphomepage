import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { accountNotifications } from '../server/account-notifications.ts';
// Run only on the server as the service account; passwords are never accepted on the command line.
const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('用法：npx tsx scripts/set-president.ts 已验证的注册邮箱');
const db = new DatabaseSync(process.env.DATABASE_PATH ?? './data/club.sqlite');
const notices = accountNotifications(db, undefined, process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173');
try {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  const user = db.prepare('SELECT id,displayName,role FROM users WHERE email=?').get(email);
  if (!user) throw new Error('该邮箱尚未完成注册');
  const existing = db.prepare("SELECT id FROM users WHERE role='president'").get();
  if (existing && existing.id !== user.id) throw new Error('已有指定账号，请先确认账号迁移安排');
  db.prepare("UPDATE users SET role='president' WHERE id=?").run(user.id);
  db.prepare('DELETE FROM account_sessions WHERE userId=?').run(user.id);
  db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(), user.id, 'server:set-president', String(user.id), Date.now());
  if (user.role !== 'president' && user.role !== 'admin') notices.enqueue(String(user.id), {
    kind: 'role-changed', to: email, name: String(user.displayName), previous: user.role === 'member' ? 'member' : 'non_member', role: 'admin', at: Date.now()
  });
  db.exec('COMMIT');
  console.log('社长身份已设置，请重新登录。');
} catch (e) { db.exec('ROLLBACK'); throw e; } finally { await notices.close(); db.close(); }
