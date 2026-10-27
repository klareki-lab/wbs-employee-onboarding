import type { Request } from "express";
import { config } from "../config/index.js";
import { pool } from "../repositories/db.js";
import { digest } from "./security.js";

// Cookies are shared across ports. Never use/clear another localhost app's generic `session` cookie.
export const sessionCookieName =
  config.NODE_ENV === "production"
    ? "__Host-wbs_onboarding_session"
    : "wbs_onboarding_session";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
export type Principal = {
  id: string;
  username: string;
  account_role: "hr" | "employee";
  employee_id: string | null;
  csrf_token: string;
};
export async function findPrincipal(
  req: Request,
): Promise<Principal | undefined> {
  const token = req.cookies?.[sessionCookieName];
  if (typeof token !== "string") return undefined;
  return (
    await pool.query(
      "SELECT u.id,u.username,u.account_role,u.employee_id,s.csrf_token FROM sessions s JOIN user_accounts u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
}
