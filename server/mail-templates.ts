import { roleLabels, type Role } from '../shared/accounts.ts';
import type { Mail } from './mail.ts';
export type AccountMail =
  | { kind: 'registration-code' | 'password-code'; to: string; code: string }
  | { kind: 'welcome'; to: string; name: string; role: Role }
  | { kind: 'password-changed'; to: string; name: string; at: number }
  | { kind: 'role-changed'; to: string; name: string; previous: Role; role: Role; at: number }
  | { kind: 'interview-cancelled'; to: string; name: string; title: string; location: string; at: number }
  | { kind: 'interview-updated'; to: string; name: string; title: string; location: string; at: number };
type Copy = { subject: string; title: string; paragraphs: string[]; code?: string; details?: [string, string][]; action?: { label: string; path: string }; note?: string; warning?: string };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const time = (at: number) => `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at)}（北京时间 UTC+08:00）`;
const roleCopy: Record<Role, string> = {
  non_member: '你仍可以参与问卷，并查看自己的答题记录。',
  member: '欢迎以社员的身份继续参与 I++ Club，一起留下更多作品和故事。',
  admin: '你现在可以进入控制台，管理用户、问卷与社区通知。谢谢你一起照料这里。'
};
function copyFor(event: AccountMail): Copy {
  switch (event.kind) {
    case 'registration-code': return {
      subject: '【I++ Club】注册验证码', title: '新的相遇，就差一步啦。',
      paragraphs: ['欢迎来到 I++ Club，先确认一下你的邮箱喵。'], code: event.code,
      note: '验证码 10 分钟内有效，请回到注册页面填写。', warning: '如果你没有申请注册，忽略这封邮件即可。'
    };
    case 'password-code': return {
      subject: '【I++ Club】重设密码验证码', title: '来，换一把新钥匙。',
      paragraphs: ['我们收到了这个邮箱的重设密码申请。'], code: event.code,
      note: '验证码 10 分钟内有效，请在重设密码页面填写，并设置新密码。',
      warning: '请把验证码留给自己。若非本人申请，忽略此邮件即可，你的密码仍保持不变。'
    };
    case 'welcome': return {
      subject: `【I++ Club】账号已准备好，欢迎 ${event.name}`, title: `欢迎，${event.name}！✨`,
      paragraphs: ['你的账号已经准备好了，第一枚爪印也留下啦。'],
      details: [['注册邮箱', event.to], ['当前身份', roleLabels[event.role]]],
      note: '可以先从社区规则问卷开始，认识我们共同维护的小小约定。',
      action: { label: '前往问卷', path: '/assessment' }, warning: '带上好奇心，一起探索喵。'
    };
    case 'password-changed': return {
      subject: '【I++ Club】你的密码已更新', title: '新钥匙已经换好啦。',
      paragraphs: [`${event.name}，你的账号密码已修改成功。`],
      details: [['账号邮箱', event.to], ['修改时间', time(event.at)]],
      note: '原有登录已退出，下次请使用新密码登录喵。', action: { label: '前往登录', path: '/account' },
      warning: '如果这次修改不是你操作的，请立即通过官网重设密码。'
    };
    case 'interview-cancelled': return {
      subject: '【I++ Club】面试安排已取消', title: '面试安排有变动。',
      paragraphs: [`${event.name}，你填报的面试安排已被取消，本次填报不再生效，无需到场。`],
      details: [['面试安排', event.title], ['原定地点', event.location], ['取消时间', time(event.at)]],
      note: '新的安排发布后可以重新填报，留意加入页面喵。', action: { label: '查看面试安排', path: '/join' },
      warning: '对这次取消有疑问，可以联系社团管理员。'
    };
    case 'interview-updated': return {
      subject: '【I++ Club】面试安排信息已更新', title: '面试安排更新啦。',
      paragraphs: [`${event.name}，你填报的面试安排信息有更新，你已选的时间保持不变。`],
      details: [['面试安排', event.title], ['地点', event.location], ['更新时间', time(event.at)]],
      note: '请以最新信息为准，按时到场喵。', action: { label: '查看面试安排', path: '/join' },
      warning: '对更新内容有疑问，可以联系社团管理员。'
    };
    case 'role-changed': return {
      subject: '【I++ Club】你的账号身份已更新', title: '你的社区名牌更新啦。',
      paragraphs: [`${event.name}，管理员已调整你的账号身份。`],
      details: [['原身份', roleLabels[event.previous]], ['新身份', roleLabels[event.role]], ['更新时间', time(event.at)]],
      note: `${roleCopy[event.role]}\n请重新登录，让新的身份生效喵。`, action: { label: '查看我的账号', path: '/account' },
      warning: '对这次调整有疑问，可以联系社团管理员。'
    };
  }
}
export function accountMail(event: AccountMail, publicOrigin: string): Mail {
  const origin = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid mail origin');
  const home = origin.origin;
  const copy = copyFor(event);
  const url = copy.action ? new URL(copy.action.path, home).href : undefined;
  const text = [copy.title, ...copy.paragraphs, copy.code, copy.details?.map(([label, value]) => `${label}：${value}`).join('\n'), copy.note,
    copy.action && `${copy.action.label}：${url}`, copy.warning, `I++ Club · ${home}`].filter(Boolean).join('\n\n');
  const paragraph = (text: string) => `<p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#49454f;">${escape(text).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#faf8ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#211f26;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escape(copy.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8ef;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:0 8px 20px;font-size:20px;font-weight:600;color:#65558f;"><span style="display:inline-block;padding:8px 10px;background:#65558f;color:#ffffff;border-radius:12px;margin-right:10px;">i++</span> I++ Club <span style="font-size:16px;">🐾</span></td></tr>
<tr><td style="padding:28px 24px;background:#ffffff;border:1px solid #d0cbd5;border-radius:20px;">
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.5;font-weight:600;color:#211f26;">${escape(copy.title)}</h1>
${copy.paragraphs.map(paragraph).join('')}
${copy.code ? `<div style="margin:4px 0 20px;padding:20px 12px;border-radius:12px;background:#eee8f5;text-align:center;color:#514077;font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;">${escape(copy.code)}</div>` : ''}
${copy.details ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;padding:12px;background:#f7f4fa;border-radius:12px;">${copy.details.map(([label,value]) => `<tr><td style="padding:6px 8px;font-size:13px;color:#625d68;vertical-align:top;white-space:nowrap;">${escape(label)}</td><td style="padding:6px 8px;font-size:14px;line-height:1.6;word-break:break-word;color:#211f26;">${escape(value)}</td></tr>`).join('')}</table>` : ''}
${copy.note ? paragraph(copy.note) : ''}
${copy.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="background:#65558f;border-radius:24px;mso-padding-alt:12px 24px;"><a href="${escape(url!)}" style="display:inline-block;padding:12px 24px;border:1px solid #65558f;border-radius:24px;background:#65558f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${escape(copy.action.label)} →</a></td></tr></table>` : ''}
${copy.warning ? `<p style="margin:0;padding-top:16px;border-top:1px solid #e8e3ed;font-size:13px;line-height:1.8;color:#625d68;">${escape(copy.warning)}</p>` : ''}
</td></tr><tr><td align="center" style="padding:20px 8px;font-size:12px;line-height:1.7;color:#625d68;">I++ Club · <a href="${escape(home)}" style="color:#65558f;text-decoration:none;">${escape(origin.host)}</a></td></tr></table>
</td></tr></table></body></html>`;
  // Display names are user input; keep headers single-line as well as escaping HTML.
  return { to: event.to, subject: copy.subject.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/g, ' '), text, html };
}
