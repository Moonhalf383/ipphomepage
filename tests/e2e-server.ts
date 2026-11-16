import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passwordHash } from '../server/accounts.ts';
import { createApp } from '../server/app.ts';
const dir = mkdtempSync(join(tmpdir(), 'ipp-browser-'));
const testMessages: { to: string; text: string; subject: string }[] = [];
const { app, db, accounts } = createApp({
  dbPath: join(dir, 'test.sqlite'),
  adminPassword: 'browser-test-only-password',
  origin: 'http://localhost:5173',
  disableRateLimit: true,
  mailer: async m => { testMessages.push(m); },
  bulkMailer: async () => {},
  allowLegacyAdmin: true
});
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('browser-admin', 'admin@example.com', '测试管理员', await passwordHash('browser-test-only-password'), 'president', Date.now());
app.get('/__test/mail', (_req, res) => res.json(testMessages));
const server = app.listen(3001, '0.0.0.0');
function close() {
  accounts.close();
  server.close(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
