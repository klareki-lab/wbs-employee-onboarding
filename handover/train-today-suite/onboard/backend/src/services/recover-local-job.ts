import { z } from "zod";
import { config } from "../config/index.js";
import { transaction } from "../repositories/db.js";

/** Explicit local operator action; never callable by agents or an HTTP endpoint. */
export async function recoverLocalJob(
  employeeId: string,
  expectedAttempts: number,
  reason: string,
) {
  z.uuid().parse(employeeId);
  z.number().int().positive().parse(expectedAttempts);
  z.string().trim().min(10).max(300).parse(reason);
  if (config.NODE_ENV === "production" || config.N8N_ONBOARDING_WEBHOOK_URL) {
    throw new Error(
      "Local recovery requires development/test mode with webhook dispatch disabled",
    );
  }
  return transaction(async (db) => {
    const employee = (
      await db.query("SELECT status FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ])
    ).rows[0];
    if (employee?.status !== "pending")
      throw new Error("Recovery requires an existing pending employee");
    const job = (
      await db.query(
        "SELECT * FROM onboarding_jobs WHERE employee_id=$1 FOR UPDATE",
        [employeeId],
      )
    ).rows[0];
    if (
      !job ||
      job.processing_status !== "failed" ||
      job.attempts !== expectedAttempts ||
      job.orchestration_result?.status !== "failed" ||
      job.error_code !== "AGENT_PROCESSING_FAILED"
    ) {
      throw new Error(
        "Recovery requires the reviewed terminal agent failure and exact attempt count",
      );
    }
    await db.query(
      `UPDATE onboarding_jobs SET
      attempt_history=attempt_history || jsonb_build_array(jsonb_build_object(
        'attempts',attempts,'processing_status',processing_status,
        'orchestration_result',orchestration_result,'error_code',error_code,
        'archived_at',now(),'reason',$2::text)),
      processing_status='unavailable',orchestration_result=NULL,error_code=NULL,
      next_attempt_at=now(),lease_until=NULL,updated_at=now()
      WHERE id=$1`,
      [job.id, reason],
    );
    return {
      job_id: job.id,
      employee_id: employeeId,
      archived_attempts: expectedAttempts,
      processing_status: "unavailable",
    };
  });
}
