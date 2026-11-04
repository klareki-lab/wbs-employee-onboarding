SET LOCAL search_path TO employee_onboarding;
ALTER TABLE workspace_permissions ADD COLUMN leadership boolean NOT NULL DEFAULT false;
INSERT INTO workspace_permissions(user_id,leadership)
SELECT u.id,true FROM user_accounts u JOIN employees e ON e.id=u.employee_id
WHERE u.username='leitung' AND e.department='Geschäftsleitung'
ON CONFLICT(user_id) DO UPDATE SET leadership=true;
