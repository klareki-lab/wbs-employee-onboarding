import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, clearCsrf } from '../api/client';
import type { AuthUser, AuthEmployee } from '../api/types';

type AuthStatus = 'checking' | 'guest' | 'authenticated' | 'unavailable';
interface AuthContextValue {
  user: AuthUser | null;
  employee: AuthEmployee | null;
  status: AuthStatus;
  refresh: () => Promise<AuthUser | null>;
  signIn: (username: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [employee, setEmployee] = useState<AuthEmployee | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const refresh = useCallback(async () => {
    setStatus('checking');
    try {
      const result = await api.me();
      if (!result?.user?.id || !['hr', 'employee'].includes(result.user.role) ||
          (result.user.role === 'employee' && !result.employee?.first_name)) {
        throw new Error('Ung\u00fcltiges Sitzungsprofil.');
      }
      setUser(result.user);
      setEmployee(result.employee);
      setStatus('authenticated');
      return result.user;
    } catch (error) {
      setUser(null); setEmployee(null); clearCsrf();
      if (error instanceof ApiError && error.status === 401) {
        setStatus('guest');
        return null;
      }
      setStatus('unavailable');
      throw error;
    }
  }, []);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const login = await api.login({ username, password });
    if (!login.user?.id) throw new Error('Anmeldung konnte nicht best\u00e4tigt werden.');
    const verified = await refresh();
    if (!verified) throw new Error('Anmeldung konnte nicht best\u00e4tigt werden.');
    return verified;
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.logout(); // Do not claim success until the server confirms logout.
    setUser(null); setEmployee(null);
    setStatus('guest');
  }, []);
  const value = useMemo(() => ({ user, employee, status, refresh, signIn, signOut }), [user, employee, status, refresh, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requires AuthProvider');
  return auth;
}
