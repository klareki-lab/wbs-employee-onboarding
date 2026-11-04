import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

test("isolated HR/employee cookie jars, activation login, logout and password rotation", async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Use a dedicated _test database");
  process.env.SMTP_MODE = "disabled";
  const { pool } = await import("../src/repositories/db.js");
  const { createApp } = await import("../src/app/index.js");
  const { config } = await import("../src/config/index.js");
  const { hashPassword, digest, randomToken } =
    await import("../src/auth/security.js");
  const { sessionCookieName } = await import("../src/auth/session.js");
  const { rotateLocalEmployeePassword } =
    await import("../src/services/rotate-local-password.js");
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hrPassword = randomBytes(24).toString("base64url"),
    employeePassword = randomBytes(24).toString("base64url");
  type Jar = { cookie: string; csrf: string };
  const hr: Jar = { cookie: "", csrf: "" },
    privateEmployee: Jar = { cookie: "", csrf: "" },
    otherHr: Jar = { cookie: "", csrf: "" };
  async function request(
    jar: Jar,
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
        ...(jar.cookie ? { Cookie: jar.cookie } : {}),
        ...(jar.csrf ? { "X-CSRF-Token": jar.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    const cookie = r.headers.get("set-cookie");
    if (cookie)
      jar.cookie =
        /expires=Thu, 01 Jan 1970/i.test(cookie) || /max-age=0/i.test(cookie)
          ? ""
          : cookie.split(";")[0];
    if (data.data?.csrf_token) jar.csrf = data.data.csrf_token;
    return {
      status: r.status,
      data,
      cookie_attributes: cookie?.replace(/^[^;]+/, "[redacted]"),
      sets_cookie: !!cookie,
    };
  }
  try {
    await pool.query(
      "TRUNCATE sessions,invitations,onboarding_jobs,employees,user_accounts CASCADE",
    );
    await pool.query(
      "INSERT INTO user_accounts(username,password_hash,account_role) VALUES('fixture.hr',$1,'hr')",
      [await hashPassword(hrPassword)],
    );
    const employeeId = (
      await pool.query(
        "INSERT INTO employees(first_name,last_name,personal_email,department,role,start_date,status) VALUES('Own','Fixture','own.fixture@example.invalid','IT','Test','2026-11-03','approved') RETURNING id",
      )
    ).rows[0].id;
    const otherId = (
      await pool.query(
        "INSERT INTO employees(first_name,last_name,personal_email,department,role,start_date) VALUES('Other','Fixture','other.fixture@example.invalid','IT','Test','2026-11-03') RETURNING id",
      )
    ).rows[0].id;
    const token = randomToken();
    await pool.query(
      "INSERT INTO invitations(employee_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [employeeId, digest(token)],
    );
    const activation = await request(
      privateEmployee,
      "/api/invitations/activate",
      "POST",
      { token, username: "fixture.employee", password: employeePassword },
    );
    assert.equal(activation.status, 201);
    assert.equal(activation.data.data.role, "employee");
    assert.equal(activation.sets_cookie, false);
    assert.equal((await request(privateEmployee, "/api/auth/me")).status, 401);
    const login = await request(hr, "/api/auth/login", "POST", {
      username: "fixture.hr",
      password: hrPassword,
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.data.user.role, "hr");
    assert.ok(hr.cookie.startsWith(sessionCookieName + "="));
    assert.match(login.cookie_attributes!, /HttpOnly/i);
    assert.match(login.cookie_attributes!, /SameSite=Lax/i);
    assert.doesNotMatch(login.cookie_attributes!, /Domain=/i);
    assert.equal(
      (
        await request(otherHr, "/api/auth/login", "POST", {
          username: "fixture.hr",
          password: hrPassword,
        })
      ).status,
      200,
    );
    const forgedRole = await request(
      privateEmployee,
      "/api/auth/login",
      "POST",
      { username: "fixture.employee", password: employeePassword, role: "hr" },
    );
    assert.equal(forgedRole.status, 400);
    const employeeLogin = await request(
      privateEmployee,
      "/api/auth/login",
      "POST",
      { username: "fixture.employee", password: employeePassword },
    );
    assert.equal(employeeLogin.status, 200);
    assert.equal(employeeLogin.data.data.user.role, "employee");
    assert.equal((await request(hr, "/api/auth/me")).data.data.user.role, "hr");
    assert.equal(
      (await request(privateEmployee, "/api/auth/me")).data.data.employee.id,
      employeeId,
    );
    assert.equal(
      (await request(privateEmployee, "/api/auth/me?employee_id=" + otherId))
        .data.data.employee.id,
      employeeId,
    );
    for (const path of [
      "/api/hr/employees",
      "/api/hr/employees/" + employeeId,
      "/api/hr/employees/" + otherId,
    ])
      assert.equal((await request(privateEmployee, path)).status, 403);
    assert.equal(
      (
        await request(
          privateEmployee,
          "/api/hr/employees/" + otherId + "/approve",
          "POST",
        )
      ).status,
      403,
    );
    assert.equal((await request(hr, "/api/employee/dashboard")).status, 403);
    assert.equal(
      (await request(privateEmployee, "/api/employee/dashboard")).data.data
        .areas.length,
      4,
    );
    const denied = await request(hr, "/api/auth/login", "POST", {
      username: "missing.employee",
      password: employeePassword,
    });
    assert.equal(denied.status, 401);
    assert.equal(denied.data.error.code, "INVALID_CREDENTIALS");
    assert.equal(denied.sets_cookie, false);
    assert.equal((await request(hr, "/api/auth/me")).data.data.user.role, "hr");
    assert.equal(
      (
        await request(privateEmployee, "/api/auth/logout", "POST", undefined, {
          "X-CSRF-Token": "incorrect-diagnostic",
        })
      ).status,
      403,
    );
    assert.equal((await request(privateEmployee, "/api/auth/me")).status, 200);
    const employeeCookie = privateEmployee.cookie;
    assert.equal(
      (await request(privateEmployee, "/api/auth/logout", "POST")).status,
      200,
    );
    assert.equal(privateEmployee.cookie, "");
    assert.equal(
      (await request({ cookie: employeeCookie, csrf: "" }, "/api/auth/me"))
        .status,
      401,
    );
    assert.equal((await request(otherHr, "/api/auth/me")).status, 200);
    assert.equal(
      (await request(privateEmployee, "/api/auth/logout", "POST")).status,
      200,
    );
    assert.equal(
      (
        await request(privateEmployee, "/api/auth/logout", "POST", undefined, {
          Origin: "https://not-the-app.invalid",
        })
      ).status,
      403,
    );
    // A legacy cookie from another localhost application is never accepted or cleared.
    const rawHrCookie = hr.cookie;
    assert.equal(
      (
        await request(
          { cookie: "session=" + rawHrCookie.split("=")[1], csrf: "" },
          "/api/auth/me",
        )
      ).status,
      401,
    );
    const legacyLogout = await request(
      { cookie: "session=other-application-cookie", csrf: "" },
      "/api/auth/logout",
      "POST",
    );
    assert.equal(legacyLogout.status, 200);
    // Explicitly switch one browser jar; a separate HR jar remains independent.
    assert.equal(
      (
        await request(hr, "/api/auth/login", "POST", {
          username: "fixture.employee",
          password: employeePassword,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(hr, "/api/auth/me")).data.data.user.role,
      "employee",
    );
    assert.equal(
      (await request({ cookie: rawHrCookie, csrf: "" }, "/api/auth/me")).status,
      401,
    );
    assert.equal(
      (await request(otherHr, "/api/auth/me")).data.data.user.role,
      "hr",
    );
    const replacement = randomBytes(24).toString("base64url");
    await rotateLocalEmployeePassword("fixture.employee", replacement);
    assert.equal((await request(hr, "/api/auth/me")).status, 401);
    assert.equal((await request(otherHr, "/api/auth/me")).status, 200);
    assert.equal(
      (
        await request(privateEmployee, "/api/auth/login", "POST", {
          username: "fixture.employee",
          password: employeePassword,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(privateEmployee, "/api/auth/login", "POST", {
          username: "fixture.employee",
          password: replacement,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(privateEmployee, "/api/auth/me")).data.data.employee.id,
      employeeId,
    );
    await assert.rejects(() =>
      rotateLocalEmployeePassword("fixture.hr", replacement),
    );
    // Expiry does not leave an uncleared browser cookie after logout.
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [activation.data.data.id],
    );
    assert.equal((await request(privateEmployee, "/api/auth/me")).status, 401);
    assert.equal(
      (await request(privateEmployee, "/api/auth/logout", "POST")).status,
      200,
    );
    assert.equal(privateEmployee.cookie, "");
    const state = (
      await pool.query(
        "SELECT e.status,i.used_at IS NOT NULL AS invitation_used FROM employees e JOIN invitations i ON i.employee_id=e.id WHERE e.id=$1",
        [employeeId],
      )
    ).rows[0];
    assert.equal(state.status, "active");
    assert.equal(state.invitation_used, true);
  } finally {
    server.close();
    await pool.end();
  }
});
