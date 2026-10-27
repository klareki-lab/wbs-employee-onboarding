import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  ONBOARDING_WORKER_EMPLOYEE_ID: z.uuid().optional(),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  N8N_ONBOARDING_WEBHOOK_URL: z.url().optional(),
  N8N_ONBOARDING_WEBHOOK_SECRET: z.string().min(32).optional(),
  INTERNAL_API_SECRET: z.string().min(32),
  DEPARTMENTS_API_SECRET: z.string().min(32).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.email().default("onboarding@example.invalid"),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  INVITATION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
});
export const config = schema.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);
if (config.N8N_ONBOARDING_WEBHOOK_URL && !config.N8N_ONBOARDING_WEBHOOK_SECRET)
  throw new Error("Webhook secret required");
if (
  config.NODE_ENV === "production" &&
  (!config.APP_ORIGIN.startsWith("https://") ||
    (config.N8N_ONBOARDING_WEBHOOK_URL &&
      !config.N8N_ONBOARDING_WEBHOOK_URL.startsWith("https://")))
)
  throw new Error("HTTPS required in production");
if (new URL(config.APP_ORIGIN).origin !== config.APP_ORIGIN)
  throw new Error("APP_ORIGIN must be an exact origin without trailing slash");
