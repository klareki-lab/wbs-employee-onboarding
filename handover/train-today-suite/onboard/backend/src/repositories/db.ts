import pg from "pg";
import { config } from "../config/index.js";
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  options: "-c search_path=employee_onboarding",
  max: 10,
});
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
