import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool, transaction } from "../repositories/db.js";
import {
  hashPassword,
  verifyPassword,
  randomToken,
  digest,
} from "../auth/security.js";
import { authenticate, csrf, role } from "../middleware/auth.js";
import { ApiError } from "../middleware/errors.js";
import { config } from "../config/index.js";
export const auth = Router();
const attempts = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED" } },
});
const dummyHash = hashPassword(randomToken());
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
auth.post("/auth/login", attempts, async (req, res) => {
  const input = z
    .object({
      username: z.string().trim().toLowerCase().min(1).max(64),
      password: z.string().min(1).max(128),
    })
    .strict()
    .parse(req.body);
  const user = (
    await pool.query("SELECT * FROM user_accounts WHERE username=$1", [
      input.username,
    ])
  ).rows[0];
  const valid = await verifyPassword(
    user?.password_hash ?? (await dummyHash),
    input.password,
  );
  if (!user || !valid) throw new ApiError(401, "INVALID_CREDENTIALS");
  const token = randomToken(),
    csrfToken = randomToken();
  await transaction(async (db) => {
    if (typeof req.cookies?.session === "string")
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies.session),
      ]);
    await db.query("DELETE FROM sessions WHERE expires_at<=now()");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')",
      [digest(token), user.id, csrfToken, config.SESSION_HOURS],
    );
  });
  res
    .cookie("session", token, {
      ...cookieOptions,
      maxAge: config.SESSION_HOURS * 3600000,
    })
    .json({
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.account_role,
          employee_id: user.employee_id,
        },
        csrf_token: csrfToken,
      },
    });
});
auth.get("/auth/me", authenticate, async (req, res) => {
  const p = req.principal!;
  const employee = p.employee_id
    ? (
        await pool.query(
          "SELECT id,first_name,last_name,personal_email,department,role,start_date::text,status FROM employees WHERE id=$1",
          [p.employee_id],
        )
      ).rows[0]
    : null;
  res.json({
    data: {
      user: {
        id: p.id,
        username: p.username,
        role: p.account_role,
        employee_id: p.employee_id,
      },
      employee,
      csrf_token: p.csrf_token,
    },
  });
});
auth.post("/auth/logout", authenticate, csrf, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
    digest(req.cookies.session),
  ]);
  res
    .clearCookie("session", cookieOptions)
    .json({ data: { logged_out: true } });
});
auth.get("/employee/dashboard", authenticate, role("employee"), (req, res) => {
  res.json({
    data: {
      areas: [
        { id: "company-rules", title: "Company Rules" },
        { id: "my-training", title: "My Training" },
        { id: "my-team", title: "My Team" },
        { id: "my-tasks", title: "My Tasks" },
      ],
      placeholder: true,
    },
  });
});
export const activationLimit = attempts;
