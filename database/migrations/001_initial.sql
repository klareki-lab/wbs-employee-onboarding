CREATE SCHEMA IF NOT EXISTS employee_onboarding;
SET LOCAL search_path TO employee_onboarding;
CREATE TABLE departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 team_lead text NOT NULL, necessary_accounts jsonb NOT NULL, is_demo boolean NOT NULL DEFAULT true
);
INSERT INTO departments(name,team_lead,necessary_accounts) VALUES
 ('IT','Sarah Miller','["GitHub","Google Workspace","Jira"]'),
 ('Marketing','Anna Weber','["Google Workspace","Canva","Analytics"]'),
 ('Sales','Michael Braun','["CRM","Google Workspace"]');
CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text NOT NULL, last_name text NOT NULL,
 personal_email text NOT NULL UNIQUE CHECK(personal_email = lower(personal_email)),
 department text NOT NULL REFERENCES departments(name), role text NOT NULL, start_date date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','active')),
 approved_at timestamptz, approved_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid UNIQUE REFERENCES employees(id),
 username text NOT NULL UNIQUE CHECK(username = lower(username)), password_hash text NOT NULL,
 account_role text NOT NULL CHECK(account_role IN ('hr','employee')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((account_role='employee' AND employee_id IS NOT NULL) OR (account_role='hr' AND employee_id IS NULL))
);
ALTER TABLE employees ADD FOREIGN KEY(approved_by) REFERENCES user_accounts(id);
CREATE TABLE invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
 revoked_at timestamptz, delivery_status text NOT NULL DEFAULT 'sending'
 CHECK(delivery_status IN ('sending','smtp_accepted','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_invitation ON invitations(employee_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TABLE onboarding_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL UNIQUE REFERENCES employees(id),
 processing_status text NOT NULL CHECK(processing_status IN ('unavailable','queued','dispatching','awaiting_result','completed','failed')),
 orchestration_result jsonb, error_code text, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_dispatch ON onboarding_jobs(processing_status,next_attempt_at);
CREATE INDEX employees_created ON employees(created_at DESC);
CREATE INDEX invitations_employee ON invitations(employee_id);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
