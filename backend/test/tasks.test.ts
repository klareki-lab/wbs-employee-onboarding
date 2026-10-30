import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

test("Phase 2 PostgreSQL/API: exact fixture counts, isolation, approval and persistence", async () => {
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
    throw new Error("Use a disposable database ending _test and apply migration 003 first");
  process.env.SMTP_MODE = "disabled";
  const { pool } = await import("../src/repositories/db.js");
  const { hashPassword } = await import("../src/auth/security.js");
  const { createApp } = await import("../src/app/index.js");
  const { config } = await import("../src/config/index.js");
  let server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const password = randomBytes(24).toString("base64url");
  type Session = { cookie: string; csrf: string };
  async function call(path: string, method = "GET", body?: unknown, session?: Session, headerOverrides: Record<string, string> = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: config.APP_ORIGIN, "Content-Type": "application/json",
        ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}), ...headerOverrides },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  async function login(username: string): Promise<Session> {
    const result = await call("/api/auth/login", "POST", { username, password });
    assert.equal(result.status, 200);
    return { cookie: result.cookie, csrf: result.json.data.csrf_token };
  }
  try {
    await pool.query("TRUNCATE sessions,invitations,onboarding_task_events,onboarding_tasks,onboarding_jobs,employees,user_accounts CASCADE");
    await pool.query("INSERT INTO user_accounts(username,password_hash,account_role) VALUES('phase2.hr',$1,'hr')", [await hashPassword(password)]);
    const hr = await login("phase2.hr");
    const employeeInput = (name: string, department: string) => ({
      first_name: name, last_name: "Synthetic", personal_email: `${name.toLowerCase()}@example.invalid`,
      department, role: "Training role", start_date: "2026-11-03",
    });
    const it = employeeInput("Alfa", "IT"), mk = employeeInput("Beta", "Marketing");
    const a = await call("/api/onboarding", "POST", it, hr);
    const b = await call("/api/onboarding", "POST", mk, hr);
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    const itId = a.json.data.employee_id, mkId = b.json.data.employee_id;
    const simultaneousReplays = await Promise.all([
      call("/api/onboarding", "POST", mk, hr),
      call("/api/onboarding", "POST", mk, hr),
    ]);
    assert.deepEqual(simultaneousReplays.map(r => r.status), [200, 200]);
    assert.ok(simultaneousReplays.every(r => r.json.data.employee_id === mkId && r.json.data.replayed));
    const itTasks = await call(`/api/hr/employees/${itId}/tasks`, "GET", undefined, hr);
    const mkTasks = await call(`/api/hr/employees/${mkId}/tasks`, "GET", undefined, hr);
    assert.equal(itTasks.json.data.summary.total, 10);
    assert.equal(mkTasks.json.data.summary.total, 16);
    assert.equal(mkTasks.json.data.summary.source_verified, false);
    assert.deepEqual(itTasks.json.data.tasks.map((t: any) => t.template_key).filter((k: string) => k.startsWith('M-')), []);
    assert.equal(mkTasks.json.data.tasks.filter((t: any) => t.template_key.startsWith('M-')).length, 6);
    const g01 = mkTasks.json.data.tasks.find((t: any) => t.template_key === 'G-01');
    assert.equal(g01.due_date, '2026-10-31');
    assert.ok(mkTasks.json.data.tasks.every((t: any) => t.source_verified === false));
    assert.equal(new Set(mkTasks.json.data.tasks.map((t: any) => t.template_key)).size, 16);
    await pool.query("INSERT INTO user_accounts(employee_id,username,password_hash,account_role) VALUES ($1,'alfa.employee',$3,'employee'),($2,'beta.employee',$3,'employee')", [itId,mkId,await hashPassword(password)]);
    const emp = await login("beta.employee");
    assert.equal((await call("/api/hr/checklist-templates", "GET", undefined, emp)).status, 403);
    assert.equal((await call("/api/employee/tasks", "GET", undefined, hr)).status, 403);
    const mine = await call("/api/employee/tasks", "GET", undefined, emp);
    assert.equal(mine.status, 200);
    assert.ok(mine.json.data.summary.total < 16); // HR-only tasks are not exposed.
    const sensitive = mine.json.data.tasks.find((t: any) => t.template_key === "M-03");
    assert.ok(sensitive);
    assert.equal((await call(`/api/employee/tasks/${sensitive.id}/status`, "PATCH", {status:"completed", expected_version:1}, emp)).status, 409);
    assert.equal((await call(`/api/hr/tasks/${sensitive.id}/approve`, "POST", {expected_version:1}, hr)).status, 409);
    const asked = await call(`/api/employee/tasks/${sensitive.id}/status`, "PATCH", {status:"awaiting_hr", expected_version:1}, emp);
    assert.equal(asked.status, 200);
    const approved = await call(`/api/hr/tasks/${sensitive.id}/approve`, "POST", {expected_version:2}, hr);
    assert.equal(approved.status, 200);
    assert.equal(approved.json.data.task.status, "completed");
    assert.ok(approved.json.data.task.approved_by);
    assert.equal((await call(`/api/hr/tasks/${sensitive.id}/approve`, "POST", {expected_version:2}, hr)).json.data.replayed, true);
    const hist = await call(`/api/hr/tasks/${sensitive.id}/history`, "GET", undefined, hr);
    assert.deepEqual(hist.json.data.map((e: any) => e.action), ["created","status_changed","hr_approved"]);
    const otherTask = itTasks.json.data.tasks.find((t: any) => t.assignee_role === "employee");
    assert.equal((await call(`/api/employee/tasks/${otherTask.id}/status`, "PATCH", {status:"completed",expected_version:1}, emp)).status, 404);
    assert.equal((await call(`/api/hr/tasks/${sensitive.id}/status`, "PATCH", {status:"completed",expected_version:3}, hr)).status, 404);
    assert.equal((await call(`/api/employee/tasks/${sensitive.id}/status`, "PATCH", {status:"bogus",expected_version:3}, emp)).status, 400);
    assert.equal((await call(`/api/employee/tasks/${sensitive.id}/status`, "PATCH", {status:"in_progress",expected_version:3}, emp, {"X-CSRF-Token":"invalid"})).status, 403);
    const ordinary = mine.json.data.tasks.find((t: any) => t.template_key === 'M-02');
    assert.ok(ordinary);
    const ordinaryDone = await call(`/api/employee/tasks/${ordinary.id}/status`, "PATCH", {status:"completed",expected_version:1}, emp);
    assert.equal(ordinaryDone.status, 200);
    const staleWrite = await call(`/api/employee/tasks/${ordinary.id}/status`, "PATCH", {status:"in_progress",expected_version:1}, emp);
    assert.equal(staleWrite.status, 409);
    const replayDone = await call(`/api/employee/tasks/${ordinary.id}/status`, "PATCH", {status:"completed",expected_version:1}, emp);
    assert.equal(replayDone.status, 200);
    assert.equal(replayDone.json.data.replayed, true);
    const noDuplicateHistory = await call(`/api/employee/tasks/${ordinary.id}/history`, "GET", undefined, emp);
    assert.equal(noDuplicateHistory.json.data.length, 2);
    assert.equal((await call(`/api/employee/tasks/${sensitive.id}/status`, "PATCH", {status:"in_progress",expected_version:3}, emp, {Origin:"https://evil.invalid"})).status, 403);
    const persisted = await pool.query("SELECT status,approved_by,version FROM onboarding_tasks WHERE id=$1", [sensitive.id]);
    assert.equal(persisted.rows[0].status, "completed");
    assert.equal(persisted.rows[0].version, 3);
    assert.ok(persisted.rows[0].approved_by);
    // AI processing failure never removes or overwrites deterministic assignments.
    await pool.query("UPDATE onboarding_jobs SET processing_status='failed',error_code='AGENT_PROCESSING_FAILED' WHERE employee_id=$1", [mkId]);
    assert.equal((await call(`/api/hr/employees/${mkId}/tasks`, "GET", undefined, hr)).json.data.summary.total, 16);
    // Non-destructive application restart: real PostgreSQL state must survive.
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const afterRestart = await call(`/api/hr/employees/${mkId}/tasks`, "GET", undefined, hr);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.json.data.summary.total, 16);
    const savedTask = afterRestart.json.data.tasks.find((t: any) => t.id === sensitive.id);
    assert.equal(savedTask.status, "completed");
    assert.equal(savedTask.version, 3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); }
});
