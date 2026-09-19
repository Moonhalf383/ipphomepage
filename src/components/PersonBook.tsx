import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, MoreHorizontal, X } from 'lucide-react';
import type { Person } from '../../shared/content';
import { Button, ExternalLink } from '../ui';
function Avatar({ person }: { person: Person }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person.avatar]);
  return (
    <span className={`person-avatar ${person.lead ? 'lead-avatar' : ''}`}>
      {failed ? (
        <span className="avatar-fallback" aria-hidden="true">
          {[...person.name.trim()][0] ?? '?'}
        </span>
      ) : (
        <img src={person.avatar} alt="" width={64} height={64} loading="lazy" onError={() => setFailed(true)} />
      )}
    </span>
  );
}
export function PersonBook({ person }: { person: Person }) {
  const [panel, setPanel] = useState<'profile' | 'links' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tone = [...person.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  useEffect(() => {
    if (panel) dialog.current?.showModal();
  }, [panel]);
  function close() {
    dialog.current?.close();
    setPanel(null);
  }
  return (
    <div className="person-book-hitbox">
      <article
        className={`person-book ${person.links.length ? 'has-bookmarks' : ''}`}
        data-tone={tone}
        data-person-id={person.id}
      >
      <div className="person-spine" aria-hidden="true">
        <span>{person.year}</span>
        <span>I++</span>
      </div>
      <div className="person-cover" aria-hidden="true">
        <span>ONE OF US</span>
        <span>++</span>
      </div>
      <div className="person-content">
        <Avatar person={person} />
        <h3>{person.name}</h3>
        <span className="person-title">{person.title}</span>
        <p className="person-year">
          {person.year} 级 · {person.group === 'core' ? '核心成员' : '支持者'}
        </p>
        <p className="person-description">{person.description}</p>
        <Button variant="text" onClick={() => setPanel('profile')} aria-label={`查看${person.name}的完整简介`}>
          <BookOpen size={15} />
          查看简介
        </Button>
      </div>
      {!!person.links.length && (
        <nav className="person-bookmarks" aria-label={`${person.name}的相关链接`}>
          {person.links.slice(0, 3).map((link, i) => (
            <ExternalLink key={`${link.url}-${i}`} className="person-bookmark" href={link.url}>
              <span className="bookmark-label" title={link.label}>
                {link.label}
              </span>
            </ExternalLink>
          ))}
          {person.links.length > 3 && (
            <button
              className="person-bookmark bookmark-more"
              aria-label={`查看${person.name}的全部${person.links.length}条链接`}
              onClick={() => setPanel('links')}
            >
              <MoreHorizontal size={16} />
              更多 {person.links.length - 3}
            </button>
          )}
        </nav>
      )}
      <dialog ref={dialog} className="m3-dialog person-dialog" aria-labelledby={titleId} onClose={() => setPanel(null)}>
        <div className="card-top">
          <Avatar person={person} />
          <button className="icon-button" aria-label="关闭成员详情" onClick={close}>
            <X size={21} />
          </button>
        </div>
        <h2 id={titleId}>
          {person.name}
          {panel === 'links' ? '的相关链接' : ''}
        </h2>
        <p className="small subtle">
          {person.title} · {person.year} 级 · {person.group === 'core' ? '核心成员' : '支持者'}
        </p>
        {panel === 'profile' && <p className="person-full-description">{person.description}</p>}
        {!!person.links.length && (
          <div className="profile-links">
            {person.links.map((link, i) => (
              <ExternalLink key={`${link.url}-${i}`} href={link.url}>
                {link.label}
              </ExternalLink>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <Button onClick={close}>关闭</Button>
        </div>
      </dialog>
      </article>
    </div>
  );
}
