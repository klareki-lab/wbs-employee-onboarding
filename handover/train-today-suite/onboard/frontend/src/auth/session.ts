import type { AuthEmployee, AuthMeResponse, AuthUser, LoginRequest, LoginResponse } from '../api/types.ts';

export type AuthStatus = 'checking' | 'guest' | 'authenticated' | 'unavailable';
export interface AuthSnapshot { user: AuthUser | null; employee: AuthEmployee | null; status: AuthStatus }
interface AuthApi {
  login(input: LoginRequest): Promise<LoginResponse>;
  me(): Promise<AuthMeResponse>;
  logout(): Promise<{ logged_out: boolean }>;
}
const guest: AuthSnapshot = { user: null, employee: null, status: 'guest' };
const changed = () => Object.assign(new Error('Die Sitzung hat sich geändert. Bitte erneut prüfen.'), { code: 'SESSION_CHANGED' });
function validateProfile(profile: AuthMeResponse) {
  const user = profile?.user;
  if (!user?.id || !user.username || !profile.csrf_token || !['hr', 'employee'].includes(user.role) ||
      (user.role === 'hr' && (user.employee_id !== null || profile.employee !== null)) ||
      (user.role === 'employee' && (!user.employee_id || profile.employee?.id !== user.employee_id || !profile.employee.first_name))) {
    throw new Error('Ungültiges Sitzungsprofil. Bitte erneut anmelden.');
  }
}

/** Only the latest auth operation may publish an identity or its CSRF token. */
export class SessionController {
  private snapshot: AuthSnapshot = { ...guest, status: 'checking' };
  private revision = 0;
  private csrf: string | null = null;
  private listeners = new Set<() => void>();
  private api: AuthApi;
  private setCsrf: (value: string | null) => void;
  private notify: () => void;
  isMutating = false;
  constructor(api: AuthApi, setCsrf: (value: string | null) => void, notify: () => void = () => {}) {
    this.api = api; this.setCsrf = setCsrf; this.notify = notify;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: AuthSnapshot, csrf: string | null) {
    this.csrf = csrf; this.setCsrf(csrf); this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }
  private accept(profile: AuthMeResponse) {
    validateProfile(profile);
    this.publish({ user: profile.user, employee: profile.employee, status: 'authenticated' }, profile.csrf_token);
  }
  refresh = async (): Promise<AuthUser | null> => {
    const revision = ++this.revision;
    this.publish({ ...guest, status: 'checking' }, null);
    try {
      const profile = await this.api.me();
      if (revision !== this.revision) return null;
      this.accept(profile); return profile.user;
    } catch (error) {
      if (revision !== this.revision) return null;
      if ((error as { status?: number }).status === 401) { this.publish(guest, null); return null; }
      this.publish({ ...guest, status: 'unavailable' }, null); throw error;
    }
  };
  signIn = async (username: string, password: string): Promise<AuthUser> => {
    const previous = this.snapshot, previousCsrf = this.csrf;
    const revision = ++this.revision;
    this.isMutating = true;
    this.publish({ ...guest, status: 'checking' }, null);
    try {
      const login = await this.api.login({ username, password });
      if (revision !== this.revision) throw changed();
      const profile = await this.api.me();
      if (revision !== this.revision) throw changed();
      validateProfile(profile);
      if (login.user?.id !== profile.user.id || login.user?.role !== profile.user.role ||
          login.user?.employee_id !== profile.user.employee_id || login.user?.username !== profile.user.username ||
          profile.user.username !== username.trim().toLowerCase()) {
        throw Object.assign(new Error('Die bestätigte Sitzung stimmt nicht mit der Anmeldung überein. Bitte erneut anmelden.'), { code: 'SESSION_MISMATCH' });
      }
      this.accept(profile); this.notify(); return profile.user;
    } catch (error) {
      if (revision === this.revision) {
        // A rejected login leaves the old server session intact; show it explicitly, never auto-redirect.
        if ((error as { code?: string }).code === 'INVALID_CREDENTIALS' && previous.status === 'authenticated') this.publish(previous, previousCsrf);
        else this.publish({ ...guest, status: (error as { status?: number }).status === 401 ? 'guest' : 'unavailable' }, null);
      }
      throw error;
    } finally { this.isMutating = false; }
  };
  signOut = async (): Promise<void> => {
    const previous = this.snapshot, previousCsrf = this.csrf;
    const revision = ++this.revision;
    this.isMutating = true;
    // Keep the accepted CSRF token for the logout request.
    try {
      const result = await this.api.logout();
      if (revision !== this.revision) throw changed();
      if (result.logged_out !== true) throw new Error('Abmeldung nicht bestätigt.');
      this.publish(guest, null); this.notify();
    } catch (error) {
      if (revision === this.revision) this.publish(previous, previousCsrf);
      throw error;
    } finally { this.isMutating = false; }
  };
}
