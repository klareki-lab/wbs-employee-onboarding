-- Preserve terminal results before explicit, local-only recovery of a technical failure.
ALTER TABLE employee_onboarding.onboarding_jobs
  ADD COLUMN attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(attempt_history) = 'array');
