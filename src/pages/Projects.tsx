import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Code2, Github, Trophy } from 'lucide-react';
import { projects, projectCategories } from '../content';
import { ProjectCard } from '../components/ProjectCard';
import { ExternalLink } from '../ui';
export function Projects() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('category');
  const category = requested && requested in projectCategories ? requested : 'all';
  const setCategory = (next: string) => setParams(next === 'all' ? {} : { category: next }, { replace: true });
  const visible = projects.filter(p => category === 'all' || p.category === category);
  return (
    <div className="page projects-page">
      <div className="collection-hero">
        <div>
          <h1>我们做的项目</h1>
          <p>这里收录 IppClub 与相关社区的项目。</p>
        </div>
        <div className="project-hero-symbol" aria-hidden="true">
          <span>
            {'{'}
            <b>++</b>
            {'}'}
          </span>
        </div>
      </div>
      <div className="collection-toolbar">
        <div className="filter-chips" role="group" aria-label="项目分类">
          <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            全部项目
          </button>
          {Object.entries(projectCategories).map(([value, label]) => (
            <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>
              {label}
            </button>
          ))}
        </div>
        <ExternalLink className="text-link" href="https://github.com/IppClub">
          <Github size={17} />
          官方 GitHub
        </ExternalLink>
      </div>
      <div key={category} className="project-gallery swap-collection">
        {visible.map(p => (
          <ProjectCard key={p.id} project={p} featured={p.id === 'dora-ssr' && category === 'all'} />
        ))}
      </div>
      {!visible.length && <p className="collection-empty">这一类项目暂未收录。</p>}
      <div className="creation-path-hitbox">
        <section className="creation-path" aria-labelledby="creation-title">
          <div>
            <h2 id="creation-title">上手 Dora SSR</h2>
          </div>
          <div className="creation-links">
            <ExternalLink href="https://dora-ssr.net/docs/tutorial/quick-start">
              <BookOpen size={20} />
              <span>01 / 阅读入门文档</span>
            </ExternalLink>
            <ExternalLink href="https://github.com/IppClub/Dora-Example">
              <Code2 size={20} />
              <span>02 / 动手修改示例</span>
            </ExternalLink>
            <Link to="/events">
              <Trophy size={20} />
              <span>03 / 关注赛事展台</span>
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </div>
      <p className="collection-footer-note">项目说明依据官方仓库整理，许可细节以各仓库为准。</p>
    </div>
  );
}
