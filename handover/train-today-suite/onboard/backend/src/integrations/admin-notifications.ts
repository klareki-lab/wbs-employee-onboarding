import { config } from "../config/index.js";
import { pool, transaction } from "../repositories/db.js";
import { mailer } from "./email.js";
import type { PoolClient } from "pg";

export async function queueAdminNotification(db: PoolClient, employeeId: string) {
  if (!config.SYSTEM_ADMIN_EMAIL) return;
  await db.query(
    "INSERT INTO admin_notifications(employee_id,recipient) VALUES($1,$2) ON CONFLICT(employee_id) DO NOTHING",
    [employeeId, config.SYSTEM_ADMIN_EMAIL],
  );
}

export async function dispatchAdminNotification() {
  if (!mailer) return;
  // A crash after sending is ambiguous: preserve it for review, never blindly resend.
  await pool.query("UPDATE admin_notifications SET status='unknown',error_code='DELIVERY_UNCONFIRMED' WHERE status='sending' AND attempted_at < now()-interval '5 minutes'");
  const job = await transaction(async db => {
    const found = (await db.query("SELECT * FROM admin_notifications WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if (!found) return null;
    await db.query("UPDATE admin_notifications SET status='sending',attempted_at=now() WHERE id=$1",[found.id]);
    return found;
  });
  if (!job) return;
  try {
    const employee = (await pool.query("SELECT e.id,e.first_name,e.last_name,e.personal_email,e.department,e.role,e.start_date::text,d.team_lead,d.necessary_accounts FROM employees e JOIN departments d ON d.name=e.department WHERE e.id=$1",[job.employee_id])).rows[0];
    const subject = `Neuer Mitarbeiter: ${employee.first_name} ${employee.last_name} - Eintritt ${employee.start_date}`;
    const text = [
      "Hallo Systemadministration,", "", "HR hat einen neuen Mitarbeiter angelegt. Bitte die ERP- und CRM-Benutzer vorbereiten und die erforderlichen Berechtigungen mit der verantwortlichen Leitung abstimmen.", "",
      `Name: ${employee.first_name} ${employee.last_name}`,
      `Eintrittsdatum: ${employee.start_date}`,
      `Position: ${employee.role}`,
      `Abteilung: ${employee.department}`,
      `Teamleitung: ${employee.team_lead}`,
      `Kontaktadresse: ${employee.personal_email}`,
      `Benötigte Systeme laut Abteilung: ${employee.necessary_accounts.join(", ")}`,
      `Mitarbeiter-ID: ${employee.id}`, "",
      `HR-Karte: ${config.APP_ORIGIN}/hr/employees/${employee.id}`, "",
      "ERP/CRM-Konten werden hierdurch noch nicht automatisch angelegt. Bitte Aktivierungslinks oder einmalige Zugänge separat übermitteln. Diese Nachricht enthält keine Passwörter.",
    ].join("\n");
    const result = await mailer.sendMail({from:config.SMTP_FROM,to:{address:job.recipient,name:""},envelope:{from:config.SMTP_FROM,to:[job.recipient]},subject,text});
    if (!result.accepted?.length) throw new Error("ADMIN_DELIVERY_UNCONFIRMED");
    const status = config.SMTP_MODE === "capture" ? "captured" : "sent";
    await pool.query("UPDATE admin_notifications SET status=$2,sent_at=now(),error_code=NULL WHERE id=$1",[job.id,status]);
  } catch {
    await pool.query("UPDATE admin_notifications SET status='unknown',error_code='ADMIN_DELIVERY_UNCONFIRMED' WHERE id=$1",[job.id]);
  }
}

export function startAdminNotificationWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    dispatchAdminNotification().catch(() => console.error("Admin notification worker failed")).finally(() => { running = false; });
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
