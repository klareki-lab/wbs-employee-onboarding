import { pool } from "./repositories/db.js";
import { recoverLocalJob } from "./services/recover-local-job.js";
try {
  const [employeeId, count, reason] = process.argv.slice(2);
  console.log(
    JSON.stringify(await recoverLocalJob(employeeId, Number(count), reason)),
  );
} finally {
  await pool.end();
}
