import { pool } from "./repositories/db.js";
import { rotateLocalEmployeePassword } from "./services/rotate-local-password.js";
try {
  console.log(
    JSON.stringify(
      await rotateLocalEmployeePassword(
        process.argv[2],
        process.env.NEW_PASSWORD ?? "",
      ),
    ),
  );
} catch {
  console.error(
    "Employee password rotation failed; verify the existing username and password policy. No credentials logged.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
