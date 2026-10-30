import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../repositories/db.js";
import { internal as authorize } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { config } from "../config/index.js";
import { equal } from "../auth/security.js";
export const internal = Router();
const field = z.string().trim().min(1).max(200);
const callback = z.discriminatedUnion("status", [
  z
    .object({
      employee_id: z.uuid(),
      status: z.literal("completed"),
      team_lead: field,
      necessary_accounts: z.array(field).max(30),
      welcome_message: z.string().min(1).max(4000),
      personal_plan: z.string().trim().min(1).max(4000).optional(),
    })
    .strict(),
  z
    .object({
      employee_id: z.uuid(),
      status: z.literal("failed"),
      error_code: z.string().regex(/^[A-Z0-9_]{1,80}$/),
    })
    .strict(),
]);
internal.get("/departments", async (req, res) => {
  if (!config.DEPARTMENTS_API_SECRET)
    throw new ApiError(503, "DEPARTMENTS_API_UNAVAILABLE");
  if (
    !equal(
      req.get("Authorization") ?? "",
      `Bearer ${config.DEPARTMENTS_API_SECRET}`,
    )
  )
    throw new ApiError(401, "UNAUTHENTICATED");
  res.json({
    data: (
      await pool.query(
        "SELECT id,name,team_lead,necessary_accounts,is_demo FROM departments ORDER BY name",
      )
    ).rows,
  });
});
internal.post("/onboarding/result", authorize, async (req, res) => {
  const input = callback.parse(req.body);
  const result = await transaction(async (db) => {
    const job = (
      await db.query(
        "SELECT * FROM onboarding_jobs WHERE employee_id=$1 FOR UPDATE",
        [input.employee_id],
      )
    ).rows[0];
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND");
    // Compare canonical PostgreSQL jsonb values so JSON property ordering does not affect replay handling.
    if (job.orchestration_result) {
      const same = (
        await db.query("SELECT $1::jsonb=$2::jsonb AS same", [
          job.orchestration_result,
          JSON.stringify(input),
        ])
      ).rows[0].same;
      if (same)
        return { processing_status: job.processing_status, replayed: true };
      throw new ApiError(409, "CALLBACK_CONFLICT");
    }
    if (
      !["dispatching", "awaiting_result", "queued", "failed"].includes(
        job.processing_status,
      ) ||
      job.attempts === 0
    )
      throw new ApiError(409, "ILLEGAL_JOB_TRANSITION");
    await db.query(
      "UPDATE onboarding_jobs SET processing_status=$2,orchestration_result=$3,error_code=$4,updated_at=now() WHERE id=$1",
      [
        job.id,
        input.status,
        JSON.stringify(input),
        input.status === "failed" ? input.error_code : null,
      ],
    );
    return { processing_status: input.status, replayed: false };
  });
  res.json({ data: result });
});
