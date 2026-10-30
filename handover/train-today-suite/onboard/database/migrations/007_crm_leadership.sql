SET LOCAL search_path TO employee_onboarding;
CREATE TABLE crm_absences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), crm_user_id uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 category text NOT NULL CHECK(category IN ('sick','leave','unavailable')),
 cancelled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES user_accounts(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_leadership_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL REFERENCES user_accounts(id),
 action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_assistant_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid NOT NULL REFERENCES user_accounts(id),
 project_id uuid,question text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_assistant_user ON crm_assistant_messages(user_id,project_id,id);
