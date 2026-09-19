import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronDown, Search } from 'lucide-react';
import { PawMark } from '../components/Mascot';
import { PersonBook } from '../components/PersonBook';
import { DemoPeopleNotice, usePeople } from '../content/PeopleProvider';
import { Button, Loading } from '../ui';
export function People() {
  const { people, isDemo, loading } = usePeople();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [year, setYear] = useState('all');
  const years = useMemo(() => [...new Set(people.map(p => p.year))].sort((a, b) => a - b), [people]);
  const filtered = people
    .filter(
      p =>
        (group === 'all' || p.group === group) &&
        (year === 'all' || p.year === Number(year)) &&
        `${p.name} ${p.description} ${p.title}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
    .sort((a, b) => Number(b.lead) - Number(a.lead) || a.year - b.year);
  return (
    <div className="page people-page">
      <div className="collection-hero people-hero">
        <div>
          <h1>成员与支持者</h1>
          <p>这里收录参与创造、分享和支持 I++ 的人。</p>
        </div>
        <aside className="mascot-placeholder" aria-labelledby="mascot-placeholder-title">
          <div className="construction-sign">
            <span className="construction-mark" aria-hidden="true">
              ＋
            </span>
            <span className="construction-label">ILLUSTRATION IN PROGRESS</span>
            <h2 id="mascot-placeholder-title">站娘 · 待施工</h2>
            <p>等形象确定后再和大家见面。</p>
            <div className="construction-stripe" aria-hidden="true" />
          </div>
        </aside>
      </div>
      {isDemo && <DemoPeopleNotice />}
      {loading ? (
        <Loading />
      ) : people.length ? (
        <>
          <section className="people-filters" aria-label="筛选成员">
            <label className="collection-search">
              <Search size={19} />
              <input
                type="search"
                aria-label="搜索成员"
                placeholder="搜索名字、身份或兴趣…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <div className="filter-chips" role="group" aria-label="成员组别">
              {[
                ['all', '所有人'],
                ['core', '核心成员'],
                ['supporter', '支持者']
              ].map(([value, label]) => (
                <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="year-filter">
              年级
              <span className="year-select">
                <select data-active={year !== 'all'} value={year} onChange={e => setYear(e.target.value)}>
                  <option value="all">全部年级</option>
                  {years.map(y => (
                    <option key={y} value={y}>
                      {y} 级
                    </option>
                  ))}
                </select>
                <ChevronDown size={17} aria-hidden="true" />
              </span>
            </label>
          </section>
          <p className="collection-count" role="status">
            找到 {filtered.length} 位{isDemo ? '演示人物' : '伙伴'}
          </p>
          {filtered.length ? (
            <div key={`${group}-${year}`} className="people-sections swap-collection">
              {(['core', 'supporter'] as const).map(section => {
                const members = filtered.filter(p => p.group === section);
                return members.length ? (
                  <section key={section} aria-labelledby={`people-${section}`}>
                    <div className="shelf-heading">
                      <h2 id={`people-${section}`}>{section === 'core' ? '核心成员' : '支持者'}</h2>
                      <span>{members.length} 人</span>
                    </div>
                    <div className="people-grid">
                      {members.map(person => (
                        <PersonBook key={person.id} person={person} />
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
            </div>
          ) : (
            <div className="collection-empty">
              <PawMark />
              <h2>这一页还没有找到。</h2>
              <p>试试其他名字，或放宽筛选条件。</p>
              <Button
                variant="outlined"
                onClick={() => {
                  setSearch('');
                  setGroup('all');
                  setYear('all');
                }}
              >
                清除筛选
              </Button>
            </div>
          )}
        </>
      ) : (
        <section className="collection-empty surface-card">
          <PawMark />
          <h2>名录整理中</h2>
          <p>真实成员与支持者信息将在确认后收录。</p>
          <Link className="text-link" to="/projects">
            逛逛项目工坊 <ArrowRight size={17} />
          </Link>
        </section>
      )}
    </div>
  );
}
