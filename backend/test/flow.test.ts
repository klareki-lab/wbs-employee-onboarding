import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

test("real PostgreSQL + SMTP onboarding, concurrency and authorization", async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Use a dedicated database whose name ends in _test");
  process.env.SMTP_MODE = "capture"; // Explicit isolated test capture, never real acceptance mail.
  const webhook = createServer((req, res) => {
    assert.equal(
      req.headers.authorization,
      `Bearer ${process.env.N8N_ONBOARDING_WEBHOOK_SECRET}`,
    );
    req.resume();
    res.writeHead(202).end();
  });
  webhook.listen(0, "127.0.0.1");
  await once(webhook, "listening");
  process.env.N8N_ONBOARDING_WEBHOOK_URL = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}`;
  const { pool } = await import("../src/repositories/db.js");
  const { createApp } = await import("../src/app/index.js");
  const { hashPassword, digest } = await import("../src/auth/security.js");
  const { dispatchOne } = await import("../src/integrations/n8n.js");
  const { config } = await import("../src/config/index.js");
  const app = createApp().listen(0, "127.0.0.1");
  await once(app, "listening");
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const password = randomBytes(24).toString("base64url");
  let cookie = "",
    csrf = "";
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const internal = { Authorization: `Bearer ${config.INTERNAL_API_SECRET}` };
  try {
    await pool.query(
      "TRUNCATE sessions,invitations,onboarding_jobs,employees,user_accounts CASCADE",
    );
    await pool.query(
      "INSERT INTO user_accounts(username,password_hash,account_role) VALUES('test.hr',$1,'hr')",
      [await hashPassword(password)],
    );
    assert.equal((await call("/health")).status, 200);
    assert.equal((await call("/api/hr/employees")).status, 401);
    assert.equal((await call("/api/internal/departments")).status, 401);
    assert.equal(
      (
        await call("/api/internal/departments", "GET", undefined, {
          Authorization: `Bearer ${config.DEPARTMENTS_API_SECRET}`,
        })
      ).data.data.length,
      3,
    );
    const login = await call("/api/auth/login", "POST", {
      username: "test.hr",
      password,
    });
    assert.equal(login.status, 200);
    cookie = login.cookie;
    csrf = login.data.data.csrf_token;
    assert.match(login.cookie, /^wbs_onboarding_session=/);
    assert.equal(
      (await call("/api/onboarding", "POST", {}, { "X-CSRF-Token": "" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/onboarding",
          "POST",
          {},
          { Origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal((await call("/api/onboarding", "POST", {})).status, 400);
    const body = {
      first_name: "Tom",
      last_name: "Becker",
      personal_email: "tom.flow@example.com",
      department: "IT",
      role: "Backend Developer",
      start_date: "2026-11-03",
    };
    const registrations = await Promise.all([
      call("/api/onboarding", "POST", body),
      call("/api/onboarding", "POST", body),
    ]);
    assert.deepEqual(registrations.map((r) => r.status).sort(), [200, 201]);
    const id = registrations[0].data.data.employee_id;
    assert.equal(registrations[1].data.data.employee_id, id);
    assert.equal(
      (await call("/api/onboarding", "POST", { ...body, role: "Different" }))
        .status,
      409,
    );
    assert.equal(
      (await call(`/api/hr/employees/${id}/approve`, "POST")).status,
      409,
    );
    assert.equal(
      (await call(`/api/hr/employees/${id}/send-invitation`, "POST")).status,
      409,
    );
    const result = {
      employee_id: id,
      status: "completed",
      team_lead: "Sarah Miller",
      necessary_accounts: ["GitHub", "Google Workspace", "Jira"],
      welcome_message: "Willkommen Tom!",
    };
    assert.equal(
      (await call("/api/internal/onboarding/result", "POST", result, internal))
        .status,
      409,
    );
    // Scope recovery and dispatch to one existing employee, excluding unrelated local jobs.
    await pool.query(
      "UPDATE onboarding_jobs SET processing_status='unavailable' WHERE employee_id=$1",
      [id],
    );
    config.ONBOARDING_WORKER_EMPLOYEE_ID =
      "00000000-0000-4000-8000-000000000001";
    await dispatchOne();
    const excluded = (
      await pool.query(
        "SELECT processing_status,attempts FROM onboarding_jobs WHERE employee_id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(excluded.processing_status, "unavailable");
    assert.equal(excluded.attempts, 0);
    config.ONBOARDING_WORKER_EMPLOYEE_ID = id;
    await dispatchOne();
    assert.equal(
      (await call(`/api/hr/employees/${id}`)).data.data.processing_status,
      "awaiting_result",
    );
    assert.equal(
      (await call("/api/internal/onboarding/result", "POST", result, internal))
        .status,
      200,
    );
    assert.equal(
      (await call("/api/internal/onboarding/result", "POST", result, internal))
        .data.data.replayed,
      true,
    );
    assert.equal(
      (
        await call(
          "/api/internal/onboarding/result",
          "POST",
          { ...result, team_lead: "Changed" },
          internal,
        )
      ).status,
      409,
    );
    assert.equal(
      (await call(`/api/hr/employees/${id}/approve`, "POST")).status,
      200,
    );
    assert.equal(
      (await call(`/api/hr/employees/${id}/approve`, "POST")).status,
      200,
    );
    const sends = await Promise.all([
      call(`/api/hr/employees/${id}/send-invitation`, "POST"),
      call(`/api/hr/employees/${id}/send-invitation`, "POST"),
    ]);
    assert.ok(sends.every((s) => [200, 202].includes(s.status)));
    assert.equal(
      sends[0].data.data.invitation_id,
      sends[1].data.data.invitation_id,
    );
    assert.ok(
      sends.some((s) => s.data.data.delivery_status === "smtp_accepted"),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM invitations WHERE employee_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    const list = await (
      await fetch("http://localhost:8025/api/v1/messages")
    ).json();
    const message = list.messages.find((m: any) =>
      m.To.some((to: any) => to.Address === body.personal_email),
    );
    assert.ok(message);
    const captured = await (
      await fetch(`http://localhost:8025/api/v1/message/${message.ID}`)
    ).json();
    const link = captured.Text.match(
      /http:\/\/localhost:5173\/activate#[^\s]+/,
    )[0];
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get(
      "token",
    )!;
    assert.equal(
      (
        await pool.query(
          "SELECT token_hash FROM invitations WHERE employee_id=$1",
          [id],
        )
      ).rows[0].token_hash,
      digest(token),
    );
    assert.equal(
      (await call("/api/invitations/validate?token=" + token)).status,
      200,
    );
    await pool.query(
      "UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE employee_id=$1",
      [id],
    );
    assert.equal(
      (await call("/api/invitations/validate?token=" + token)).status,
      410,
    );
    assert.equal(
      (
        await call("/api/invitations/activate", "POST", {
          token,
          username: "tom.becker",
          password,
        })
      ).status,
      410,
    );
    await pool.query(
      "UPDATE invitations SET expires_at=now()+interval '1 hour' WHERE employee_id=$1",
      [id],
    );
    // A username collision rolls back consumption, allowing the employee to choose another name.
    assert.equal(
      (
        await call("/api/invitations/activate", "POST", {
          token,
          username: "test.hr",
          password,
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("/api/invitations/validate?token=" + token)).status,
      200,
    );
    const activations = await Promise.all([
      call("/api/invitations/activate", "POST", {
        token,
        username: "tom.becker",
        password,
      }),
      call("/api/invitations/activate", "POST", {
        token,
        username: "tom.becker",
        password,
      }),
    ]);
    assert.deepEqual(activations.map((a) => a.status).sort(), [201, 410]);
    assert.equal(
      (await call("/api/invitations/validate?token=" + token)).status,
      410,
    );
    const employeeLogin = await call("/api/auth/login", "POST", {
      username: "tom.becker",
      password,
    });
    assert.equal(employeeLogin.status, 200);
    cookie = employeeLogin.cookie;
    csrf = employeeLogin.data.data.csrf_token;
    assert.equal((await call("/api/auth/me")).data.data.employee.id, id);
    assert.equal((await call("/api/hr/employees")).status, 403);
    assert.equal((await call("/api/onboarding", "POST", body)).status, 403);
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          username: "tom.becker",
          password: "wrong-password",
        })
      ).status,
      401,
    );
    assert.equal(
      (await call("/api/employee/dashboard")).data.data.areas.length,
      4,
    );
    assert.equal((await call("/api/auth/logout", "POST", {})).status, 200);
    assert.equal((await call("/api/auth/me")).status, 401);
    const account = (
      await pool.query(
        "SELECT password_hash FROM user_accounts WHERE employee_id=$1",
        [id],
      )
    ).rows[0];
    assert.ok(account.password_hash.startsWith("$argon2id$"));
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM user_accounts WHERE employee_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    // An explicit local technical-failure recovery preserves the prior terminal result.
    const { recoverLocalJob } =
      await import("../src/services/recover-local-job.js");
    const retryEmployee = (
      await pool.query(
        "INSERT INTO employees(first_name,last_name,personal_email,department,role,start_date) VALUES('Retry','Fixture','retry.fixture@example.invalid','IT','Test','2026-11-03') RETURNING id",
      )
    ).rows[0].id;
    const failure = {
      employee_id: retryEmployee,
      status: "failed",
      error_code: "AGENT_PROCESSING_FAILED",
    };
    await pool.query(
      "INSERT INTO onboarding_jobs(employee_id,processing_status,attempts,error_code,orchestration_result) VALUES($1,'failed',1,'AGENT_PROCESSING_FAILED',$2)",
      [retryEmployee, JSON.stringify(failure)],
    );
    await assert.rejects(
      () =>
        recoverLocalJob(retryEmployee, 1, "Reviewed model locator mismatch"),
      /dispatch disabled/,
    );
    const webhookUrl = config.N8N_ONBOARDING_WEBHOOK_URL;
    config.N8N_ONBOARDING_WEBHOOK_URL = undefined;
    try {
      await assert.rejects(
        () =>
          recoverLocalJob(retryEmployee, 2, "Reviewed model locator mismatch"),
        /exact attempt count/,
      );
      await recoverLocalJob(
        retryEmployee,
        1,
        "Reviewed model locator mismatch",
      );
      const recovered = (
        await pool.query(
          "SELECT processing_status,attempts,orchestration_result,attempt_history FROM onboarding_jobs WHERE employee_id=$1",
          [retryEmployee],
        )
      ).rows[0];
      assert.equal(recovered.processing_status, "unavailable");
      assert.equal(recovered.attempts, 1);
      assert.equal(recovered.orchestration_result, null);
      assert.equal(recovered.attempt_history.length, 1);
      assert.deepEqual(
        recovered.attempt_history[0].orchestration_result,
        failure,
      );
      await assert.rejects(
        () =>
          recoverLocalJob(retryEmployee, 1, "Reviewed model locator mismatch"),
        /reviewed terminal agent failure/,
      );
    } finally {
      config.N8N_ONBOARDING_WEBHOOK_URL = webhookUrl;
    }
  } finally {
    app.close();
    webhook.close();
    await pool.end();
  }
});
