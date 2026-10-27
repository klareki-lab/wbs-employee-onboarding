import type { Request, RequestHandler } from "express";
import { equal } from "../auth/security.js";
import { config } from "../config/index.js";
import { ApiError } from "./errors.js";
import { findPrincipal, type Principal } from "../auth/session.js";
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
export const authenticate: RequestHandler = async (req, res, next) => {
  const principal = await findPrincipal(req);
  if (!principal) throw new ApiError(401, "UNAUTHENTICATED");
  req.principal = principal;
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
