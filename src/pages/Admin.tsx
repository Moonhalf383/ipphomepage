import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ClipboardList,
  Edit3,
  LockKeyhole,
  LogOut,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
  UsersRound
} from 'lucide-react';
import type { Question, QuestionType, Result, Settings } from '../../shared/types';
import { typeLabels } from '../../shared/types';
import { api, Button, date, Loading, message, Notice } from '../ui';
import { Link, Navigate } from 'react-router-dom';
import type { Account } from '../../shared/accounts';
import { useAccount } from '../AccountProvider';
import { Users } from './Users';
import { Records } from './Records';
type AdminData = {
  user: Account | null;
  settings: Settings;
  questions: Question[];
  attempts: { id: string; displayName: string; email?: string; demo: boolean; createdAt: number; result: Result | null }[];
  certificates: { id: string; revoked: number }[];
};
const newQuestion = (): Question => ({
  id: '',
  type: 'single',
  category: '社区礼仪',
  prompt: '',
  options: ['', '', '', ''],
  correct: [0],
  points: 10,
  explanation: '',
  active: true
});
export function Admin() {
  const { user, ready, refresh } = useAccount();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('questions');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Question | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => Promise<void> } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== 'admin') { setLoading(false); setData(null); return; }
    setLoading(true);
    api<AdminData>('/admin')
      .then(d => {
        setData(d);
        setDraft(d.settings);
      })
      .catch(e => {
        if (message(e) !== '请先登录管理后台') setError(message(e));
      })
      .finally(() => setLoading(false));
  }, [user?.id, user?.role, ready]);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirm]);
  async function reload() {
    const d = await api<AdminData>('/admin');
    setData(d);
    setDraft(d.settings);
    return d;
  }
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await reload();
      setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveQuestion(q: Question) {
    await perform(async () => {
      await api(q.id ? `/admin/questions/${q.id}` : '/admin/questions', q, q.id ? 'PUT' : 'POST');
      setEditing(null);
    }, '题目已保存；新答题会使用新规则版本，已开始的问卷不受影响。');
  }
  if (loading)
    return (
      <div className="page narrow">
        <Loading />
      </div>
    );
  if (!data) {
    if (!user) return <Navigate to="/account?next=/admin" replace />;
    return <div className="page narrow"><Notice tone="error">{error || '你的账号暂无管理权限。'}</Notice><Link className="text-link" to="/account">返回我的账号</Link></div>;
  }
  const filtered = data.questions.filter(q =>
    `${q.prompt} ${q.category} ${typeLabels[q.type]}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="page admin-page">
      <div className="admin-heading">
        <div>
          <h1>I++Club控制台</h1>
        </div>
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void api('/admin/logout', {})
              .then(() => {
                setData(null);
                setNotice('');
                void refresh();
              })
              .catch(e => setError(message(e)))
              .finally(() => setBusy(false));
          }}
        >
          <LogOut size={17} />
          退出登录
        </Button>
      </div>
      <div className="admin-stats" role="group" aria-label="问卷概览">
        <div>
          <span>问卷状态</span>
          <strong className="admin-status">{data.settings.enabled ? '已开放' : '演示中'}</strong>
        </div>
        <div>
          <span>启用题目</span>
          <strong>
            {data.questions.filter(q => q.active).length} <small>/ {data.questions.length}</small>
          </strong>
        </div>
        <div>
          <span>每份题数</span>
          <strong>{data.settings.questionCount} <small>题</small></strong>
        </div>
        <div>
          <span>通过分数</span>
          <strong>{data.settings.passScore} <small>分</small></strong>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      <div className="admin-tabs" role="group" aria-label="管理分类">
        {[
          ['users', '用户与邮件', UsersRound],
          ['questions', '题库管理', ClipboardList],
          ['settings', '问卷设置', Settings2],
          ['records', '答题与证书', ShieldAlert]
        ].map(([key, label, Icon]) => {
          const I = Icon as typeof ClipboardList;
          return (
            <button
              key={key as string}
              aria-pressed={tab === key}
              className={tab === key ? 'active' : ''}
              onClick={() => {
                setTab(key as string);
                setEditing(null);
              }}
            >
              <I size={18} />
              {label as string}
            </button>
          );
        })}
      </div>
      {tab === 'users' && data.user && <Users actor={data.user} />}
      {tab === 'questions' &&
        (editing ? (
          <QuestionEditor question={editing} onSave={saveQuestion} onCancel={() => setEditing(null)} busy={busy} />
        ) : (
          <section className="surface-card question-bank">
            <div className="bank-toolbar">
              <label className="search-field">
                <Search size={19} />
                <input
                  aria-label="搜索题目"
                  placeholder="搜索题目、分类或题型…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>
              <Button onClick={() => setEditing(newQuestion())}>
                <Plus size={18} />
                添加题目
              </Button>
            </div>
            <p className="small subtle">客观题全部答对才得分；简答与量表为不计分的选填题。修改规则不会重算历史记录。</p>
            <div className="question-list">
              {filtered.map((q, i) => (
                <article key={q.id}>
                  <span className="question-list-number">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="question-tags">
                      <span className="chip">{typeLabels[q.type]}</span>
                      <span>{q.category}</span>
                      <span>{q.points ? `${q.points} 分` : '不计分'}</span>
                      {!q.active && <span className="disabled-chip">已停用</span>}
                    </div>
                    <h3>{q.prompt}</h3>
                  </div>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`编辑：${q.prompt}`}
                      onClick={() => setEditing(structuredClone(q))}
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      className="icon-button danger"
                      disabled={busy}
                      aria-label={`删除：${q.prompt}`}
                      onClick={() =>
                        setConfirm({
                          title: '删除这道题目？',
                          text: '这会将题目从后续抽题中移除，历史答题快照会保留。也可以通过编辑将题目停用。',
                          action: async () => {
                            await perform(() => api(`/admin/questions/${q.id}`, {}, 'DELETE'), '题目已删除');
                          }
                        })
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </article>
              ))}
              {!filtered.length && <p className="empty">没有匹配的题目。</p>}
            </div>
          </section>
        ))}
      {tab === 'settings' && draft && (
        <section className="surface-card settings-panel">
          <div className="card-top">
            <h2>问卷设置</h2>
            <span className="subtle">规则 v{data.settings.version}</span>
          </div>
          <form
            onSubmit={e => {
              e.preventDefault();
              void perform(() => api('/admin/settings', { ...draft, reviewed }, 'PUT'), '问卷设置已保存');
            }}
          >
            <div className="form-grid">
              <label className="field">
                每份问卷题数
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={draft.questionCount}
                  onChange={e => setDraft({ ...draft, questionCount: Number(e.target.value) })}
                  required
                />
                <span className="field-help">1–30，不能超过启用题目数量。</span>
              </label>
              <label className="field">
                通过分数线
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.passScore}
                  onChange={e => setDraft({ ...draft, passScore: Number(e.target.value) })}
                  required
                />
                <span className="field-help">按未四舍五入的实际得分判断是否通过。</span>
              </label>
            </div>
            <label className="switch-label">
              <input
                type="checkbox"
                role="switch"
                checked={draft.enabled}
                onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
              />
              <span>
                <strong>开放正式问卷</strong>
                <small>开启后，登录用户可提交正式问卷，通过后获得证书。关闭时仅提供演示，未提交的正式问卷暂停，已签发证书仍有效。</small>
              </span>
            </label>
            {draft.enabled && !data.settings.enabled && (
              <label className="check-label review-confirm">
                <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} required />
                <span>已确认题目、答案和通过分数，同意开放正式问卷并签发证书。</span>
              </label>
            )}
            <Button
              onClick={() =>
                void perform(() => api('/admin/settings', { ...draft, reviewed }, 'PUT'), '问卷设置已保存')
              }
              disabled={busy || (draft.enabled && !data.settings.enabled && !reviewed)}
            >
              <Save size={18} />
              保存设置
            </Button>
          </form>
        </section>
      )}
      {tab === 'records' && <Records attempts={data.attempts} certificates={data.certificates} busy={busy} onRevoke={id => setConfirm({
        title: '撤销这份证书？',
        text: '撤销后，验真页将显示证书无效，持有人将无法再次下载。已下载的图片会保留。此操作不可恢复。',
        action: async () => { await perform(() => api(`/admin/certificates/${id}/revoke`, {}), '证书已撤销'); }
      })} />}
      <dialog
        ref={dialog}
        className="m3-dialog"
        onCancel={() => setConfirm(null)}
        aria-labelledby="admin-confirm-title"
      >
        <ShieldAlert size={28} />
        <h2 id="admin-confirm-title">{confirm?.title}</h2>
        <p>{confirm?.text}</p>
        <div className="dialog-actions">
          <Button variant="text" onClick={() => setConfirm(null)}>
            取消
          </Button>
          <Button
            onClick={() => {
              const action = confirm?.action;
              setConfirm(null);
              void action?.();
            }}
          >
            确认操作
          </Button>
        </div>
      </dialog>
    </div>
  );
}
function QuestionEditor({
  question,
  onSave,
  onCancel,
  busy
}: {
  question: Question;
  onSave: (q: Question) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [q, setQ] = useState(question);
  const form = useRef<HTMLFormElement>(null);
  const objective = ['single', 'multiple', 'boolean'].includes(q.type);
  const update = (changes: Partial<Question>) => setQ(current => ({ ...current, ...changes }));
  function changeType(type: QuestionType) {
    const optional = type === 'text' || type === 'scale';
    update({
      type,
      options: optional
        ? []
        : type === 'boolean'
          ? ['正确', '错误']
          : q.options.length >= 2
            ? q.options
            : ['', '', '', ''],
      correct: optional ? [] : [0],
      points: optional ? 0 : Math.max(q.points, 10)
    });
  }
  return (
    <section className="surface-card question-editor">
      <div className="card-top">
        <h2>{q.id ? '编辑题目' : '添加新题目'}</h2>
        <button className="icon-button" aria-label="取消编辑" onClick={onCancel}>
          <X size={20} />
        </button>
      </div>
      <form
        ref={form}
        onSubmit={e => {
          e.preventDefault();
          void onSave(q);
        }}
      >
        <div className="form-grid">
          <label className="field">
            题型
            <select value={q.type} onChange={e => changeType(e.target.value as QuestionType)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            分类
            <input required maxLength={40} value={q.category} onChange={e => update({ category: e.target.value })} />
          </label>
        </div>
        <label className="field">
          题目内容
          <textarea
            required
            minLength={3}
            maxLength={1500}
            rows={3}
            value={q.prompt}
            onChange={e => update({ prompt: e.target.value })}
          />
        </label>
        {objective ? (
          <>
            <h3>选项与标准答案</h3>
            <p className="small subtle">
              勾选正确选项。{q.type === 'multiple' ? '多选题可设置多个标准答案。' : '只能设置一个正确答案。'}
            </p>
            <div className="option-editor">
              {q.options.map((option, i) => (
                <div key={i}>
                  <input
                    type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                    name="correct"
                    aria-label={`选项 ${i + 1} 为正确答案`}
                    checked={q.correct.includes(i)}
                    onChange={() =>
                      update({
                        correct:
                          q.type === 'multiple'
                            ? q.correct.includes(i)
                              ? q.correct.filter(n => n !== i)
                              : [...q.correct, i]
                            : [i]
                      })
                    }
                  />
                  <input
                    aria-label={`选项 ${i + 1} 内容`}
                    required
                    maxLength={300}
                    value={option}
                    onChange={e => update({ options: q.options.map((v, n) => (n === i ? e.target.value : v)) })}
                  />
                  {q.type !== 'boolean' && q.options.length > 2 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`移除选项 ${i + 1}`}
                      onClick={() =>
                        update({
                          options: q.options.filter((_, n) => n !== i),
                          correct: q.correct.filter(n => n !== i).map(n => (n > i ? n - 1 : n))
                        })
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {q.type !== 'boolean' && q.options.length < 8 && (
              <Button variant="text" onClick={() => update({ options: [...q.options, ''] })}>
                <Plus size={17} />
                添加选项
              </Button>
            )}
            <label className="field points-field">
              本题分值
              <input
                type="number"
                min={1}
                max={100}
                required
                value={q.points}
                onChange={e => update({ points: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              管理员解析（不向答题者下发）
              <textarea
                maxLength={2000}
                rows={3}
                value={q.explanation}
                onChange={e => update({ explanation: e.target.value })}
              />
            </label>
          </>
        ) : (
          <Notice>
            {q.type === 'text' ? '简答题允许填写最多 2000 字。' : '量表为固定 1–5 级，请在题目中说明两端含义。'}
            此题不计分、无标准答案、允许跳过。
          </Notice>
        )}
        <label className="check-label">
          <input type="checkbox" checked={q.active} onChange={e => update({ active: e.target.checked })} />
          <span>启用此题，允许被新问卷抽取</span>
        </label>
        <div className="editor-actions">
          <Button variant="text" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button disabled={busy || (objective && !q.correct.length)} onClick={() => form.current?.requestSubmit()}>
            <Check size={18} />
            {busy ? '正在保存…' : '保存题目'}
          </Button>
        </div>
      </form>
    </section>
  );
}
