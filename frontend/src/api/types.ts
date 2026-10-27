export type EmployeeStatus = 'pending' | 'approved' | 'active';
export type ProcessingStatus = 'unavailable' | 'queued' | 'dispatching' | 'awaiting_result' | 'completed' | 'failed';
export type InvitationStatus = 'pending' | 'used' | 'revoked' | 'expired';
export type DeliveryStatus = 'sending' | 'smtp_accepted' | 'unknown' | 'failed';
export type UserRole = 'hr' | 'employee';

export interface NewEmployeeRequest {
  first_name: string;
  last_name: string;
  personal_email: string;
  department: string;
  role: string; // Job title, not access-control role.
  start_date: string;
}
export interface OnboardingCreated {
  employee_id: string;
  job_id: string;
  processing_status: ProcessingStatus;
  replayed: boolean;
}
export interface Employee extends NewEmployeeRequest {
  id: string;
  status: EmployeeStatus;
  processing_status: ProcessingStatus;
  created_at: string;
}
export interface EmployeeInvitation {
  id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  delivery_status: DeliveryStatus;
  status: InvitationStatus;
}
export interface EmployeeDetails extends Employee {
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  team_lead: string | null;
  necessary_accounts: string[];
  department_is_demo: boolean;
  job_id: string;
  orchestration_result: unknown | null;
  error_code: string | null;
  invitation: EmployeeInvitation | null;
}
export interface Pagination { limit: number; offset: number }
export interface EmployeeListResponse { employees: Employee[]; pagination: Pagination }
export interface ApprovalResponse { employee_id: string; status: 'approved'; approved_at: string }
export interface SendInvitationResponse {
  employee_id: string;
  invitation_id: string;
  expires_at: string;
  delivery_status: DeliveryStatus;
  reused: boolean;
}
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  employee_id: string | null;
}
export type AuthEmployee = Pick<Employee, 'id' | 'first_name' | 'last_name' | 'personal_email' | 'department' | 'role' | 'start_date' | 'status'>;
export interface AuthMeResponse {
  user: AuthUser;
  employee: AuthEmployee | null;
  csrf_token: string;
}
export interface LoginResponse { user: AuthUser; csrf_token: string }
export interface LoginRequest { username: string; password: string }
export interface InvitationValidation { first_name: string; last_name: string; expires_at: string }
export interface ActivationRequest { token: string; username: string; password: string }
export interface ActivationResponse { id: string; username: string; employee_id: string; role: 'employee' }
export interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
  fields?: { path: string; message: string }[];
  message?: string;
}
export interface ApiEnvelope<T> { data: T; pagination?: Pagination }
