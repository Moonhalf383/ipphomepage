import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Fingerprint,
  Gamepad2,
  Home as HomeIcon,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { Home } from './pages/Home';
import { Assessment } from './pages/Assessment';
import { Verify } from './pages/Verify';
import { Admin } from './pages/Admin';
import { Account } from './pages/Account';
import { AccountProvider, useAccount } from './AccountProvider';
import { People } from './pages/People';
import { Projects } from './pages/Projects';
import { Events } from './pages/Events';
import { Consensus } from './pages/Consensus';
import { PeopleProvider } from './content/PeopleProvider';
import { projects, projectCategories } from './content';
import { PawMark } from './components/Mascot';
import { ExternalLink } from './ui';
import { ThemeControls } from './theme/ThemeControls';
import { applyPreferences, readPreferences } from './theme/preferences';
import { usePageMotion } from './motion';
import '@fontsource/noto-serif-sc/600.css';
import './styles.css';
import './motion.css';
import './theme/theme.css';
import './community.css';
import './accounts.css';
applyPreferences(readPreferences(), false);
function App() {
  const { user } = useAccount();
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The panel hangs in a gap below the nav pill; a grace period keeps a diagonal pointer path alive.
  const openMenu = () => {
    clearTimeout(closeTimer.current);
    setMenu(true);
  };
  const closeMenu = (delay = 0) => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(false), delay);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => setMenu(false), [location.pathname, location.search]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, []);
  usePageMotion(main, location.pathname);
  useEffect(() => {
    document.title = `${location.pathname.startsWith('/account') ? '我的账号' : location.pathname.startsWith('/assessment') ? '素质问卷' : location.pathname.startsWith('/verify') ? '证书验真' : location.pathname.startsWith('/admin') ? '社团管理' : location.pathname.startsWith('/people') ? '成员名录' : location.pathname.startsWith('/projects') ? '项目工坊' : location.pathname.startsWith('/events') ? '赛事展台' : location.pathname.startsWith('/consensus') ? '社区共识' : '让好奇心，不断加一'} · I++ Club`;
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="I++ Club 首页">
          <span className="brand-mark">
            i<span>++</span>
          </span>
          <span>I++ Club</span>
        </Link>
        <div className="nav-zone" onMouseLeave={() => closeMenu(220)}>
          <nav className="main-nav" aria-label="主导航">
            <NavLink to="/" end onMouseEnter={() => closeMenu()}>
              <HomeIcon size={21} aria-hidden="true" />
              <span>首页</span>
            </NavLink>
            <NavLink
              to="/projects"
              aria-expanded={menu}
              onMouseEnter={openMenu}
              onFocus={openMenu}
              onClick={() => closeMenu()}
            >
              <Gamepad2 size={21} aria-hidden="true" />
              <span>项目工坊</span>
              <ChevronDown size={15} className="nav-caret" aria-hidden="true" />
            </NavLink>
            <NavLink to="/people" onMouseEnter={() => closeMenu()} onFocus={() => closeMenu()}>
              <BookOpen size={21} aria-hidden="true" />
              <span>成员名录</span>
            </NavLink>
            <NavLink to="/assessment" onMouseEnter={() => closeMenu()} onFocus={() => closeMenu()}>
              <Fingerprint size={21} aria-hidden="true" />
              <span>素质问卷</span>
            </NavLink>
            <NavLink to="/verify" onMouseEnter={() => closeMenu()} onFocus={() => closeMenu()}>
              <ShieldCheck size={21} aria-hidden="true" />
              <span>证书验真</span>
            </NavLink>
          </nav>
          {/* Category links live outside .main-nav so the five primary destinations stay countable. */}
          <div className="nav-menu" hidden={!menu} onMouseEnter={openMenu}>
            <div className="nav-menu-col">
              <p className="nav-menu-head">按分类</p>
              <Link to="/projects" onClick={() => closeMenu()}>
                全部项目
              </Link>
              {Object.entries(projectCategories).map(([value, label]) => (
                <Link key={value} to={`/projects?category=${value}`} onClick={() => closeMenu()}>
                  {label}
                </Link>
              ))}
            </div>
            <div className="nav-menu-col">
              <p className="nav-menu-head">项目</p>
              {projects.map(project => (
                <Link key={project.id} to={`/projects?category=${project.category}`} onClick={() => closeMenu()}>
                  {project.name}
                </Link>
              ))}
            </div>
            <div className="nav-menu-col">
              <p className="nav-menu-head">相关链接</p>
              <a href="https://github.com/IppClub" target="_blank" rel="noopener noreferrer">
                官方 GitHub
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <a href="https://dora-ssr.net/docs/tutorial/quick-start" target="_blank" rel="noopener noreferrer">
                快速入门
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <a href="https://github.com/IppClub/Dora-Example" target="_blank" rel="noopener noreferrer">
                Dora 示例
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <Link className="account-link" to="/account">{user ? '我的账号' : '登录 / 注册'}</Link>
          <ExternalLink href="https://ippclub.org/" className="header-blog">
            社团博客
          </ExternalLink>
          <ThemeControls />
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/people" element={<People />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/events" element={<Events />} />
          <Route path="/consensus" element={<Consensus />} />
          <Route path="/assessment" element={<Assessment />} />
          <Route path="/assessment/:id" element={<Assessment />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:id" element={<Verify />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/account" element={<Account />} />
          <Route path="/account/admin" element={<Navigate to="/account?next=/admin" replace />} />
          <Route
            path="*"
            element={
              <section className="page narrow empty">
                <Sparkles size={40} />
                <h1>页面不存在</h1>
                <p>这个地址没有对应的页面。</p>
                <Link className="link-button" to="/">
                  返回首页 <ArrowUpRight size={18} />
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <div>
          <Link className="footer-brand" to="/">
            I++ Club
          </Link>
        </div>
        <div className="footer-links">
          <ExternalLink href="https://github.com/IppClub">GitHub</ExternalLink>
          <ExternalLink href="https://ippclub.org/">博客</ExternalLink>
          <ExternalLink href="https://ippclub.org/blogroll/">Blogroll</ExternalLink>
          <Link to="/people">成员名录</Link>
          <Link to="/events">赛事展台</Link>
          <Link to="/consensus">社区共识</Link>
          <Link to="/admin">社团管理</Link>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} I++ Club</span>
          <span>
            iplusplus.club <PawMark className="footer-paw" />
          </span>
        </div>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PeopleProvider>
        <AccountProvider><App /></AccountProvider>
      </PeopleProvider>
    </BrowserRouter>
  </React.StrictMode>
);
