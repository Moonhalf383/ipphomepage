import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Mail } from 'lucide-react';
import { roleLabels } from '../../shared/accounts';
import type { Result } from '../../shared/types';
import { useAccount } from '../AccountProvider';
import { api, Button, date, Loading, message, Notice } from '../ui';
type Mode = 'login' | 'register' | 'reset';
export function Account() {
  const { user, ready, refresh } = useAccount();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mode: Mode = params.get('mode') === 'register' ? 'register' : params.get('mode') === 'reset' ? 'reset' : 'login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(Date.now());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [records, setRecords] = useState<{ id: string; displayName: string; createdAt: number; result: Result | null }[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const cooldownKey = `${mode}:${email.trim().toLowerCase()}`;
  const cooldown = Math.max(0, Math.ceil(((cooldowns[cooldownKey] ?? 0) - clock) / 1000));
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setClock(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [cooldown, cooldownKey]);
  useEffect(() => { setPassword(''); setConfirmation(''); setCode(''); setError(''); setNotice(''); }, [mode]);
  useEffect(() => {
    if (user) void api<typeof records>('/auth/attempts').then(setRecords).catch(e => setError(message(e)));
    else setRecords([]);
  }, [user?.id]);
  function switchMode(next: Mode) {
    if (pending.current) return;
    const nextParams = new URLSearchParams(params);
    nextParams.delete('updated');
    if (next === 'login') nextParams.delete('mode'); else nextParams.set('mode', next);
    navigate(`/account${nextParams.size ? `?${nextParams}` : ''}`);
  }
  async function submit() {
    if (pending.current) return;
    if (mode !== 'login' && password !== confirmation) { setError('两次输入的密码不一致'); return; }
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        await api('/auth/password/reset', { email, password, code });
        await refresh(); switchAfterReset(); return;
      }
      await api(mode === 'register' ? '/auth/register' : '/auth/login', mode === 'register' ? { email, password, displayName, code } : { email, password });
      setPassword(''); setConfirmation(''); await refresh();
      const target = params.get('next');
      navigate(target === '/admin' ? '/admin' : target === '/assessment' ? '/assessment' : '/account', { replace: true });
    } catch (e) { setError(message(e)); } finally { pending.current = false; setBusy(false); }
  }
  function switchAfterReset() {
    const nextParams = new URLSearchParams(params); nextParams.delete('mode');
    nextParams.set('updated', '1');
    navigate(`/account?${nextParams}`, { replace: true });
  }
  async function sendCode() {
    if (pending.current) return;
    const emailInput = form.current?.querySelector<HTMLInputElement>('input[type=email]');
    if (!emailInput?.reportValidity()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await api(mode === 'reset' ? '/auth/password/code' : '/auth/code', { email });
      const now = Date.now(); setClock(now); setCooldowns(c => ({ ...c, [cooldownKey]: now + 60_000 }));
      setNotice(mode === 'reset' ? '如果该邮箱已注册，你将收到验证码，10 分钟内有效。' : '请查看邮箱中的验证码，10 分钟内有效。');
    } catch (e) { setError(message(e)); } finally { pending.current = false; setBusy(false); }
  }
  if (!ready) return <div className="page account-page"><Loading /></div>;
  const reset = mode === 'reset';
  const register = mode === 'register';
  const title = user && !reset ? '我的账号' : reset ? '重设密码' : register ? '邮箱注册' : '邮箱登录';
  return <div className={`page account-page ${user && !reset ? 'account-overview' : 'account-auth'}`}>
    <header className="account-heading"><h1>{title}</h1></header>
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {params.get('updated') === '1' && mode === 'login' && !user && <Notice tone="success">密码已更新，请使用新密码登录。</Notice>}
    {user && !reset ? <>
      <section className="surface-card account-card">
        <div className="account-identity"><h2>{user.displayName}</h2><span className="chip">{roleLabels[user.role]}</span></div><p>{user.email}</p>
        <div className="account-actions">
          <Link className="account-action" to="/assessment">前往问卷 <ArrowRight size={16} /></Link>
          {user.role === 'admin' && <Link className="account-action" to="/admin">社团管理 <ArrowRight size={16} /></Link>}
          <button className="account-action" disabled={busy} onClick={() => {
            if (pending.current) return; pending.current = true; setBusy(true);
            void api('/auth/logout', {}).then(refresh).catch(e => setError(message(e))).finally(() => { pending.current = false; setBusy(false); });
          }}>退出登录</button>
        </div>
        <button className="account-text-action" onClick={() => { setEmail(user.email); switchMode('reset'); }} disabled={busy}>重设密码</button>
      </section>
      <section className="surface-card account-card"><h2>我的问卷</h2>
        {records.length ? <ul className="account-records">{records.map(r => <li key={r.id}><div><strong>{r.displayName}</strong><p>{date(r.createdAt)}</p></div><Link className="text-link" to={`/assessment/${r.id}`}>{r.result ? `${r.result.score} 分 · 查看结果` : '继续答题'} <ArrowRight size={16} /></Link></li>)}</ul> : <p>还没有答题记录。</p>}
      </section>
    </> : <section className="surface-card account-card">
      <form ref={form} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="field">邮箱<input name="email" type="email" required maxLength={254} autoComplete="username" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>
        {register && <label className="field">昵称<input name="nickname" required maxLength={24} autoComplete="nickname" value={displayName} disabled={busy} onChange={e => setDisplayName(e.target.value)} /></label>}
        <label className="field">{reset ? '新密码' : register ? '设置密码' : '密码'}<input name={mode === 'login' ? 'password' : 'new-password'} type="password" required minLength={mode === 'login' ? 1 : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? '' : '至少 12 位'} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
        {mode !== 'login' && <label className="field">确认密码<input name="confirm-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>}
        {mode !== 'login' && <div className="code-row"><label className="field">邮箱验证码<input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></label><Button variant="outlined" disabled={busy || cooldown > 0} onClick={() => void sendCode()}><Mail size={16} />{cooldown ? `${cooldown} 秒后重发` : '获取验证码'}</Button></div>}
        <Button className="full-button" disabled={busy} onClick={() => form.current?.requestSubmit()}>{busy ? '请稍候…' : register ? '完成注册' : reset ? '保存新密码' : '登录'}<ArrowRight size={17} /></Button>
      </form>
      <div className="account-switch"><span>{register ? '已有账号？' : reset ? '想起密码了？' : '还没有账号？'}</span><button className="account-text-action" disabled={busy} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '邮箱注册' : '直接登录'}</button>{mode === 'login' && <button className="account-text-action forgot-password" disabled={busy} onClick={() => switchMode('reset')}>忘记密码？</button>}</div>
    </section>}
  </div>;
}
