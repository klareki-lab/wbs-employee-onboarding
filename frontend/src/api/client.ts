import type {
  ActivationRequest, ActivationResponse, ApiEnvelope, ApiErrorBody, ApprovalResponse,
  AuthMeResponse, Employee, EmployeeDetails, EmployeeListResponse,
  InvitationValidation, LoginRequest, LoginResponse, NewEmployeeRequest,
  OnboardingCreated, SendInvitationResponse,
} from './types';

const configuredBase = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
const API_BASE = configuredBase.replace(/\/$/, '');
// The CSRF token is intentionally held in module memory, never in browser storage.
let csrfToken: string | null = null;
function retainCsrf(value: string): void {
  if (!value || typeof value !== 'string') throw new ApiError('CSRF-Token fehlt in der Serverantwort.', 0, 'CSRF_MISSING');
  csrfToken = value;
}
export function clearCsrf(): void { csrfToken = null; }

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly fieldErrors?: Record<string, string>,
  ) { super(message); this.name = 'ApiError'; }
}

async function requestEnvelope<T>(path: string, options: RequestInit = {}, authenticatedPost = false): Promise<ApiEnvelope<T>> {
  if (authenticatedPost && !csrfToken) throw new ApiError('Sitzung nicht bereit. Bitte erneut anmelden.', 403, 'CSRF_MISSING');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(authenticatedPost ? { 'X-CSRF-Token': csrfToken! } : {}),
        ...options.headers,
      },
    });
    let body: unknown = null;
    const raw = await response.text();
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { throw new ApiError('Ung\u00fcltige Serverantwort.', response.status, 'INVALID_JSON'); }
    }
    if (!response.ok) {
      const data = (body && typeof body === 'object' ? body : {}) as ApiErrorBody;
      const err = typeof data.error === 'object' && data.error !== null ? data.error : undefined;
      const code = err?.code ?? (typeof data.error === 'string' ? data.error : undefined);
      const fieldErrors = Array.isArray(data.fields)
        ? Object.fromEntries(data.fields.filter(item => item && typeof item.path === 'string' && typeof item.message === 'string').map(item => [item.path, item.message]))
        : undefined;
      const fallback = response.status === 401 ? 'Anmeldung erforderlich oder Sitzung abgelaufen.'
        : response.status === 403 ? 'Keine Berechtigung f\u00fcr diesen Vorgang.'
        : response.status === 410 ? 'Einladung ung\u00fcltig oder nicht mehr nutzbar.'
        : response.status === 409 ? 'Dieser Vorgang steht im Konflikt mit vorhandenen Daten.'
        : response.status === 429 ? 'Zu viele Anfragen. Bitte sp\u00e4ter erneut versuchen.'
        : 'Der Server konnte die Anfrage nicht verarbeiten.';
      if (response.status === 401) clearCsrf();
      throw new ApiError(err?.message || data.message || fallback, response.status, code, fieldErrors);
    }
    if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'data')) {
      throw new ApiError('Unvollst\u00e4ndige Serverantwort.', response.status, 'INVALID_ENVELOPE');
    }
    return body as ApiEnvelope<T>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new ApiError('Zeit\u00fcberschreitung. Bitte Verbindung pr\u00fcfen.', 0, 'TIMEOUT');
    throw new ApiError('Backend nicht erreichbar. Bitte API-Konfiguration pr\u00fcfen.', 0, 'NETWORK_ERROR');
  } finally { window.clearTimeout(timer); }
}
async function request<T>(path: string, options: RequestInit = {}, authenticatedPost = false): Promise<T> {
  return (await requestEnvelope<T>(path, options, authenticatedPost)).data;
}
const json = (data: unknown): string => JSON.stringify(data);

export const api = {
  createOnboarding: (data: NewEmployeeRequest, key: string) => request<OnboardingCreated>('/onboarding', {
    method: 'POST', body: json(data), headers: { 'Idempotency-Key': key },
  }, true),
  listEmployees: async (limit = 50, offset = 0): Promise<EmployeeListResponse> => {
    const result = await requestEnvelope<Employee[]>(`/hr/employees?limit=${limit}&offset=${offset}`);
    if (!Array.isArray(result.data) || !result.pagination) throw new ApiError('Ung\u00fcltige Mitarbeiterliste.', 0, 'INVALID_ENVELOPE');
    return { employees: result.data, pagination: result.pagination };
  },
  getEmployee: (id: string) => request<EmployeeDetails>(`/hr/employees/${encodeURIComponent(id)}`),
  approveEmployee: (id: string) => request<ApprovalResponse>(`/hr/employees/${encodeURIComponent(id)}/approve`, { method: 'POST' }, true),
  sendInvitation: (id: string) => request<SendInvitationResponse>(`/hr/employees/${encodeURIComponent(id)}/send-invitation`, { method: 'POST' }, true),
  validateInvitation: (token: string) => request<InvitationValidation>(`/invitations/validate?token=${encodeURIComponent(token)}`),
  activate: (data: ActivationRequest) => request<ActivationResponse>('/invitations/activate', { method: 'POST', body: json(data) }),
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const result = await request<LoginResponse>('/auth/login', { method: 'POST', body: json(data) });
    retainCsrf(result.csrf_token);
    return result;
  },
  logout: async () => {
    const result = await request<{logged_out: boolean}>('/auth/logout', { method: 'POST' }, true);
    if (result.logged_out !== true) throw new ApiError('Abmeldung vom Backend nicht best\u00e4tigt.', 0, 'INVALID_ENVELOPE');
    clearCsrf();
    return result;
  },
  me: async (): Promise<AuthMeResponse> => {
    const result = await request<AuthMeResponse>('/auth/me');
    retainCsrf(result.csrf_token);
    return result;
  },
};
export function apiMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.';
}
