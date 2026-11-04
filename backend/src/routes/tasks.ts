import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../repositories/db.js";
import { authenticate, role, csrf } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { canTransition } from "../services/task-transitions.js";

// Phase 2 task management is exclusively deterministic. No route for n8n/AI to
// create tasks, approve access, create accounts, or mutate real integrations.
export const tasks = Router();
const uuid = z.uuid();
const status = z.enum(["pending", "in_progress", "awaiting_hr", "completed"]);
const statusBody = z.object({ status, expected_version: z.number().int().positive() }).strict();
const approveBody = z.object({ expected_version: z.number().int().positive() }).strict();
const fields = `id, employee_id, template_key, template_version, title, detail,
 assignee_role, assigned_to, due_date::text AS due_date, needs_hr_approval,
 execution_mode, sort_order, source_verified, status, version, approved_by,
 approved_at, completed_at, created_at, updated_at`;

type TaskStatus = z.infer<typeof status>;
type TaskRow = {
  id: string;
  employee_id: string;
  assignee_role: "hr" | "employee";
  assigned_to: string | null;
  needs_hr_approval: boolean;
  status: TaskStatus;
  version: number;
  approved_by: string | null;
};

async function listTasks(employeeId: string, filterRole?: "employee") {
  const result = await pool.query(
    `SELECT ${fields} FROM onboarding_tasks WHERE employee_id=$1
     AND ($2::text IS NULL OR assignee_role=$2) ORDER BY sort_order, template_key`,
    [employeeId, filterRole ?? null],
  );
  const rows = result.rows;
  return {
    tasks: rows,
    summary: {
      total: rows.length,
      completed: rows.filter((task) => task.status === "completed").length,
      waiting_for_hr: rows.filter((task) => task.status === "awaiting_hr").length,
      source_verified: rows.every((task) => task.source_verified === true),
    },
  };
}

// Mounted behind /api; separate role-scoped routers avoid accidental exposure.
const hrTasks = Router();
hrTasks.use(authenticate, role("hr"), csrf);
hrTasks.get("/checklist-templates", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT template_key,scope,title,detail,assignee_role,due_offset_days,
      needs_hr_approval,execution_mode,sort_order,source_id,source_verified,template_version
     FROM onboarding_task_templates ORDER BY sort_order,template_key`,
  );
  res.json({ data: rows });
});
hrTasks.get("/employees/:id/tasks", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const exists = await pool.query("SELECT 1 FROM employees WHERE id=$1", [id]);
  if (!exists.rowCount) throw new ApiError(404, "EMPLOYEE_NOT_FOUND");
  res.json({ data: await listTasks(id) });
});

const employeeTasks = Router();
employeeTasks.use(authenticate, role("employee"), csrf);
employeeTasks.get("/plan", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT processing_status,orchestration_result->>'personal_plan' AS personal_plan
     FROM onboarding_jobs WHERE employee_id=$1`, [req.principal!.employee_id],
  );
  res.json({ data: { processing_status: rows[0]?.processing_status ?? 'unavailable',
    personal_plan: rows[0]?.personal_plan ?? null } });
});
employeeTasks.get("/tasks", async (req, res) => {
  res.json({ data: await listTasks(req.principal!.employee_id!, "employee") });
});

