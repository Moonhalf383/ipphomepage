import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Flag, MapPin, Trophy } from 'lucide-react';
import type { ClubEvent } from '../../shared/content';
import { events, eventRoles, eventStatuses } from '../content';
import { ExternalLink } from '../ui';
import { PawMark } from '../components/Mascot';
export function eventDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}.${month}.${day}`;
}
function EventCard({ event }: { event: ClubEvent }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="surface-card-hitbox">
      <article className="event-card surface-card">
      <div className="event-date">
        <CalendarDays size={22} />
        <strong>{event.startDate.slice(0, 4)}</strong>
        <span>{event.startDate.slice(5).replace('-', '.')}</span>
      </div>
      <div className="event-copy">
        <div className="event-labels">
          <span className="chip">{eventStatuses[event.status]}</span>
          <span>IppClub · {eventRoles[event.role]}</span>
        </div>
        <h2>{event.name}</h2>
        <p>{event.summary}</p>
        <div className="event-facts">
          <span>
            <CalendarDays size={16} />
            {eventDate(event.startDate)}
            {event.endDate && event.endDate !== event.startDate && ` — ${eventDate(event.endDate)}`}
          </span>
          {event.location && (
            <span>
              <MapPin size={16} />
              {event.location}
            </span>
          )}
        </div>
        <div className="project-links">
          {event.links.map((link, i) => (
            <ExternalLink key={`${link.url}-${i}`} href={link.url}>
              {link.label}
            </ExternalLink>
          ))}
        </div>
      </div>
      {event.cover && !failed && (
        <img
          className="event-cover"
          src={event.cover}
          alt={event.coverAlt ?? ''}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      </article>
    </div>
  );
}
export function Events() {
  const [status, setStatus] = useState('all');
  const visible = events
    .filter(e => status === 'all' || e.status === status)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <div className="page events-page">
      <div className="collection-hero">
        <div>
          <h1>赛事展台</h1>
          <p>记录社团主办、承办与参与支持的赛事。</p>
        </div>
        <div className="event-hero-art" aria-hidden="true">
          <span className="event-pennant">
            <Flag size={52} />
          </span>
          <span className="event-paw">
            <PawMark />
          </span>
          <span className="event-plus">++</span>
        </div>
      </div>
      {events.length ? (
        <>
          <div className="filter-chips event-filters" role="group" aria-label="赛事状态">
            <button aria-pressed={status === 'all'} onClick={() => setStatus('all')}>
              全部赛事
            </button>
            {Object.entries(eventStatuses).map(([value, label]) => (
              <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
          <p className="collection-count" role="status">
            已收录 {visible.length} 场赛事
          </p>
          <div key={status} className="event-list swap-collection">
            {visible.map(e => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
          {!visible.length && (
            <div className="collection-empty">
              <Trophy size={36} />
              <h2>这个分类还没有赛事。</h2>
              <p>可以切换到“全部赛事”查看其他记录。</p>
            </div>
          )}
        </>
      ) : (
        <div className="surface-card-hitbox">
          <section className="events-empty surface-card">
            <div className="empty-ticket" aria-hidden="true">
              <span>I++ / NEXT CHAPTER</span>
              <Trophy size={46} />
              <div />
            </div>
            <div>
              <span className="chip">赛事展台已预留</span>
              <h2>还没有赛事记录</h2>
              <p>
                <strong>目前暂无已公布赛事。</strong>
                <br />
                确定举办信息后，这里会展示介绍、时间、社团参与身份与相关链接。
              </p>
              <Link className="text-link" to="/projects">
                先逛逛项目工坊 <ArrowRight size={18} />
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
