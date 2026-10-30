SET LOCAL search_path TO employee_onboarding;
CREATE TABLE admin_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
 recipient text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','captured','sent','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 attempted_at timestamptz, sent_at timestamptz,
 error_code text
);
CREATE INDEX admin_notifications_pending ON admin_notifications(created_at) WHERE status='queued';
