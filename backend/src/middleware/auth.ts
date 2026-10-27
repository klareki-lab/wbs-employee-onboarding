import type { Request, RequestHandler } from "express";
import { pool } from "../repositories/db.js";
import { digest, equal } from "../auth/security.js";
import { config } from "../config/index.js";
import { ApiError } from "./errors.js";
export type Principal = {
  id: string;
  username: string;
  account_role: "hr" | "employee";
  employee_id: string | null;
  csrf_token: string;
};
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
export const authenticate: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.session;
  if (typeof token !== "string") throw new ApiError(401, "UNAUTHENTICATED");
  const result = await pool.query(
    "SELECT u.id,u.username,u.account_role,u.employee_id,s.csrf_token FROM sessions s JOIN user_accounts u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  if (!result.rowCount) throw new ApiError(401, "UNAUTHENTICATED");
  req.principal = result.rows[0];
  next();
};
export const role =
  (required: "hr" | "employee"): RequestHandler =>
  (req, res, next) => {
    if (req.principal?.account_role !== required)
      throw new ApiError(403, "FORBIDDEN");
    next();
  };
export const csrf: RequestHandler = (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    (!req.principal ||
      !equal(req.get("X-CSRF-Token") ?? "", req.principal.csrf_token))
  )
    throw new ApiError(403, "CSRF_INVALID");
  next();
};
export const internal: RequestHandler = (req, res, next) => {
  if (
    !equal(
      req.get("Authorization") ?? "",
      `Bearer ${config.INTERNAL_API_SECRET}`,
    )
  )
    throw new ApiError(401, "UNAUTHENTICATED");
  next();
};
export const browserOrigin: RequestHandler = (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !req.path.startsWith("/api/internal/") &&
    req.get("Origin") !== config.APP_ORIGIN
  )
    throw new ApiError(403, "ORIGIN_INVALID");
  next();
};
