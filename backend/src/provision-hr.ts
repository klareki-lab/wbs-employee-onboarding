import { z } from "zod";
import { pool } from "./repositories/db.js";
import { hashPassword } from "./auth/security.js";
try {
  const username = z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/)
    .parse(process.env.HR_USERNAME);
  const password = z.string().min(12).max(128).parse(process.env.HR_PASSWORD);
  await pool.query(
    "INSERT INTO user_accounts(username,password_hash,account_role) VALUES($1,$2,'hr')",
    [username, await hashPassword(password)],
  );
  console.log("HR account provisioned");
} finally {
  await pool.end();
}
