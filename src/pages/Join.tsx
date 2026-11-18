import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, MapPin, Send, X } from 'lucide-react';
import type { InterviewSlot, PublicInterviewSchedule } from '../../shared/recruitment';
import { useAccount } from '../AccountProvider';
import { api, Button, date, Loading, message, Notice } from '../ui';
export const slotLabel = (slot: InterviewSlot) => `${date(slot.startAt)} — ${date(slot.endAt)}`;
export function Join() {
  const { user, ready } = useAccount();
  const [schedules, setSchedules] = useState<PublicInterviewSchedule[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [slotId, setSlotId] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  async function load() {
    setSchedules(await api<PublicInterviewSchedule[]>('/join/schedules'));
  }
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setSchedules(null);
    setSelected(null);
    void api<PublicInterviewSchedule[]>('/join/schedules')
      .then(data => {
        if (active) {
          setSchedules(data);
          setError('');
        }
      })
      .catch(e => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [ready, user?.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  async function apply() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/join/applications', { scheduleId: selected, slotId, name, contact, note });
      setSelected(null);
      await load();
      setNotice('填报已提交');
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const current = schedules?.find(item => item.id === selected);
  function select(schedule: PublicInterviewSchedule) {
    if (schedule.cancelledAt) return;
    setSlotId(schedule.slots.find(slot => slot.endAt > Date.now())?.id ?? '');
    setName(user?.displayName ?? '');
    setContact(user?.email ?? '');
    setNote('');
    setError('');
    setSelected(schedule.id);
  }
  return (
    <div className="page join-page">
      <header className="join-heading">
        <h1>加入我们</h1>
        {user?.role === 'admin' && (
          <Link className="text-link" to="/admin?tab=interviews">
            {user.canManageAdmins ? '发布与查看安排' : '查看填报情况'}
          </Link>
        )}
      </header>
      {error && !selected && (
        <Notice tone="error">
          {error}
          <Button
            variant="text"
            onClick={() =>
              void load()
                .then(() => setError(''))
                .catch(e => setError(message(e)))
            }
          >
            重试
          </Button>
        </Notice>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      {ready && !user && (
        <div className="join-login-prompt">
          <span>登录后选择时间并填报。</span>
          <Link className="link-button" to="/account?next=/join">
            登录 / 注册
          </Link>
        </div>
      )}
      {!schedules ? (
        !error && <Loading />
      ) : (
        <section className="join-schedule-section" aria-labelledby="join-schedule-title">
          <div className="section-heading">
            <h2 id="join-schedule-title">面试安排</h2>
          </div>
          {schedules.length ? (
            <div className="join-schedules">
              {schedules.map(schedule => {
                const expired = schedule.slots.every(slot => slot.endAt <= now);
                const cancelled = schedule.cancelledAt != null;
                const chosen = schedule.slots.find(slot => slot.id === schedule.application?.slotId);
                return (
                  <article className={`surface-card join-schedule ${expired || cancelled ? 'expired' : ''}`} key={schedule.id}>
                    <div className="join-schedule-top">
                      <span className={`chip ${expired || cancelled ? 'expired-chip' : ''}`}>
                        {cancelled ? '已取消' : expired ? '已过期' : '报名中'}
                      </span>
                      {schedule.application && (
                        <span className="chip">
                          <Check size={14} />
                          已填报
                        </span>
                      )}
                    </div>
                    <h3>{schedule.title}</h3>
                    <div className="join-meta">
                      <span>
                        <MapPin size={17} />
                        {schedule.location}
                      </span>
                    </div>
                    <ul className="interview-times">
                      {schedule.slots.map(slot => (
                        <li key={slot.id}>
                          <CalendarDays size={16} />
                          <span>{slotLabel(slot)}</span>
                          {slot.endAt <= now && <span className="subtle">已过期</span>}
                        </li>
                      ))}
                    </ul>
                    {schedule.description && <p>{schedule.description}</p>}
                    {schedule.application ? (
                      <div className="join-confirmation">
                        <strong>已选时间</strong>
                        <span>{chosen ? slotLabel(chosen) : '—'}</span>
                        {cancelled && <span className="subtle">该安排已取消，本次填报不再生效，请留意邮件通知。</span>}
                      </div>
                    ) : (
                      !expired && !cancelled && (
                        <div className="join-schedule-actions">
                          {user ? (
                            <Button onClick={() => select(schedule)}>
                              <Send size={16} />
                              选择安排
                            </Button>
                          ) : (
                            <Link className="text-link" to="/account?next=/join">
                              登录后填报
                            </Link>
                          )}
                        </div>
                      )
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <section className="surface-card empty">
              <CalendarDays size={38} />
              <h3>暂无面试安排</h3>
            </section>
          )}
        </section>
      )}
      <dialog
        className="m3-dialog join-application"
        ref={dialog}
        onCancel={e => {
          if (busy) e.preventDefault();
          else setSelected(null);
        }}
        aria-labelledby="application-title"
      >
        <div className="card-top">
          <h2 id="application-title">{current?.title ?? '填报安排'}</h2>
          <button className="icon-button" disabled={busy} aria-label="取消填报" onClick={() => setSelected(null)}>
            <X size={20} />
          </button>
        </div>
        {current && (
          <form
            ref={form}
            onSubmit={e => {
              e.preventDefault();
              void apply();
            }}
          >
            <fieldset disabled={busy}>
              <label className="field">
                面试时间
                <select value={slotId} onChange={e => setSlotId(e.target.value)} required>
                  {current.slots.map(slot => (
                    <option value={slot.id} key={slot.id} disabled={slot.endAt <= now}>
                      {slotLabel(slot)}
                      {slot.endAt <= now ? '（已过期）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                姓名
                <input value={name} onChange={e => setName(e.target.value)} maxLength={40} required />
              </label>
              <label className="field">
                联系方式
                <input value={contact} onChange={e => setContact(e.target.value)} maxLength={100} required />
              </label>
              <label className="field">
                备注（选填）
                <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3} />
              </label>
            </fieldset>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="dialog-actions">
              <Button variant="text" disabled={busy} onClick={() => setSelected(null)}>
                取消
              </Button>
              <Button disabled={busy || !slotId} onClick={() => form.current?.requestSubmit()}>
                <Send size={17} />
                {busy ? '提交中…' : '提交填报'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
