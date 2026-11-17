import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Eye, Plus, Save, X } from 'lucide-react';
import type { InterviewAdminData } from '../../shared/recruitment';
import { useAccount } from '../AccountProvider';
import { api, Button, date, Loading, message, Notice } from '../ui';
import { slotLabel } from './Join';
type Draft = {
  title: string;
  location: string;
  description: string;
  slots: { key: number; startAt: string; endAt: string }[];
};
const blank = (): Draft => ({ title: '', location: '', description: '', slots: [{ key: 0, startAt: '', endAt: '' }] });
export function Interviews() {
  const { user } = useAccount();
  const [data, setData] = useState<InterviewAdminData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const key = useRef(1);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  async function load() {
    setData(await api<InterviewAdminData>('/admin/interviews'));
  }
  useEffect(() => {
    void load().catch(e => setError(message(e)));
  }, []);
  async function save() {
    if (!draft || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/interviews', {
        ...draft,
        slots: draft.slots.map(slot => ({
          startAt: new Date(slot.startAt).getTime(),
          endAt: new Date(slot.endAt).getTime()
        }))
      });
      setDraft(null);
      await load();
      setNotice('面试安排已发布');
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const schedule = data?.schedules.find(item => item.id === detailId);
  const applicants = data?.applications.filter(application => application.scheduleId === detailId) ?? [];
  return (
    <section className="surface-card interviews-panel">
      <div className="card-top">
        <h2>招新面试</h2>
        {user?.canManageAdmins && (
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(blank());
              setDetailId(null);
              setError('');
            }}
          >
            <Plus size={17} />
            发布安排
          </Button>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!data && !error && <Loading />}
      {draft && (
        <div className="interview-editor">
          <div className="card-top">
            <h3>新面试安排</h3>
            <button className="icon-button" disabled={busy} aria-label="取消安排编辑" onClick={() => setDraft(null)}>
              <X size={18} />
            </button>
          </div>
          <form
            ref={form}
            onSubmit={e => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <label className="field">
                标题
                <input
                  value={draft.title}
                  onChange={e => setDraft({ ...draft, title: e.target.value })}
                  maxLength={80}
                  required
                />
              </label>
              <label className="field">
                地点
                <input
                  value={draft.location}
                  onChange={e => setDraft({ ...draft, location: e.target.value })}
                  maxLength={160}
                  required
                />
              </label>
              <label className="field">
                描述（选填）
                <textarea
                  value={draft.description}
                  onChange={e => setDraft({ ...draft, description: e.target.value })}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <h3>可选时间</h3>
              {draft.slots.map((slot, index) => (
                <div className="interview-slot-editor" key={slot.key}>
                  <div className="form-grid">
                    <label className="field">
                      开始时间 {index + 1}
                      <input
                        type="datetime-local"
                        value={slot.startAt}
                        onChange={e =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map(s => (s.key === slot.key ? { ...s, startAt: e.target.value } : s))
                          })
                        }
                        required
                      />
                    </label>
                    <label className="field">
                      结束时间 {index + 1}
                      <input
                        type="datetime-local"
                        value={slot.endAt}
                        min={slot.startAt}
                        onChange={e =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map(s => (s.key === slot.key ? { ...s, endAt: e.target.value } : s))
                          })
                        }
                        required
                      />
                    </label>
                  </div>
                  {draft.slots.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`移除时间 ${index + 1}`}
                      onClick={() => setDraft({ ...draft, slots: draft.slots.filter(s => s.key !== slot.key) })}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              <Button
                variant="text"
                disabled={draft.slots.length >= 20 || busy}
                onClick={() =>
                  setDraft({ ...draft, slots: [...draft.slots, { key: key.current++, startAt: '', endAt: '' }] })
                }
              >
                <Plus size={17} />
                添加时间
              </Button>
            </fieldset>
            <div className="editor-actions">
              <Button variant="text" disabled={busy} onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button disabled={busy} onClick={() => form.current?.requestSubmit()}>
                <Save size={17} />
                {busy ? '发布中…' : '发布安排'}
              </Button>
            </div>
          </form>
        </div>
      )}
      {data && (
        <div className="interview-list">
          {data.schedules.length ? (
            data.schedules.map(item => (
              <article key={item.id}>
                <div>
                  <span className="chip">
                    {item.slots.every(slot => slot.endAt <= Date.now()) ? '已过期' : '报名中'}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.location}</p>
                  <ul className="interview-times">
                    {item.slots.map(slot => (
                      <li key={slot.id}>{slotLabel(slot)}</li>
                    ))}
                  </ul>
                </div>
                <Button
                  variant="text"
                  onClick={() => {
                    setDetailId(item.id);
                    setDraft(null);
                  }}
                >
                  <Eye size={16} />
                  填报情况（{data.applications.filter(a => a.scheduleId === item.id).length}）
                </Button>
              </article>
            ))
          ) : (
            <div className="empty">
              <CalendarDays size={34} />
              <p>暂无面试安排</p>
            </div>
          )}
        </div>
      )}
      {schedule && (
        <div className="record-detail" key={detailId}>
          <div className="card-top">
            <h3>{schedule.title} · 填报情况</h3>
            <button className="icon-button" aria-label="关闭填报情况" onClick={() => setDetailId(null)}>
              <X size={18} />
            </button>
          </div>
          {applicants.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>姓名 / 邮箱</th>
                    <th>选择时间</th>
                    <th>联系方式</th>
                    <th>备注</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {applicants.map(a => {
                    const slot = schedule.slots.find(s => s.id === a.slotId);
                    return (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.name}</strong>
                          <small>{a.email}</small>
                        </td>
                        <td>{slot ? slotLabel(slot) : '—'}</td>
                        <td>{a.contact}</td>
                        <td className="application-note">{a.note || '—'}</td>
                        <td>{date(a.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>暂无填报</p>
          )}
        </div>
      )}
    </section>
  );
}
