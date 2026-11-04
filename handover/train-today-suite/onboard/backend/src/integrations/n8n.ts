import { config } from "../config/index.js";
import { pool, transaction } from "../repositories/db.js";
export const n8nConfigured = Boolean(
  config.N8N_ONBOARDING_WEBHOOK_URL && config.N8N_ONBOARDING_WEBHOOK_SECRET,
);
export async function dispatchOne() {
  if (!n8nConfigured) return;
  const job = await transaction(async (db) => {
    await db.query(
      "UPDATE onboarding_jobs SET processing_status='queued', updated_at=now() WHERE processing_status='unavailable'",
    );
    const found = await db.query(
      "SELECT * FROM onboarding_jobs WHERE ((processing_status='queued' AND next_attempt_at<=now()) OR (processing_status='dispatching' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!found.rowCount) return null;
    return (
      await db.query(
        "UPDATE onboarding_jobs SET processing_status='dispatching', attempts=attempts+1,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1 RETURNING *",
        [found.rows[0].id],
      )
    ).rows[0];
  });
  if (!job) return;
  const employee = (
    await pool.query(
      "SELECT id,first_name,last_name,department,role,start_date::text,personal_email FROM employees WHERE id=$1",
      [job.employee_id],
    )
  ).rows[0];
  try {
    const response = await fetch(config.N8N_ONBOARDING_WEBHOOK_URL!, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.N8N_ONBOARDING_WEBHOOK_SECRET}`,
        "Idempotency-Key": job.id,
      },
      body: JSON.stringify({
        event: "employee.onboarding.requested",
        job_id: job.id,
        employee_id: employee.id,
        ...Object.fromEntries(
          Object.entries(employee).filter(([k]) => k !== "id"),
        ),
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("WEBHOOK_REJECTED");
    await pool.query(
      "UPDATE onboarding_jobs SET processing_status='awaiting_result',error_code=NULL,updated_at=now() WHERE id=$1 AND processing_status='dispatching'",
      [job.id],
    );
  } catch {
    await pool.query(
      "UPDATE onboarding_jobs SET processing_status=$2,error_code='WEBHOOK_DISPATCH_FAILED',next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND processing_status='dispatching'",
      [job.id, job.attempts >= 5 ? "failed" : "queued"],
    );
  }
}
export function startWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    dispatchOne()
      .catch(() => console.error("Queue worker failed"))
      .finally(() => {
        running = false;
      });
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
