import { createApp } from "./app/index.js";
import { config } from "./config/index.js";
import { pool } from "./repositories/db.js";
import { startWorker } from "./integrations/n8n.js";
await pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
const server = createApp().listen(config.PORT, "0.0.0.0", () =>
  console.log(`Backend listening on ${config.PORT}`),
);
const stop = startWorker();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stop();
    server.close(() => {
      void pool.end();
    });
    setTimeout(() => process.exit(1), 15000).unref();
  });