async function changeStatus(
  id: string, actorId: string, actorRole: "hr" | "employee", target: TaskStatus,
  version: number, employeeId?: string,
) {
  return transaction(async (db) => {
    const { rows } = await db.query<TaskRow>(
      `SELECT id,employee_id,assignee_role,assigned_to,needs_hr_approval,status,version,approved_by
       FROM onboarding_tasks WHERE id=$1 AND ($2::uuid IS NULL OR employee_id=$2) FOR UPDATE`,
      [id, employeeId ?? null],
    );
    const task = rows[0];
    if (!task || task.assignee_role !== actorRole) throw new ApiError(404, "TASK_NOT_FOUND");
    if (actorRole === "hr" && task.assigned_to && task.assigned_to !== actorId)
      throw new ApiError(403, "TASK_ASSIGNED_TO_OTHER_HR");
    if (task.status === target) return { task: (await db.query(`SELECT ${fields} FROM onboarding_tasks WHERE id=$1`, [id])).rows[0], replayed: true };
    if (task.version !== version) throw new ApiError(409, "TASK_VERSION_CONFLICT");
    if (!canTransition(task, target, actorRole)) throw new ApiError(409, "TASK_ILLEGAL_TRANSITION");
    await db.query("SELECT set_config('app.actor_user_id',$1,true)", [actorId]);
    const updated = await db.query(
      `UPDATE onboarding_tasks SET status=$2, version=version+1, updated_at=now(),
         assigned_to=COALESCE(assigned_to,$3::uuid),
         completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END
       WHERE id=$1 RETURNING ${fields}`,
      [id, target, actorId],
    );
    return { task: updated.rows[0], replayed: false };
  });
}

employeeTasks.patch("/tasks/:id/status", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = statusBody.parse(req.body);
  const result = await changeStatus(
    id, req.principal!.id, "employee", input.status, input.expected_version,
    req.principal!.employee_id!,
  );
  res.json({ data: result });
});
hrTasks.patch("/tasks/:id/status", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = statusBody.parse(req.body);
  const result = await changeStatus(id, req.principal!.id, "hr", input.status, input.expected_version);
  res.json({ data: result });
});

hrTasks.post("/tasks/:id/approve", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = approveBody.parse(req.body);
  const result = await transaction(async (db) => {
    const { rows } = await db.query<TaskRow>(
      `SELECT id,employee_id,assignee_role,assigned_to,needs_hr_approval,status,version,approved_by
       FROM onboarding_tasks WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const current = rows[0];
    if (!current) throw new ApiError(404, "TASK_NOT_FOUND");
    if (!current.needs_hr_approval || current.assignee_role !== "employee")
      throw new ApiError(409, "TASK_APPROVAL_NOT_APPLICABLE");
    if (current.status === "completed" && current.approved_by)
      return { task: (await db.query(`SELECT ${fields} FROM onboarding_tasks WHERE id=$1`, [id])).rows[0], replayed: true };
    if (current.version !== input.expected_version) throw new ApiError(409, "TASK_VERSION_CONFLICT");
    if (current.status !== "awaiting_hr") throw new ApiError(409, "TASK_APPROVAL_NOT_REQUESTED");
    await db.query("SELECT set_config('app.actor_user_id',$1,true)", [req.principal!.id]);
    const updated = await db.query(
      `UPDATE onboarding_tasks SET status='completed',version=version+1,
         approved_by=$2,approved_at=now(),completed_at=now(),updated_at=now()
       WHERE id=$1 RETURNING ${fields}`,
      [id, req.principal!.id],
    );
    return { task: updated.rows[0], replayed: false };
  });
  res.json({ data: result });
});

hrTasks.get("/tasks/:id/history", async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (!(await pool.query("SELECT 1 FROM onboarding_tasks WHERE id=$1", [id])).rowCount)
    throw new ApiError(404, "TASK_NOT_FOUND");
  const { rows } = await pool.query(
    `SELECT id,task_id,actor_user_id,action,from_status,to_status,version,changed_at
     FROM onboarding_task_events WHERE task_id=$1 ORDER BY id`, [id],
  );
  res.json({ data: rows });
});
employeeTasks.get("/tasks/:id/history", async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (!(await pool.query(
    "SELECT 1 FROM onboarding_tasks WHERE id=$1 AND employee_id=$2 AND assignee_role='employee'",
    [id, req.principal!.employee_id],
  )).rowCount) throw new ApiError(404, "TASK_NOT_FOUND");
  const { rows } = await pool.query(
    `SELECT action,from_status,to_status,version,changed_at
     FROM onboarding_task_events WHERE task_id=$1 ORDER BY id`, [id],
  );
  res.json({ data: rows });
});

tasks.use("/hr", hrTasks);
tasks.use("/employee", employeeTasks);
