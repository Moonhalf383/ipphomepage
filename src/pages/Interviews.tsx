import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Eye, Pencil, Plus, Save, Trash2, X, XCircle } from 'lucide-react';
import type { InterviewAdminData, InterviewSchedule } from '../../shared/recruitment';
import { useAccount } from '../AccountProvider';
import { api, Button, date, Loading, message, Notice } from '../ui';
import { slotLabel } from './Join';
type Draft = {
  id?: string;
  title: string;
  location: string;
  description: string;
  slots: { key: number; id?: string; locked?: boolean; startAt: string; endAt: string; startAtMs: number; endAtMs: number }[];
};
const toLocal = (at: number) => {
  const d = new Date(at);
  return new Date(at - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const blank = (): Draft => ({ title: '', location: '', description: '', slots: [{ key: 0, startAt: '', endAt: '', startAtMs: NaN, endAtMs: NaN }] });
export function Interviews() {
  const { user } = useAccount();
  const [data, setData] = useState<InterviewAdminData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'cancel' | 'delete'; item: InterviewSchedule } | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
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
      const body = {
        title: draft.title,
        location: draft.location,
        description: draft.description,
        slots: draft.slots.map(slot => ({
          ...(slot.id ? { id: slot.id } : {}),
          // Keep original millisecond precision unless the field was actually edited.
          startAt: Number.isFinite(slot.startAtMs) ? slot.startAtMs : new Date(slot.startAt).getTime(),
          endAt: Number.isFinite(slot.endAtMs) ? slot.endAtMs : new Date(slot.endAt).getTime()
        }))
      };
      if (draft.id) await api(`/admin/interviews/${draft.id}`, body, 'PUT');
      else await api('/admin/interviews', body);
      const edited = Boolean(draft.id);
      setDraft(null);
      await load();
      setNotice(edited ? '面试安排已更新' : '面试安排已发布');
    } catch (e) {
      setError(message(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function edit(item: InterviewSchedule) {
    const booked = new Set((data?.applications ?? []).filter(a => a.scheduleId === item.id).map(a => a.slotId));
    setDetailId(null);
    setError('');
    setNotice('');
    setDraft({
      id: item.id,
      title: item.title,
      location: item.location,
      description: item.description,
      slots: item.slots.map(slot => ({
        key: key.current++,
        id: slot.id,
        locked: booked.has(slot.id),
        startAt: toLocal(slot.startAt),
        endAt: toLocal(slot.endAt),
        startAtMs: slot.startAt,
        endAtMs: slot.endAt
      }))
    });
  }
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirm]);
  async function runConfirm() {
    if (!confirm || pending.current) return;
    const { kind, item } = confirm;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirm(null);
    try {
      if (kind === 'cancel') await api(`/admin/interviews/${item.id}/cancel`, {});
      else await api(`/admin/interviews/${item.id}`, undefined, 'DELETE');
      if (detailId === item.id) setDetailId(null);
      if (draft?.id === item.id) setDraft(null);
      await load();
      setNotice(kind === 'cancel' ? '安排已取消，填报者将收到邮件通知' : '安排已删除');
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
            <h3>{draft.id ? '编辑面试安排' : '新面试安排'}</h3>
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
                      开始时间 {index + 1}{slot.locked ? '（已有填报，不可修改）' : ''}
                      <input
                        type="datetime-local"
                        disabled={slot.locked}
                        value={slot.startAt}
                        onChange={e =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map(s =>
                              s.key === slot.key ? { ...s, startAt: e.target.value, startAtMs: new Date(e.target.value).getTime() } : s
                            )
                          })
                        }
                        required
                      />
                    </label>
                    <label className="field">
                      结束时间 {index + 1}
                      <input
                        type="datetime-local"
                        disabled={slot.locked}
                        value={slot.endAt}
                        min={slot.startAt}
                        onChange={e =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map(s =>
                              s.key === slot.key ? { ...s, endAt: e.target.value, endAtMs: new Date(e.target.value).getTime() } : s
                            )
                          })
                        }
                        required
                      />
                    </label>
                  </div>
                  {draft.slots.length > 1 && !slot.locked && (
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
                  setDraft({ ...draft, slots: [...draft.slots, { key: key.current++, startAt: '', endAt: '', startAtMs: NaN, endAtMs: NaN }] })
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
                {busy ? '保存中…' : draft.id ? '保存修改' : '发布安排'}
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
                    {item.cancelledAt ? '已取消' : item.slots.every(slot => slot.endAt <= Date.now()) ? '已过期' : '报名中'}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.location}</p>
                  <ul className="interview-times">
                    {item.slots.map(slot => (
                      <li key={slot.id}>{slotLabel(slot)}</li>
                    ))}
                  </ul>
                </div>
                <div className="interview-actions">
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
                  {user?.canManageAdmins && (
                    <>
                      <Button variant="text" disabled={busy || Boolean(item.cancelledAt)} onClick={() => edit(item)}>
                        <Pencil size={16} />
                        编辑
                      </Button>
                      {!item.cancelledAt && (
                        <Button variant="text" disabled={busy} onClick={() => setConfirm({ kind: 'cancel', item })}>
                          <XCircle size={16} />
                          取消安排
                        </Button>
                      )}
                      <span title={data.applications.some(a => a.scheduleId === item.id) ? '已有填报，不能删除；可取消安排' : undefined}>
                        <Button
                          variant="text"
                          disabled={busy || data.applications.some(a => a.scheduleId === item.id)}
                          onClick={() => setConfirm({ kind: 'delete', item })}
                        >
                          <Trash2 size={16} />
                          删除
                        </Button>
                      </span>
                    </>
                  )}
                </div>
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
      <dialog
        ref={confirmDialog}
        className="m3-dialog"
        onCancel={() => setConfirm(null)}
        aria-labelledby="interview-confirm-title"
      >
        <XCircle size={28} />
        <h2 id="interview-confirm-title">{confirm?.kind === 'delete' ? '删除这个安排？' : '取消这个安排？'}</h2>
        <p>
          {confirm?.kind === 'delete'
            ? '删除后不可恢复。该安排目前没有填报记录。'
            : '取消后停止报名，已填报的同学会收到邮件通知；填报记录保留，可随时查看。此操作不可撤销。'}
        </p>
        <div className="dialog-actions">
          <Button variant="text" onClick={() => setConfirm(null)}>
            再想想
          </Button>
          <Button onClick={() => void runConfirm()}>{confirm?.kind === 'delete' ? '确认删除' : '确认取消'}</Button>
        </div>
      </dialog>
    </section>
  );
}
