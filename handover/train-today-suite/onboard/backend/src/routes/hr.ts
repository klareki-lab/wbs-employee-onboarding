import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../repositories/db.js";
import { authenticate, role, csrf } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { randomToken, digest } from "../auth/security.js";
import { config } from "../config/index.js";
import { n8nConfigured } from "../integrations/n8n.js";
import { mailer, sendInvitation } from "../integrations/email.js";
import { queueAdminNotification } from "../integrations/admin-notifications.js";
export const hr = Router();
hr.use(authenticate, role("hr"), csrf);
const uuid = z.uuid();
const text = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const create = z
  .object({
    first_name: text,
    last_name: text,
    personal_email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    department: text,
    role: text,
    start_date: z.iso.date(),
  })
  .strict();
hr.post("/onboarding", async (req, res) => {
  const input = create.parse(req.body);
  const result = await transaction(async (db) => {
    if (
      !(
        await db.query("SELECT 1 FROM departments WHERE name=$1", [
          input.department,
        ])
      ).rowCount
    )
      throw new ApiError(400, "DEPARTMENT_UNKNOWN");
    const inserted = await db.query(
      "INSERT INTO employees(first_name,last_name,personal_email,department,role,start_date) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(personal_email) DO NOTHING RETURNING *",
      [
        input.first_name,
        input.last_name,
        input.personal_email,
        input.department,
        input.role,
        input.start_date,
      ],
    );
    if (!inserted.rowCount) {
      const existing = (
        await db.query(
          "SELECT e.*,e.start_date::text AS start_date,j.processing_status,j.id AS job_id FROM employees e JOIN onboarding_jobs j ON j.employee_id=e.id WHERE personal_email=$1",
          [input.personal_email],
        )
      ).rows[0];
      if (
        !existing ||
        !Object.entries(input).every(([key, value]) => existing[key] === value)
      )
        throw new ApiError(409, "EMPLOYEE_ALREADY_REGISTERED");
      return {
        employee_id: existing.id,
        job_id: existing.job_id,
        processing_status: existing.processing_status,
        replayed: true,
      };
    }
    const employee = inserted.rows[0];
    await db.query(`INSERT INTO employee_accesses(employee_id,system_name,login_url)
      SELECT $1,a.name,CASE a.name WHEN 'CRM' THEN 'http://localhost:3080/' WHEN 'Google Workspace' THEN 'https://accounts.google.com/' WHEN 'GitHub' THEN 'https://github.com/login' ELSE '' END
      FROM departments d CROSS JOIN LATERAL jsonb_array_elements_text(d.necessary_accounts) a(name)
      WHERE d.name=$2 AND a.name NOT IN ('Slack','Notion','HR-Portal','Mitarbeiterportal') ON CONFLICT DO NOTHING`,[employee.id,input.department]);
    await queueAdminNotification(db, employee.id);
    const job = (
      await db.query(
        "INSERT INTO onboarding_jobs(employee_id,processing_status) VALUES($1,$2) RETURNING id,processing_status",
        [employee.id, n8nConfigured ? "queued" : "unavailable"],
      )
    ).rows[0];
    return {
      employee_id: employee.id,
      job_id: job.id,
      processing_status: job.processing_status,
      replayed: false,
    };
  });
  res.status(result.replayed ? 200 : 201).json({ data: result });
});
hr.get("/hr/departments", async (_req, res) => {
  res.json({data:(await pool.query("SELECT name FROM departments ORDER BY name")).rows});
});
hr.get("/hr/employees", async (req, res) => {
  const { limit, offset } = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);
  const result = await pool.query(
    "SELECT e.id,e.first_name,e.last_name,e.personal_email,e.department,e.role,e.start_date::text,e.status,e.created_at,j.processing_status FROM employees e JOIN onboarding_jobs j ON j.employee_id=e.id ORDER BY e.created_at DESC,e.id LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  res.json({ data: result.rows, pagination: { limit, offset } });
});
hr.get("/hr/employees/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await pool.query(
    `SELECT e.*, e.start_date::text AS start_date, COALESCE(j.orchestration_result->>'team_lead',d.team_lead) AS team_lead,COALESCE(j.orchestration_result->'necessary_accounts',d.necessary_accounts) AS necessary_accounts,d.is_demo AS department_is_demo,j.id AS job_id,j.processing_status,j.orchestration_result,j.error_code,
 (SELECT jsonb_build_object('recipient',a.recipient,'status',a.status,'sent_at',a.sent_at,'error_code',a.error_code) FROM admin_notifications a WHERE a.employee_id=e.id) AS admin_notification,
 (SELECT jsonb_build_object('id',i.id,'expires_at',i.expires_at,'used_at',i.used_at,'revoked_at',i.revoked_at,'delivery_status',i.delivery_status,'status',CASE WHEN i.used_at IS NOT NULL THEN 'used' WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.expires_at<=now() THEN 'expired' ELSE 'pending' END) FROM invitations i WHERE i.employee_id=e.id ORDER BY i.created_at DESC LIMIT 1) AS invitation
 FROM employees e JOIN departments d ON d.name=e.department JOIN onboarding_jobs j ON j.employee_id=e.id WHERE e.id=$1`,
    [id],
  );
  if (!result.rowCount) throw new ApiError(404, "EMPLOYEE_NOT_FOUND");
  res.json({ data: result.rows[0] });
});
hr.post("/hr/employees/:id/approve", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const employee = await transaction(async (db) => {
    const current = (
      await db.query("SELECT * FROM employees WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!current) throw new ApiError(404, "EMPLOYEE_NOT_FOUND");
    if (current.status === "active") throw new ApiError(409, "ALREADY_ACTIVE");
    const job = (
      await db.query(
        "SELECT processing_status FROM onboarding_jobs WHERE employee_id=$1",
        [id],
      )
    ).rows[0];
    if (job.processing_status !== "completed")
      throw new ApiError(409, "ONBOARDING_NOT_COMPLETED");
    if (current.status === "approved") return current;
    return (
      await db.query(
        "UPDATE employees SET status='approved',approved_at=now(),approved_by=$2,updated_at=now() WHERE id=$1 RETURNING *",
        [id, req.principal!.id],
      )
    ).rows[0];
  });
  res.json({
    data: {
      employee_id: id,
      status: employee.status,
      approved_at: employee.approved_at,
    },
  });
});
hr.post("/hr/employees/:id/send-invitation", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const pending = await transaction(async (db) => {
    const employee = (
      await db.query("SELECT * FROM employees WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!employee) throw new ApiError(404, "EMPLOYEE_NOT_FOUND");
    if (employee.status !== "approved")
      throw new ApiError(409, "HR_APPROVAL_REQUIRED");
    const existing = (
      await db.query(
        "SELECT * FROM invitations WHERE employee_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
        [id],
      )
    ).rows[0];
    if (
      existing &&
      new Date(existing.expires_at) > new Date() &&
      existing.delivery_status !== "failed"
    )
      return { invitation: existing, employee, token: null };
    if (!mailer) throw new ApiError(503, "EMAIL_UNAVAILABLE");
    if (existing)
      await db.query("UPDATE invitations SET revoked_at=now() WHERE id=$1", [
        existing.id,
      ]);
    const token = randomToken();
    const invitation = (
      await db.query(
        "INSERT INTO invitations(employee_id,token_hash,expires_at) VALUES($1,$2,now()+$3*interval '1 hour') RETURNING id,expires_at,delivery_status",
        [id, digest(token), config.INVITATION_HOURS],
      )
    ).rows[0];
    return { invitation, employee, token };
  });
  let delivery = pending.invitation.delivery_status;
  if (pending.token) {
    try {
      await sendInvitation(
        pending.employee.personal_email,
        pending.employee.first_name,
        pending.token,
      );
      delivery = "smtp_accepted";
    } catch {
      delivery = "unknown";
    } // SMTP timeout can occur after acceptance: never automatically resend.
    await pool.query("UPDATE invitations SET delivery_status=$2 WHERE id=$1", [
      pending.invitation.id,
      delivery,
    ]);
  }
  res.status(delivery === "sending" ? 202 : 200).json({
    data: {
      employee_id: id,
      invitation_id: pending.invitation.id,
      expires_at: pending.invitation.expires_at,
      delivery_status: delivery,
      reused: !pending.token,
    },
  });
});
// Explicit recovery for a lost/uncertain email. Revocation makes any old link unusable.
hr.post("/hr/employees/:id/revoke-invitation", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await transaction(async (db) => {
    const employee = (
      await db.query("SELECT status FROM employees WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (!employee) throw new ApiError(404, "EMPLOYEE_NOT_FOUND");
    if (employee.status !== "approved")
      throw new ApiError(409, "HR_APPROVAL_REQUIRED");
    const pending = (
      await db.query(
        "SELECT id,delivery_status,created_at FROM invitations WHERE employee_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
        [id],
      )
    ).rows[0];
    if (
      pending?.delivery_status === "sending" &&
      Date.now() - new Date(pending.created_at).getTime() < 60000
    )
      throw new ApiError(409, "INVITATION_SENDING");
    await db.query(
      "UPDATE invitations SET revoked_at=now() WHERE employee_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
      [id],
    );
  });
  res.json({ data: { employee_id: id, revoked: true } });
});
