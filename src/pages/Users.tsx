import { useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import type { Account, Role, UserSummary } from '../../shared/accounts';
import { roleLabels } from '../../shared/accounts';
import { api, Button, date, message, Notice } from '../ui';
import { useSwitchMotion } from '../motion';
type Job = { id: string; subject: string; total: number; sent: number; failed: number; pending: number };
export function Users({ actor }: { actor: Account }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mailAvailable, setMailAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [change, setChange] = useState<{ user: UserSummary; role: Role } | null>(null);
  const results = useRef<HTMLDivElement>(null);
  useSwitchMotion(results, users.map(user => `${user.id}:${user.role}`).join(','));
  const confirm = useRef<HTMLDialogElement>(null);
  const roleDialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    void api<{ users: UserSummary[]; total: number }>(`/admin/users?page=${page}&query=${encodeURIComponent(query)}&role=${role}`)
      .then(d => { if (active) { setUsers(d.users); setTotal(d.total); } }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [page, query, role, revision]);
  useEffect(() => {
    let active = true;
    const load = () => { void api<Job[]>('/admin/mail').then(d => { if (active) setJobs(d); }).catch(e => { if (active) setError(message(e)); }); };
    void api<{ available: boolean }>('/admin/mail/config').then(d => { if (active) setMailAvailable(d.available); }).catch(e => { if (active) setError(message(e)); });
    load(); const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [revision]);
  async function changeRole() {
    if (!change) return;
    setBusy(true); setError(''); roleDialog.current?.close();
    try { await api(`/admin/users/${change.user.id}/role`, { role: change.role }, 'PUT'); setRevision(n => n + 1); setNotice('身份已更新。'); }
    catch (e) { setError(message(e)); } finally { setBusy(false); setChange(null); }
  }
  async function send() {
    confirm.current?.close(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ recipients: number }>('/admin/mail', { subject, text, roles, userIds: selected, confirm: true });
      setNotice(`邮件已安排发送，共 ${result.recipients} 位收件人。`); setSubject(''); setText(''); setSelected([]); setRoles([]); setRevision(n => n + 1);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="users-panels">
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <section className="surface-card records-panel"><div className="card-top"><h2>用户与身份</h2><Button variant="text" onClick={() => setRevision(n => n + 1)}><RefreshCw size={16} />刷新</Button></div>
      <div className="form-grid"><label className="field">查找用户<input type="search" placeholder="邮箱或昵称" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      <label className="field">身份<select value={role} onChange={e => { setRole(e.target.value); setPage(1); }}><option value="all">全部身份</option>{Object.entries(roleLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <div className="table-scroll" ref={results}><table><thead><tr><th>选择</th><th>用户</th><th>身份</th><th>问卷</th></tr></thead><tbody>{users.map(u => {
        const canEdit = u.editableRoles.length > 0;
        return <tr key={u.id}><td><input type="checkbox" aria-label={`选择 ${u.email}`} checked={selected.includes(u.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids,u.id] : ids.filter(id => id !== u.id))} /></td>
          <td><strong>{u.displayName}</strong><small>{u.email}</small><small>{date(u.createdAt)}</small></td>
          <td>{canEdit ? <select aria-label={`${u.email} 的身份`} value={u.role} disabled={busy} onChange={e => { setChange({ user: u, role: e.target.value as Role }); roleDialog.current?.showModal(); }}>{Object.entries(roleLabels).filter(([r]) => u.editableRoles.includes(r as Role)).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select> : roleLabels[u.role]}</td>
          <td>{u.attempts} 份<small>{u.latestScore === null ? '暂无成绩' : `最近 ${u.latestScore} 分`}</small></td></tr>;
      })}</tbody></table></div>
      {!users.length && <p className="empty">没有匹配的用户。</p>}
      <div className="account-actions"><Button variant="text" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</Button><span>第 {page} 页 · 共 {total} 位用户</span><Button variant="text" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>下一页</Button></div>
    </section>
    <section className="surface-card records-panel"><h2>发送邮件</h2>
      {!mailAvailable && <Notice>公告邮件尚未开放。</Notice>}
      <form ref={form} onSubmit={e => { e.preventDefault(); confirm.current?.showModal(); }}>
        <fieldset className="mail-scope"><legend>按身份选择收件人</legend>{Object.entries(roleLabels).map(([k,v]) => <label className="check-label" key={k}><input type="checkbox" checked={roles.includes(k as Role)} onChange={e => setRoles(current => e.target.checked ? [...current,k as Role] : current.filter(r => r !== k))} />{v}</label>)}</fieldset>
        <p>另选 {selected.length} 位用户。{selected.length > 0 && <Button variant="text" onClick={() => setSelected([])}>清空选择</Button>}</p>
        <label className="field">主题<input required maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="field">正文<textarea required rows={7} maxLength={20000} value={text} onChange={e => setText(e.target.value)} /></label>
        <Button disabled={busy || !mailAvailable || (!roles.length && !selected.length)} onClick={() => form.current?.requestSubmit()}><Mail size={17} />确认收件范围</Button>
      </form>
      <h3>发送记录</h3>{jobs.length ? <ul className="account-records">{jobs.map(j => <li key={j.id}><strong>{j.subject}</strong><span>共 {j.total} · 已发送 {j.sent} · 待发送 {j.pending} · 失败 {j.failed}</span></li>)}</ul> : <p>暂无发送记录。</p>}
    </section>
    <dialog ref={confirm} className="m3-dialog" aria-labelledby="mail-confirm"><h2 id="mail-confirm">发送这封邮件？</h2><p>收件范围：{roles.map(r => roleLabels[r]).join('、') || '未选择身份'}；另选 {selected.length} 位用户。重复收件人只发送一次。</p><p>主题：{subject}</p><div className="dialog-actions"><Button variant="text" onClick={() => confirm.current?.close()}>返回修改</Button><Button disabled={busy} onClick={() => void send()}>确认发送</Button></div></dialog>
    <dialog ref={roleDialog} className="m3-dialog" aria-labelledby="role-confirm" onCancel={() => setChange(null)}><h2 id="role-confirm">更改用户身份？</h2><p>将 {change?.user.displayName} 设为{change && roleLabels[change.role]}。该用户需要重新登录。</p><div className="dialog-actions"><Button variant="text" onClick={() => { roleDialog.current?.close(); setChange(null); }}>取消</Button><Button disabled={busy} onClick={() => void changeRole()}>确认更改</Button></div></dialog>
  </div>;
}
