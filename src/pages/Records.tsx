import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, ShieldAlert } from 'lucide-react';
import type { Attempt, Result } from '../../shared/types';
import { api, Button, date, Loading, message, Notice } from '../ui';
import { useSwitchMotion } from '../motion';
export type RecordSummary = { id: string; displayName: string; email?: string; demo: boolean; createdAt: number; result: Result | null };
export function Records({ attempts, certificates, busy, onRevoke }: {
  attempts: RecordSummary[];
  certificates: { id: string; revoked: number }[];
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<(Attempt & { displayName: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const answerPane = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useSwitchMotion(answerPane, `${selected}:${detail?.id ?? 'loading'}:${error}`);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function select(id: string) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setSelected(id); setDetail(null); setError(''); setLoading(true);
    if (answerPane.current) answerPane.current.scrollTop = 0;
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    try {
      const record = await api<Attempt & { displayName: string }>(`/admin/attempts/${id}`);
      if (!request.signal.aborted) setDetail(record);
    } catch (e) { if (!request.signal.aborted) setError(message(e)); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  function back() {
    controller.current?.abort();
    const id = selected;
    setSelected(null); setDetail(null); setLoading(false); setError('');
    requestAnimationFrame(() => {
      const button = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-record-id]') ?? [])].find(b => b.dataset.recordId === id);
      button?.focus({ preventScroll: true });
    });
  }
  const summary = attempts.find(a => a.id === selected);
  const certificateId = summary?.result?.certificateId;
  const revoked = certificates.some(c => c.id === certificateId && c.revoked);
  return <section className="surface-card records-panel records-workspace">
    <div className="records-heading"><h2>答题与证书</h2><span className="subtle">最近 {attempts.length} 条记录</span></div>
    {!attempts.length ? <div className="empty"><ClipboardList size={32} /><p>暂无答题记录。</p></div> :
      <div className={`records-split ${selected ? 'has-selection' : ''}`}>
        <div ref={list} className="records-list" role="region" aria-label="答题记录列表" tabIndex={0}>
          <ul>{attempts.map(a => {
            const isRevoked = certificates.some(c => c.id === a.result?.certificateId && c.revoked);
            return <li key={a.id}><button data-record-id={a.id} aria-pressed={selected === a.id} className="record-choice" onClick={() => void select(a.id)}>
              <span className="record-choice-top"><strong>{a.displayName}</strong><span className="chip">{a.demo ? '演示' : '正式'}</span></span>
              {a.email && <span className="record-email">{a.email}</span>}
              <span className="record-choice-meta"><span>{date(a.createdAt)}</span><span>{a.result ? `${a.result.score} 分 · ${isRevoked ? '已撤销' : a.result.passed ? '通过' : '未通过'}` : '未提交'}</span></span>
            </button></li>;
          })}</ul>
        </div>
        <div ref={answerPane} className="records-answer" role="region" aria-label="答案详情" tabIndex={0} aria-busy={loading}>
          {selected ? <>
            <div className="records-answer-heading"><Button variant="text" onClick={back}><ArrowLeft size={16} />返回列表</Button><h3 ref={heading} tabIndex={-1}>{summary?.displayName ?? '答题记录'} 的答案</h3></div>
            {loading ? <Loading /> : error ? <><Notice tone="error">{error}</Notice><Button variant="outlined" onClick={() => void select(selected)}>重新加载</Button></> : detail && <>
              <div className="record-summary"><span>{detail.result ? `${detail.result.score} 分 · ${detail.result.passed ? '通过' : '未通过'}` : '未提交'}</span><span>{detail.demo ? '演示问卷' : '正式问卷'}</span>{summary && <span>{date(summary.createdAt)}</span>}</div>
              {certificateId && <div className="record-certificate"><span>{revoked ? '证书已撤销' : '证书有效'}</span><span className="record-certificate-id">{certificateId}</span>{!revoked && <Button variant="text" disabled={busy} onClick={() => onRevoke(certificateId)}><ShieldAlert size={16} />撤销证书</Button>}</div>}
              <ol className="record-answers">{detail.questions.map(q => {
                const a = detail.answers[q.id];
                return <li key={q.id}><h4>{q.prompt}</h4><p>{Array.isArray(a) ? a.map(n => q.options[n]).join('；') : a === undefined || a === '' ? '未作答' : String(a)}</p></li>;
              })}</ol>
            </>}
          </> : <div className="record-placeholder"><ClipboardList size={32} /><p>选择左侧记录，查看成绩与答案。</p></div>}
        </div>
      </div>}
  </section>;
}
