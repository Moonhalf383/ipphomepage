import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Fingerprint,
  LockKeyhole,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import type { Answers, Attempt, PublicQuestion, Result, Settings } from '../../shared/types';
import { typeLabels } from '../../shared/types';
import { api, Button, date, Loading, message, Notice } from '../ui';
import { useAccount } from '../AccountProvider';
export function Assessment() {
  const { user, ready } = useAccount();
  const { id } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<(Settings & { available: boolean }) | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRevision = useRef(0);
  useEffect(() => () => clearTimeout(saveTimer.current), [id]);
  const confirmation = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setAttempt(null);
    setIndex(0);
    setSaveState('');
    if (id)
      api<Attempt>(`/attempts/${id}`)
        .then(a => {
          if (!cancelled) {
            setAttempt(a);
            setAnswers(a.answers);
          }
        })
        .catch(e => {
          if (!cancelled) setError(message(e));
        });
    else
      api<Settings & { available: boolean }>('/config')
        .then(c => {
          if (!cancelled) setConfig(c);
        })
        .catch(e => {
          if (!cancelled) setError(message(e));
        });
    return () => {
      cancelled = true;
    };
  }, [id]);
  async function start() {
    if (!name.trim() || !consent) {
      setError('请填写证书昵称，并确认已阅读数据与认证说明。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const a = await api<Attempt>('/attempts', { displayName: name, consent });
      navigate(`/assessment/${a.id}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function answer(value: Answers[string] | undefined) {
    if (!attempt) return;
    const next = { ...answers };
    if (value === undefined) delete next[attempt.questions[index].id];
    else next[attempt.questions[index].id] = value;
    setAnswers(next);
    setSaveState('正在保存…');
    const serialized = JSON.stringify(next);
    const revision = ++saveRevision.current;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      queue.current = queue.current
        .catch(() => {})
        .then(() => api(`/attempts/${attempt.id}/draft`, { answers: JSON.parse(serialized) }, 'PUT'))
        .then(() => {
          if (revision === saveRevision.current) setSaveState('答案已保存');
        })
        .catch(e => {
          if (revision === saveRevision.current) {
            setSaveState('保存失败；提交时会重试保存全部答案');
            setError(message(e));
          }
        });
    }, 500);
  }
  async function submit() {
    if (!attempt) return;
    confirmation.current?.close();
    clearTimeout(saveTimer.current);
    setBusy(true);
    setError('');
    try {
      await queue.current;
      const result = await api<Result>(`/attempts/${attempt.id}/submit`, { answers });
      setAttempt({ ...attempt, result });
      window.scrollTo(0, 0);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const completed =
    attempt?.questions.filter(
      q => q.points > 0 && Array.isArray(answers[q.id]) && (answers[q.id] as number[]).length > 0
    ).length ?? 0;
  const required = attempt?.questions.filter(q => q.points > 0).length ?? 0;
  if (!id)
    return (
      <div className="page assessment-intro">
        <div className="breadcrumb">
          <Link to="/">首页</Link>
          <ChevronRight size={16} />
          素质问卷
        </div>
        <div className="intro-layout">
          <section className="intro-copy">
            <span className="page-symbol peach">
              <Fingerprint size={30} />
            </span>
            <h1>社区规则问卷</h1>
            <p className="lead">了解我们在尊重、协作与安全上的共识。</p>
          </section>
          <section className="surface-card start-card">
            <div className="card-top">
              <span className="chip">
                <span className="status-dot" />
                {config?.enabled ? '正式审核已开放' : '演示体验'}
              </span>
              <span className="subtle">{user ? user.displayName : config?.enabled ? '登录后作答' : '可免登录体验'}</span>
            </div>
            <h2>开始答题</h2>
            <p>{user ? '准备好后，就开始吧。' : config?.enabled ? '登录账号，保存你的问卷成绩。' : '填一个昵称，体验社区规则问卷。'}</p>
            {error && <Notice tone="error">{error}</Notice>}
            {!config ? (
              error ? (
                <Button variant="outlined" onClick={() => window.location.reload()}>
                  重新连接
                </Button>
              ) : (
                <Loading />
              )
            ) : config.enabled && !user ? (
              ready ? <Link className="link-button" to="/account?next=/assessment">登录 / 注册 <ArrowRight size={18} /></Link> : <Loading />
            ) : (
              <>
                <div className="quiz-facts">
                  <div>
                    <strong>
                      {config.questionCount}
                      <small> 题</small>
                    </strong>
                    <span>随机抽取</span>
                  </div>
                  <div>
                    <strong>
                      {config.passScore}
                      <small> 分</small>
                    </strong>
                    <span>通过标准 / 100</span>
                  </div>
                  <div>
                    <strong>
                      60<small> 分钟</small>
                    </strong>
                    <span>答题有效期</span>
                  </div>
                </div>
                {!config.enabled && (
                  <Notice>
                    当前是演示题库。可以体验完整答题流程，达标后下载带“演示”标记的纪念图片，
                    <strong>不会签发正式证书</strong>。
                  </Notice>
                )}
                {!config.available && <Notice tone="error">题库正在维护，暂时无法开始。</Notice>}
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    void start();
                  }}
                >
                  <label className="field">
                    证书昵称
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      maxLength={24}
                      required
                      placeholder="希望我们怎样称呼你？"
                      autoComplete="nickname"
                    />
                    <span className="field-help">1–24 个字符，无需真名</span>
                  </label>
                  <details className="privacy-box">
                    <summary>
                      <LockKeyhole size={16} />
                      数据如何保存与公开
                    </summary>
                    <p>
                      系统保存昵称、答案、分数与时间。登录作答的记录会关联你的账号，管理员可查看成绩与答案。正式通过后，昵称、分数、签发时间和规则版本可通过证书编号公开查询；邮箱不会公开。证书仅证明本次问卷达标。
                    </p>
                  </details>
                  <label className="check-label">
                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />
                    <span>我已了解数据用途及公开验真范围，同意保存本次答题记录。</span>
                  </label>
                  <Button className="full-button" disabled={busy || !config.available} onClick={() => void start()}>
                    {busy ? '正在准备问卷…' : config.enabled ? '开始正式问卷' : '开始演示问卷'}
                    <ArrowRight size={18} />
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    );
  if (!attempt)
    return (
      <div className="page narrow">
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <Link className="text-link" to="/assessment">
              返回问卷入口 <ArrowRight size={18} />
            </Link>
          </>
        ) : (
          <Loading />
        )}
      </div>
    );
  if (attempt.result) return <ResultPage attempt={attempt} error={error} />;
  const q = attempt.questions[index];
  function move(to: number) {
    setIndex(to);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <div className="page quiz-page">
      <div className="breadcrumb">
        <Link to="/assessment">素质问卷</Link>
        <ChevronRight size={16} />
        {attempt.demo ? '演示答题' : '正式答题'}
      </div>
      <div className="quiz-layout">
        <aside className="quiz-sidebar">
          <span className="page-symbol lavender">
            <Fingerprint size={27} />
          </span>
          <h2>答题进度</h2>
          <p>{attempt.demo ? '演示模式 · 不签发正式证书' : '正式问卷 · 成绩保存至账号'}</p>
          <div className="sidebar-divider" />
          <div className="progress-label">
            <span>计分题进度</span>
            <strong>
              {completed} / {required}
            </strong>
          </div>
          <progress value={completed} max={required} aria-label="计分题完成进度" />
          <div className="question-dots">
            {attempt.questions.map((item, i) => (
              <button
                key={item.id}
                className={`${i === index ? 'current' : ''} ${answers[item.id] !== undefined ? 'answered' : ''}`}
                onClick={() => move(i)}
                aria-label={`第 ${i + 1} 题${answers[item.id] !== undefined ? '，已作答' : ''}`}
                aria-current={i === index ? 'step' : undefined}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="save-state" aria-live="polite">
            {saveState || '答案将自动保存'}
          </p>
          <p className="small subtle">
            有效至 {date(attempt.expiresAt)}
            <br />
            多选题须全部选对才得分，无倒扣。
            <br />
            提交后不可修改答案。
          </p>
        </aside>
        <section className="surface-card question-panel" aria-busy={busy}>
          <div key={q.id} className="question-body swap-panel">
            <div className="card-top">
              <span className="chip">
                {typeLabels[q.type]} · {q.points ? `${q.points} 分` : '选填 · 不计分'}
              </span>
              <span className="subtle">
                {String(index + 1).padStart(2, '0')} / {String(attempt.questions.length).padStart(2, '0')}
              </span>
            </div>
            <div className="question-category">{q.category}</div>
            <h1 ref={heading} tabIndex={-1} className="question-title">
              {q.prompt}
            </h1>
            <p className="question-hint">
              {q.type === 'multiple'
                ? '请选择所有符合的选项。全部选对得分，少选或错选不得分。'
                : q.type === 'text' || q.type === 'scale'
                  ? '没有标准答案，你可以分享真实的想法，也可以跳过。'
                  : '请选择一个最符合的选项。'}
            </p>
            <QuestionInput question={q} value={answers[q.id]} onChange={answer} disabled={busy} />
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <div className="question-actions">
            <Button variant="text" disabled={index === 0 || busy} onClick={() => move(index - 1)}>
              <ArrowLeft size={17} />
              上一题
            </Button>
            {index < attempt.questions.length - 1 ? (
              <Button disabled={busy} onClick={() => move(index + 1)}>
                下一题
                <ArrowRight size={17} />
              </Button>
            ) : (
              <Button disabled={busy || completed !== required} onClick={() => confirmation.current?.showModal()}>
                {busy ? '正在评分…' : '提交并查看结果'}
                <Check size={17} />
              </Button>
            )}
          </div>
          {index === attempt.questions.length - 1 && completed < required && (
            <p className="small subtle">还有 {required - completed} 道计分题未完成，可通过左侧题号返回。</p>
          )}
        </section>
      </div>
      <dialog ref={confirmation} className="m3-dialog" aria-labelledby="submit-title">
        <CheckCircle2 size={28} />
        <h2 id="submit-title">确认提交这份问卷？</h2>
        <p>已完成 {completed} 道计分题。提交后将显示成绩，答案不可修改。</p>
        <div className="dialog-actions">
          <Button variant="text" onClick={() => confirmation.current?.close()}>
            继续检查
          </Button>
          <Button onClick={() => void submit()}>确认提交</Button>
        </div>
      </dialog>
    </div>
  );
}
function QuestionInput({
  question: q,
  value,
  onChange,
  disabled
}: {
  question: PublicQuestion;
  value: Answers[string] | undefined;
  onChange: (value: Answers[string] | undefined) => void;
  disabled: boolean;
}) {
  if (q.type === 'text')
    return (
      <label className="field">
        你的想法
        <textarea
          value={typeof value === 'string' ? value : ''}
          maxLength={2000}
          rows={6}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder="写下你的想法（选填）"
        />
        <span className="field-help">最多 2000 字；请勿填写密码等敏感信息。</span>
      </label>
    );
  if (q.type === 'scale')
    return (
      <fieldset className="scale-field" disabled={disabled}>
        <legend className="sr-only">{q.prompt}</legend>
        <div className="scale-options">
          {[1, 2, 3, 4, 5].map(n => (
            <label key={n} className={value === n ? 'selected' : ''}>
              <input type="radio" name={q.id} checked={value === n} onChange={() => onChange(n)} />
              <span>{n}</span>
            </label>
          ))}
        </div>
        <div className="scale-labels">
          <span>不认同</span>
          <span>非常认同</span>
        </div>
        <Button variant="text" onClick={() => onChange(undefined)} disabled={disabled}>
          清除选择
        </Button>
      </fieldset>
    );
  return (
    <fieldset className="answer-options" disabled={disabled}>
      <legend className="sr-only">{q.prompt}</legend>
      {q.options.map((option, i) => {
        const checked = Array.isArray(value) && value.includes(i);
        return (
          <label className={`answer-option ${checked ? 'selected' : ''}`} key={`${q.id}-${i}`}>
            <input
              type={q.type === 'multiple' ? 'checkbox' : 'radio'}
              name={q.id}
              checked={checked}
              onChange={() => {
                if (q.type !== 'multiple') onChange([i]);
                else {
                  const current = Array.isArray(value) ? value : [];
                  const next = checked ? current.filter(v => v !== i) : [...current, i];
                  onChange(next.length ? next : undefined);
                }
              }}
            />
            <span className="option-letter">{String.fromCharCode(65 + i)}</span>
            <span>{option}</span>
            {checked && <Check className="answer-check" size={19} />}
          </label>
        );
      })}
    </fieldset>
  );
}
function ResultPage({ attempt, error: inheritedError }: { attempt: Attempt; error: string }) {
  const r = attempt.result!;
  const [error, setError] = useState(inheritedError);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/attempts/${attempt.id}/certificate.png`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `IPlusPlus-${r.demo ? 'DEMO' : r.certificateId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page result-page">
      <div className="result-heading">
        <span className={`page-symbol ${r.passed ? 'mint' : 'peach'}`}>
          {r.passed ? <Award size={32} /> : <SproutIcon />}
        </span>
        <h1>{r.passed ? '问卷已通过' : '未达到通过线'}</h1>
        <p>
          {r.passed
            ? r.demo
              ? '你已达到演示问卷的通过标准。本次结果不具有正式认证效力。'
              : '你已通过本次社区规则问卷，可以下载你的证书。'
            : '本次尚未达到通过标准。可以重新思考社区共识，再次尝试。'}
        </p>
      </div>
      <div className="result-grid">
        <section className="surface-card score-card">
          <div className="score-ring">
            <strong>{r.score}</strong>
            <span>/ 100 分</span>
          </div>
          <h2>
            {r.demo ? '演示结果' : '审核结果'} · {r.passed ? '已通过' : '未通过'}
          </h2>
          <dl className="detail-list">
            <div>
              <dt>答题昵称</dt>
              <dd>{r.displayName}</dd>
            </div>
            <div>
              <dt>客观题得分</dt>
              <dd>
                {r.earned} / {r.total}
              </dd>
            </div>
            <div>
              <dt>通过标准</dt>
              <dd>{r.passScore} 分</dd>
            </div>
            <div>
              <dt>评分规则</dt>
              <dd>v{r.version}</dd>
            </div>
            <div>
              <dt>完成时间</dt>
              <dd>{date(r.issuedAt)}</dd>
            </div>
          </dl>
          <Link className="text-link" to="/assessment">
            <RotateCcw size={17} />
            重新答题
          </Link>
        </section>
        <section className="surface-card certificate-panel">
          {r.passed ? (
            <>
              <div className={`certificate-preview ${r.demo ? 'is-demo' : ''}`}>
                <div className="cert-brand">
                  i++ <span>CLUB</span>
                  <span className="cert-star">✳</span>
                </div>
                <p className="eyebrow">{r.demo ? 'DEMO · NOT A VALID CERTIFICATE' : 'CERTIFICATE OF ASSESSMENT'}</p>
                <h2>{r.demo ? '演示问卷 · 体验纪念' : '素质审核通过证书'}</h2>
                <div className="cert-name">{r.displayName}</div>
                <p>
                  已完成 I++ Club 社区规则问卷
                  <br />
                  本次得分 {r.score} / 100
                </p>
                <div className="cert-seal">
                  <ShieldCheck size={32} />
                </div>
                <div className="cert-meta">
                  {r.demo ? '演示记录，不具备正式认证效力' : `编号 ${r.certificateId}`}
                  <br />
                  {r.issuedAt.slice(0, 10)} · 规则 v{r.version}
                </div>
              </div>
              <div className="download-actions">
                <Button disabled={busy} onClick={() => void download()}>
                  <Download size={18} />
                  {busy ? '正在生成图片…' : r.demo ? '下载演示纪念图片' : '下载证书 PNG'}
                </Button>
                {r.certificateId && (
                  <Link className="text-link" to={`/verify/${r.certificateId}`}>
                    查看公开验真 <ArrowRight size={18} />
                  </Link>
                )}
              </div>
              <p className="small subtle">
                {r.demo ? '演示图片无正式证书编号。' : '下载图片内含验真二维码；最终有效性以在线记录为准。'}
              </p>
            </>
          ) : (
            <div className="not-passed">
              <Fingerprint size={64} />
              <h2>可以再试一次</h2>
              <p>问卷覆盖尊重、协作与安全三类共识。</p>
              <Link className="link-button" to="/assessment">
                再试一次 <ArrowRight size={18} />
              </Link>
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>
      </div>
      <Notice>证书仅证明本次问卷达标，不构成人格评价、实名身份核验或自动入社资格。昵称由答题者自行填写。</Notice>
    </div>
  );
}
function SproutIcon() {
  return <RotateCcw size={30} />;
}
