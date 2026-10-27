import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

test("worker automatically processes a second employee after the first completes, with retries and stable job IDs", async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Use a dedicated _test database");
  process.env.SMTP_MODE = "disabled";
  // An obsolete setting must not silently restrict registrations after this fix.
  process.env.ONBOARDING_WORKER_EMPLOYEE_ID =
    "00000000-0000-4000-8000-000000000001";
  let apiBase = "";
  const requests: {
    employee_id: string;
    job_id: string;
    key: string;
    attempt: number;
  }[] = [];
  const completed = new Set<string>();
  const callbackErrors: unknown[] = [];
  const webhook = createServer(async (req, res) => {
    try {
      assert.ok(
        req.headers.authorization ===
          `Bearer ${process.env.N8N_ONBOARDING_WEBHOOK_SECRET}`,
        "Webhook bearer authentication must match",
      );
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw),
        attempt = requests.filter((r) => r.job_id === input.job_id).length + 1;
      requests.push({
        employee_id: input.employee_id,
        job_id: input.job_id,
        key: String(req.headers["idempotency-key"]),
        attempt,
      });
      assert.equal(req.headers["idempotency-key"], input.job_id);
      if (input.first_name === "Second" && attempt === 1) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(202).end();
      if (completed.has(input.job_id)) return;
      completed.add(input.job_id);
      // Real HTTP callback contract; this fixture is a mock orchestrator, not real AI.
      const departments = await fetch(apiBase + "/api/internal/departments", {
        headers: {
          Authorization: `Bearer ${process.env.DEPARTMENTS_API_SECRET}`,
        },
      });
      assert.equal(departments.status, 200);
      const facts = (await departments.json()).data.find(
        (d: { name: string }) => d.name === input.department,
      );
      const result = await fetch(apiBase + "/api/internal/onboarding/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({
          employee_id: input.employee_id,
          status: "completed",
          team_lead: facts.team_lead,
          necessary_accounts: facts.necessary_accounts,
          welcome_message: "Willkommen im Testteam!",
        }),
      });
      assert.equal(result.status, 200);
    } catch (error) {
      callbackErrors.push(error);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  webhook.listen(0, "127.0.0.1");
  await once(webhook, "listening");
  process.env.N8N_ONBOARDING_WEBHOOK_URL = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}`;
  const { pool } = await import("../src/repositories/db.js");
  const { createApp } = await import("../src/app/index.js");
  const { config } = await import("../src/config/index.js");
  const { hashPassword } = await import("../src/auth/security.js");
  const { startWorker } = await import("../src/integrations/n8n.js");
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let stop = () => {};
  const password = randomBytes(24).toString("base64url");
  let cookie = "",
    csrf = "";
  async function call(path: string, body?: unknown) {
    const r = await fetch(apiBase + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function waitFor(employeeId: string, predicate: (row: any) => boolean) {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      if (callbackErrors.length) throw callbackErrors[0];
      const row = (
        await pool.query("SELECT * FROM onboarding_jobs WHERE employee_id=$1", [
          employeeId,
        ])
      ).rows[0];
      if (row && predicate(row)) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Worker did not reach expected state");
  }
  try {
    await pool.query(
      "TRUNCATE sessions,invitations,onboarding_jobs,employees,user_accounts CASCADE",
    );
    await pool.query(
      "INSERT INTO user_accounts(username,password_hash,account_role) VALUES('dispatch.hr',$1,'hr')",
      [await hashPassword(password)],
    );
    const login = await call("/api/auth/login", {
      username: "dispatch.hr",
      password,
    });
    assert.equal(login.status, 200);
    cookie = login.cookie!;
    csrf = login.data.data.csrf_token;
    const input = {
      first_name: "First",
      last_name: "Fixture",
      personal_email: "first.dispatch@example.invalid",
      department: "IT",
      role: "Test",
      start_date: "2026-11-03",
    };
    const first = await call("/api/onboarding", input);
    assert.equal(first.status, 201);
    const firstId = first.data.data.employee_id;
    await pool.query(
      "UPDATE onboarding_jobs SET processing_status='unavailable' WHERE employee_id=$1",
      [firstId],
    );
    stop = startWorker();
    const firstDone = await waitFor(
      firstId,
      (j) => j.processing_status === "completed",
    );
    assert.equal(firstDone.attempts, 1);
    const secondInput = {
      ...input,
      first_name: "Second",
      personal_email: "second.dispatch@example.invalid",
    };
    const second = await call("/api/onboarding", secondInput);
    assert.equal(second.status, 201);
    assert.equal(second.data.data.processing_status, "queued");
    const secondId = second.data.data.employee_id;
    const replay = await call("/api/onboarding", secondInput);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.data.job_id, second.data.data.job_id);
    assert.equal(
      (await call("/api/hr/employees/" + secondId + "/approve", {})).status,
      409,
    );
    const retry = await waitFor(
      secondId,
      (j) =>
        j.processing_status === "queued" &&
        j.attempts === 1 &&
        j.error_code === "WEBHOOK_DISPATCH_FAILED",
    );
    assert.ok(
      new Date(retry.next_attempt_at).getTime() > Date.now() + 15000,
      "Dispatch failure must retain a real retry delay",
    );
    // Advance only the isolated fixture's due time, avoiding a 30-second test sleep.
    await pool.query(
      "UPDATE onboarding_jobs SET next_attempt_at=now() WHERE employee_id=$1",
      [secondId],
    );
    const secondDone = await waitFor(
      secondId,
      (j) => j.processing_status === "completed",
    );
    assert.equal(secondDone.attempts, 2);
    const secondView = await call("/api/hr/employees/" + secondId);
    assert.equal(secondView.data.data.status, "pending");
    assert.equal(secondView.data.data.processing_status, "completed");
    assert.equal(secondView.data.data.approved_at, null);
    assert.equal(secondView.data.data.invitation, null);
    const unchanged = (
      await pool.query("SELECT * FROM onboarding_jobs WHERE employee_id=$1", [
        firstId,
      ])
    ).rows[0];
    assert.equal(unchanged.attempts, 1);
    assert.deepEqual(
      unchanged.orchestration_result,
      firstDone.orchestration_result,
    );
    assert.equal(requests.filter((r) => r.employee_id === firstId).length, 1);
    const retries = requests.filter((r) => r.employee_id === secondId);
    assert.equal(retries.length, 2);
    assert.equal(retries[0].key, retries[1].key);
    assert.equal(retries[0].job_id, retries[1].job_id);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM employees")).rows[0].n,
      2,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM invitations")).rows[0]
        .n,
      0,
    );
    assert.equal(callbackErrors.length, 0);
  } finally {
    stop();
    server.close();
    webhook.close();
    await pool.end();
  }
});
