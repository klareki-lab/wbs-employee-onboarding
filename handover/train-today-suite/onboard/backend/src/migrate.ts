import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "./repositories/db.js";
try {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(77891234)");
    await db.query("CREATE SCHEMA IF NOT EXISTS employee_onboarding");
    await db.query(
      "CREATE TABLE IF NOT EXISTS employee_onboarding.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("../../database/migrations/", import.meta.url);
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query(
            "SELECT 1 FROM employee_onboarding.schema_migrations WHERE name=$1",
            [name],
          )
        ).rowCount
      )
        continue;
      await db.query(await readFile(new URL(name, directory), "utf8"));
      await db.query(
        "INSERT INTO employee_onboarding.schema_migrations(name) VALUES($1)",
        [name],
      );
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await pool.end();
}
