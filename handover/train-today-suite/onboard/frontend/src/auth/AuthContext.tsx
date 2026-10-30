import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, setCsrfToken } from '../api/client';
import type { AuthUser, AuthEmployee } from '../api/types';
import { SessionController, type AuthStatus } from './session';

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
  const channel = useRef<BroadcastChannel | null>(null);
  const [controller] = useState(() => new SessionController(api, setCsrfToken, () => channel.current?.postMessage('session-changed')));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    const refresh = () => { if (!controller.isMutating) void controller.refresh().catch(() => undefined); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('wbs-onboarding-auth');
      channel.current.onmessage = event => { if (event.data === 'session-changed') void controller.refresh().catch(() => undefined); };
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
      channel.current?.close(); channel.current = null;
    };
  }, [controller]);
  const value = useMemo(() => ({ ...snapshot, refresh: controller.refresh, signIn: controller.signIn, signOut: controller.signOut }), [snapshot, controller]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requires AuthProvider');
  return auth;
}
