import { config } from "./config/index.js";
import { mailer } from "./integrations/email.js";

try {
  if (config.SMTP_MODE !== "external" || !mailer) {
    throw Object.assign(new Error("External SMTP is not configured"), {
      code: "SMTP_NOT_CONFIGURED",
    });
  }
  await mailer.verify();
  console.log(
    JSON.stringify({
      smtp_connection: "verified",
      authentication: "verified",
      tls_required: true,
      certificate_validation: true,
      message_sent: false,
      sender_authorization: "requires provider confirmation",
      inbox_delivery: "not_tested",
    }),
  );
} catch (error) {
  const rawCode = (error as { code?: string }).code;
  const code =
    rawCode && /^[A-Z_]{2,40}$/.test(rawCode) ? rawCode : "SMTP_VERIFY_FAILED";
  // Never print provider responses: they can echo authentication data or mailbox addresses.
  console.error(
    JSON.stringify({ smtp_connection: "failed", code, message_sent: false }),
  );
  process.exitCode = 1;
} finally {
  mailer?.close();
}
