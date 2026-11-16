import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Account } from '../shared/accounts';
import { api } from './ui';
const Context = createContext<{ user: Account | null; ready: boolean; refresh: () => Promise<void> }>({ user: null, ready: false, refresh: async () => {} });
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  async function refresh() {
    const data = await api<{ user: Account | null }>('/auth/me');
    setUser(data.user); setReady(true);
  }
  useEffect(() => { void refresh().catch(() => setReady(true)); }, []);
  return <Context.Provider value={{ user, ready, refresh }}>{children}</Context.Provider>;
}
export const useAccount = () => useContext(Context);
