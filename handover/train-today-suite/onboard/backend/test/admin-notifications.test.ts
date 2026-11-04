import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

test("admin outbox: authenticated registration, replay deduplication, concurrent delivery, content and uncertain-send safety", async () => {
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) throw new Error("Dedicated test database required");
  process.env.SYSTEM_ADMIN_EMAIL = "systemadmin@example.invalid";
  process.env.SMTP_MODE = "capture";
  const { pool } = await import("../src/repositories/db.js");
  const { hashPassword } = await import("../src/auth/security.js");
  const { config } = await import("../src/config/index.js");
  const { createApp } = await import("../src/app/index.js");
  const { dispatchAdminNotification } = await import("../src/integrations/admin-notifications.js");
  const { mailer } = await import("../src/integrations/email.js");
  const server = createApp().listen(0,"127.0.0.1");
  await once(server,"listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = "", csrf = "";
  async function call(path: string, body?: unknown) {
    const r = await fetch(base+path,{method:body === undefined ? "GET":"POST",headers:{Origin:config.APP_ORIGIN,"Content-Type":"application/json",Cookie:cookie,"X-CSRF-Token":csrf},body:body === undefined ? undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]??""};
  }
  try {
    await pool.query("TRUNCATE sessions,invitations,onboarding_jobs,employees,user_accounts CASCADE");
    const password=randomBytes(24).toString("base64url");
    await pool.query("INSERT INTO user_accounts(username,password_hash,account_role) VALUES('test.adminmail',$1,'hr')",[await hashPassword(password)]);
    assert.equal((await call('/api/hr/departments')).status,401);
    const login=await call('/api/auth/login',{username:'test.adminmail',password});
    cookie=login.cookie; csrf=login.body.data.csrf_token;
    assert.equal((await call('/api/hr/departments')).status,200);
    const employee={first_name:'Test',last_name:'Adminhinweis',personal_email:'admin-outbox@example.invalid',department:'IT',role:'IT Support',start_date:'2026-11-02'};
    const registered=await call('/api/onboarding',employee);
    assert.equal(registered.status,201);
    assert.equal((await call('/api/onboarding',employee)).status,200);
    assert.equal((await pool.query('SELECT count(*)::int n FROM admin_notifications')).rows[0].n,1);
    await Promise.all([dispatchAdminNotification(),dispatchAdminNotification()]);
    const rows=(await pool.query('SELECT * FROM admin_notifications')).rows;
    assert.equal(rows[0].status,'captured');
    const detail=await call('/api/hr/employees/'+registered.body.data.employee_id);
    assert.equal(detail.body.data.admin_notification.status,'captured');
    const mailBase=process.env.MAILPIT_API_URL!;
    const list=await (await fetch(mailBase+'/api/v1/messages')).json();
    const messages=list.messages.filter((m:any)=>m.Subject.includes('Test Adminhinweis'));
    // Match the current message by its employee ID, so the test can be rerun safely.
    let matched=0;
    for(const m of messages) {
      const mail=await (await fetch(mailBase+'/api/v1/message/'+m.ID)).json();
      if(!mail.Text.includes(registered.body.data.employee_id)) continue;
      matched++;
      assert.equal(m.To[0].Address,'systemadmin@example.invalid');
      for(const value of ['2026-11-02','IT Support','GitHub','ERP','CRM',employee.personal_email]) assert.ok(mail.Text.includes(value));
      assert.ok(!mail.Text.includes(password));
    }
    assert.equal(matched,1);
    const second=await call('/api/onboarding',{...employee,personal_email:'admin-outbox-failure@example.invalid'});
    const send = mailer!.sendMail;
    Object.defineProperty(mailer,'sendMail',{configurable:true,writable:true,value:async()=>{throw new Error('SMTP timeout');}});
    try { await dispatchAdminNotification(); } finally { Object.defineProperty(mailer,'sendMail',{configurable:true,writable:true,value:send}); }
    await dispatchAdminNotification();
    assert.equal((await pool.query('SELECT status FROM admin_notifications WHERE employee_id=$1',[second.body.data.employee_id])).rows[0].status,'unknown');
    assert.equal((await pool.query('SELECT count(*)::int n FROM employees')).rows[0].n,2);
  } finally { server.close(); await pool.end(); }
});
