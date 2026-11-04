import { Router } from "express";
import { z } from "zod";
import { pool, transaction } from "../repositories/db.js";
import { digest, hashPassword } from "../auth/security.js";
import { ApiError } from "../middleware/errors.js";
import { activationLimit } from "./auth.js";
export const invitations = Router();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const activeCondition =
  "i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND e.status='approved'";
invitations.get("/validate", activationLimit, async (req, res) => {
  const token = tokenSchema.parse(req.query.token);
  const result = await pool.query(
    `SELECT e.first_name,e.last_name,i.expires_at FROM invitations i JOIN employees e ON e.id=i.employee_id WHERE i.token_hash=$1 AND ${activeCondition}`,
    [digest(token)],
  );
  res.set("Cache-Control", "no-store");
  if (!result.rowCount) throw new ApiError(410, "INVITATION_INVALID");
  res.json({ data: result.rows[0] });
});
invitations.post("/activate", activationLimit, async (req, res) => {
  const input = z
    .object({
      token: tokenSchema,
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(req.body);
  // Hash before acquiring a row lock to keep the database transaction short.
  const passwordHash = await hashPassword(input.password);
  const result = await transaction(async (db) => {
    const candidate = (
      await db.query(
        "SELECT employee_id FROM invitations WHERE token_hash=$1",
        [digest(input.token)],
      )
    ).rows[0];
    if (!candidate) throw new ApiError(410, "INVITATION_INVALID");
    await db.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
      candidate.employee_id,
    ]);
    const found = await db.query(
      `SELECT i.id,i.employee_id FROM invitations i JOIN employees e ON e.id=i.employee_id WHERE i.token_hash=$1 AND ${activeCondition} FOR UPDATE OF e,i`,
      [digest(input.token)],
    );
    if (!found.rowCount) throw new ApiError(410, "INVITATION_INVALID");
    const invitation = found.rows[0];
    const account = await db.query(
      "INSERT INTO user_accounts(employee_id,username,password_hash,account_role) VALUES($1,$2,$3,'employee') RETURNING id,username,employee_id",
      [invitation.employee_id, input.username, passwordHash],
    );
    await db.query("UPDATE invitations SET used_at=now() WHERE id=$1", [
      invitation.id,
    ]);
    await db.query(
      "UPDATE employees SET status='active',updated_at=now() WHERE id=$1",
      [invitation.employee_id],
    );
    return account.rows[0];
  });
  res.status(201).json({ data: { ...result, role: "employee" } });
});
