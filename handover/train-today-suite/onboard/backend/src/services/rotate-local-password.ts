import { z } from "zod";
import { config } from "../config/index.js";
import { transaction } from "../repositories/db.js";
import { hashPassword } from "../auth/security.js";

export async function rotateLocalEmployeePassword(
  username: string,
  newPassword: string,
) {
  if (config.NODE_ENV === "production")
    throw new Error("Local rotation is unavailable in production");
  z.string()
    .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/)
    .parse(username);
  z.string().min(12).max(128).parse(newPassword);
  const hash = await hashPassword(newPassword);
  return transaction(async (db) => {
    const account = (
      await db.query(
        "SELECT u.id,u.account_role,e.status FROM user_accounts u JOIN employees e ON e.id=u.employee_id WHERE username=$1 FOR UPDATE OF u",
        [username],
      )
    ).rows[0];
    if (
      !account ||
      account.account_role !== "employee" ||
      account.status !== "active"
    )
      throw new Error("An existing active employee account is required");
    await db.query("UPDATE user_accounts SET password_hash=$2 WHERE id=$1", [
      account.id,
      hash,
    ]);
    const revoked = await db.query("DELETE FROM sessions WHERE user_id=$1", [
      account.id,
    ]);
    return { username, rotated: true, revoked_sessions: revoked.rowCount };
  });
}
