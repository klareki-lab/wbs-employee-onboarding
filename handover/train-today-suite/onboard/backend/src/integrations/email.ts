import nodemailer from "nodemailer";
import { config } from "../config/index.js";
export const mailer =
  config.SMTP_HOST && config.SMTP_MODE !== "disabled"
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE === "true",
        requireTLS:
          config.SMTP_MODE === "external" || config.NODE_ENV === "production",
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
        disableFileAccess: true,
        disableUrlAccess: true,
        auth: config.SMTP_USER
          ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
          : undefined,
        connectionTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
      })
    : null;
export async function sendInvitation(
  email: string,
  firstName: string,
  token: string,
) {
  if (!mailer) throw new Error("EMAIL_UNAVAILABLE");
  const url = new URL("/activate", config.APP_ORIGIN);
  url.hash = new URLSearchParams({ token }).toString();
  const result = await mailer.sendMail({
    from: config.SMTP_FROM,
    to: { address: email, name: "" },
    envelope: { from: config.SMTP_FROM, to: [email] },
    subject: "Willkommen im Team – Dein Zugang zum Mitarbeiterportal",
    text: `Hallo ${firstName},\n\nwillkommen im Team! Bitte wähle deinen Benutzernamen und dein Passwort unter:\n${url}\n\nDieser Link ist ${config.INVITATION_HOURS} Stunden gültig und kann nur einmal verwendet werden.\n\nDein HR-Team`,
  });
  if (!result.accepted?.length) throw new Error("SMTP_REJECTED");
}
