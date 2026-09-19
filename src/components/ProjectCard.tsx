import { useId, useState, type CSSProperties } from 'react';
import { Code2, ExternalLink as LinkIcon } from 'lucide-react';
import type { Project } from '../../shared/content';
import { projectCategories } from '../content';
import { ExternalLink } from '../ui';
export function ProjectArtwork({ project }: { project: Project }) {
  const [failed, setFailed] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  // textLength pins each line's width, so the reveal mask and the caret travel exactly as far as the glyphs do.
  const codeLines = [
    { y: 121, fill: '#cdbde9', text: '-- a little more expressive', width: 297 },
    { y: 157, fill: '#bde0ce', text: 'idea → code → play', width: 198 },
    project.id === 'yuescript'
      ? { y: 194, fill: '#f6d3b4', text: 'YueScript → Lua', width: 165 }
      : { y: 194, fill: '#f6d3b4', text: 'create. share. repeat.', width: 231 }
  ];
  if (project.cover && !failed)
    return (
      <div className="project-art custom-cover">
        <img src={project.cover} alt={project.coverAlt ?? ''} loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  const kind =
    project.illustration ??
    (project.category === 'language'
      ? 'code'
      : project.category === 'framework'
        ? 'story'
        : project.category === 'game'
          ? 'game'
          : 'engine');
  return (
    <div className={`project-art project-art-${kind}`}>
      <svg viewBox="0 0 480 280" aria-hidden="true" focusable="false">
        <rect
          x="48"
          y="31"
          width="384"
          height="216"
          rx="16"
          fill="var(--art-paper)"
          stroke="var(--art-primary-shadow)"
          strokeWidth="2"
        />
        <path d="M48 70h384" stroke="var(--art-primary-shadow)" />
        <g fill="var(--art-primary-shadow)">
          <circle cx="68" cy="51" r="4" />
          <circle cx="83" cy="51" r="4" />
          <circle cx="98" cy="51" r="4" />
        </g>
        {kind === 'code' ? (
          <>
            <rect x="64" y="85" width="352" height="145" rx="9" fill="#292735" />
            <defs>
              {codeLines.map((line, i) => (
                <clipPath key={i} id={`${uid}-type-${i}`}>
                  <rect
                    className="type-reveal"
                    style={{ '--type-line': i } as CSSProperties}
                    x="88"
                    y={line.y - 17}
                    width={line.width}
                    height="24"
                  />
                </clipPath>
              ))}
            </defs>
            <g fontFamily="monospace" fontSize="19">
              {codeLines.map((line, i) => (
                <text
                  key={i}
                  x="88"
                  y={line.y}
                  fill={line.fill}
                  textLength={line.width}
                  clipPath={`url(#${uid}-type-${i})`}
                >
                  {line.text}
                </text>
              ))}
            </g>
            {codeLines.map((line, i) => (
              <path
                key={i}
                className="type-caret"
                style={{ '--type-line': i, '--type-width': `${line.width}px` } as CSSProperties}
                d={`M88 ${line.y - 16}v19`}
                stroke="#f6d3b4"
                strokeWidth="8"
              />
            ))}
            <path
              className="project-cursor"
              d={`M${88 + codeLines[2].width} 178v19`}
              stroke="#f6d3b4"
              strokeWidth="8"
            />
          </>
        ) : kind === 'story' ? (
          <>
            <rect x="64" y="85" width="352" height="145" rx="9" fill="var(--art-mint)" />
            <circle cx="335" cy="116" r="16" fill="var(--art-paper)" />
            <path d="M64 169q89-81 170-7 90-82 182-6v74H64" fill="var(--art-mint-shadow)" />
            <rect x="90" y="155" width="297" height="56" rx="12" fill="var(--art-paper)" stroke="var(--art-on-mint)" />
            <path d="M111 174h142m-142 16h202" stroke="var(--art-on-mint)" strokeWidth="3" strokeLinecap="round" />
            <path d="m361 188 8 5-8 5" fill="var(--art-on-mint)" />
          </>
        ) : kind === 'engine' ? (
          <>
            <rect
              x="64"
              y="85"
              width="232"
              height="145"
              rx="9"
              fill="var(--art-paper)"
              stroke="var(--art-primary-shadow)"
              strokeWidth="2"
            />
            <g stroke="var(--art-primary-shadow)" strokeWidth="1.5" fill="none" opacity=".5">
              <path d="M170 112 270 162 170 212 70 162Z" />
              <path d="M103 145 203 195M137 129 237 179M103 179 203 129M137 195 237 145" />
            </g>
            <g className="project-axes" strokeWidth="3" strokeLinecap="round" fill="none">
              <path d="M170 141 230 171" stroke="var(--art-on-peach)" />
              <path d="M170 141 110 171" stroke="var(--art-on-primary)" />
              <path d="M170 141 170 89" stroke="var(--art-on-mint)" />
            </g>
            <foreignObject x="110" y="81" width="120" height="120">
              <div className="cube-stage">
                <div className="cube">
                  <i className="cube-face cf-top" />
                  <i className="cube-face cf-bottom" />
                  <i className="cube-face cf-front" />
                  <i className="cube-face cf-back" />
                  <i className="cube-face cf-right" />
                  <i className="cube-face cf-left" />
                </div>
              </div>
            </foreignObject>
            <rect x="308" y="85" width="108" height="145" rx="9" fill="#292735" />
            <g fill="#cdbde9">
              <rect x="322" y="101" width="80" height="9" rx="4" />
              <rect x="322" y="122" width="54" height="6" rx="3" />
              <rect x="322" y="138" width="68" height="6" rx="3" />
            </g>
            <g fill="#bde0ce">
              <rect x="322" y="162" width="46" height="6" rx="3" />
              <rect x="322" y="178" width="62" height="6" rx="3" />
            </g>
            <rect x="322" y="201" width="80" height="4" rx="2" fill="#f6d3b4" />
            <circle
              className="project-knob"
              cx="366"
              cy="203"
              r="7"
              fill="var(--art-peach)"
              stroke="var(--art-on-peach)"
              strokeWidth="2"
            />
          </>
        ) : (
          <>
            <rect x="64" y="85" width="352" height="145" rx="9" fill="var(--art-mint)" />
            <circle cx="347" cy="111" r="18" fill="var(--art-paper)" />
            <path d="m64 189 67-66 64 60 76-66 80 71 65-43v85H64" fill="var(--art-mint-shadow)" />
            <g fill="var(--art-on-mint)">
              <rect x="88" y="203" width="102" height="12" rx="4" />
              <rect x="220" y="169" width="65" height="12" rx="4" />
              <rect x="316" y="141" width="71" height="12" rx="4" />
            </g>
            <g className="project-player">
              <path
                d="M137 174v-18l10 6 10-6v18Z"
                fill="var(--art-primary)"
                stroke="var(--art-on-primary)"
                strokeWidth="2"
              />
              <path d="m140 180-3 14m18-14 4 14" stroke="var(--art-on-primary)" strokeWidth="3" strokeLinecap="round" />
            </g>
            <path
              className="project-star"
              d="m250 106 4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1Z"
              fill="var(--art-peach)"
              stroke="var(--art-on-peach)"
              strokeWidth="2"
            />
          </>
        )}
        <rect x="16" y="213" width="103" height="39" rx="12" fill="var(--art-primary)" stroke="var(--art-on-primary)" />
        <text x="35" y="238" fill="var(--art-on-primary)" fontFamily="monospace" fontSize="16">
          {kind === 'code' ? 'code ++' : kind === 'story' ? 'story ++' : kind === 'engine' ? 'build ++' : 'play ++'}
        </text>
      </svg>
    </div>
  );
}
export function ProjectCard({
  project,
  featured = false,
  compact = false
}: {
  project: Project;
  featured?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`project-card-hitbox ${featured ? 'is-featured' : ''} ${compact ? 'is-compact' : ''}`}>
      <article
        className={`project-card ${featured ? 'featured-project' : ''} ${compact ? 'compact-project' : ''}`}
        data-project-id={project.id}
      >
        <ProjectArtwork project={project} />
        <div className="project-copy">
        <div className="project-category">
          <Code2 size={16} />
          {projectCategories[project.category]}
          {featured && <span>FEATURED</span>}
        </div>
        <h3>{project.name}</h3>
        <p className="project-summary">{project.summary}</p>
        <p className="project-relationship">{project.relationship}</p>
        <div className="project-tags">
          {project.tags.map(tag => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="project-links">
          {project.links.map((link, i) => (
            <ExternalLink key={`${link.url}-${i}`} href={link.url}>
              {link.label}
            </ExternalLink>
          ))}
        </div>
        {!compact && (
          <details className="project-license">
            <summary>项目资料与使用提醒</summary>
            <p>{project.licenseNote}</p>
            <ExternalLink href={project.sourceUrl}>
              <LinkIcon size={14} />
              查阅项目说明
            </ExternalLink>
          </details>
        )}
        </div>
      </article>
    </div>
  );
}
