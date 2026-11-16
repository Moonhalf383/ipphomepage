import nodemailer from 'nodemailer';
export type Mail = { to: string; subject: string; text: string; html?: string };
export type Mailer = (mail: Mail) => Promise<void>;
export function smtpMailer(prefix = ''): Mailer | undefined {
  const SMTP_HOST = process.env[`${prefix}SMTP_HOST`];
  const SMTP_PORT = process.env[`${prefix}SMTP_PORT`] ?? '465';
  const SMTP_USER = process.env[`${prefix}SMTP_USER`];
  const SMTP_PASSWORD = process.env[`${prefix}SMTP_PASSWORD`];
  const MAIL_FROM = process.env[`${prefix}MAIL_FROM`];
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !MAIL_FROM) return undefined;
  if (!['465', '587', '80', '25'].includes(SMTP_PORT)) throw new Error('Invalid SMTP port');
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: SMTP_PORT === '465',
    requireTLS: SMTP_PORT !== '465', auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' }, disableFileAccess: true, disableUrlAccess: true
  });
  return async mail => { await transport.sendMail({ from: MAIL_FROM, ...mail }); };
}
