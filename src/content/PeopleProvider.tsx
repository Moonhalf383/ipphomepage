import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Person } from '../../shared/content';
import { realPeople } from './index';
const PeopleContext = createContext<{ people: Person[]; isDemo: boolean; loading: boolean }>({
  people: realPeople,
  isDemo: false,
  loading: false
});
// 开发演示成员：people.json 为空时自动启用。
// 名单非空后仍需要演示数据的场景（e2e 回归），用 localStorage['ipp:demo-people']='1' 显式打开，
// 这样测试断言不会随着真实成员增减而失效。
function wantsDemoPeople() {
  if (!import.meta.env.DEV) return false;
  if (!realPeople.length) return true;
  try {
    return localStorage.getItem('ipp:demo-people') === '1';
  } catch {
    return false;
  }
}
export function PeopleProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState({
    people: realPeople,
    isDemo: false,
    loading: wantsDemoPeople()
  });
  useEffect(() => {
    let active = true;
    if (import.meta.env.DEV && wantsDemoPeople()) {
      import('../dev/mockPeople')
        .then(module => {
          if (active) setData({ people: module.makeMockPeople(), isDemo: true, loading: false });
        })
        .catch(error => {
          console.error('开发演示成员加载失败', error);
          if (active) setData({ people: [], isDemo: false, loading: false });
        });
    } else setData({ people: realPeople, isDemo: false, loading: false });
    return () => {
      active = false;
    };
  }, [realPeople]);
  return <PeopleContext.Provider value={data}>{children}</PeopleContext.Provider>;
}
export function usePeople() {
  return useContext(PeopleContext);
}
export function DemoPeopleNotice() {
  return (
    <div className="demo-people-notice">
      <span className="dev-dot" />
      开发演示数据 · 下方人物均为虚构，不代表真实成员或支持者。
    </div>
  );
}
