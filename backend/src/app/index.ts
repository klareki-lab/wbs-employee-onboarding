import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";
import { pool } from "../repositories/db.js";
import { browserOrigin } from "../middleware/auth.js";
import { errors } from "../middleware/errors.js";
import { auth } from "../routes/auth.js";
import { hr } from "../routes/hr.js";
import { tasks } from "../routes/tasks.js";
import { invitations } from "../routes/invitations.js";
import { internal } from "../routes/internal.js";
import { n8nConfigured } from "../integrations/n8n.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(
    helmet(),
    cors({
      origin: config.APP_ORIGIN,
      credentials: true,
      allowedHeaders: ["Content-Type", "X-CSRF-Token", "Authorization"],
    }),
  );
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED" } },
    }),
  );
  app.use(express.json({ limit: "32kb" }), cookieParser(), browserOrigin);
  app.get("/health", async (req, res) => {
    await pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
    res.json({
      data: {
        status: "ok",
        integrations: {
          n8n: n8nConfigured ? "configured" : "unavailable",
          email:
            config.SMTP_HOST && config.SMTP_MODE !== "disabled"
              ? "configured"
              : "unavailable",
        },
      },
    });
  });
  app.use("/api", auth);
  app.use("/api/invitations", invitations);
  app.use("/api/internal", internal);
  app.use("/api", tasks);
  app.use("/api", hr);
  app.use((req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND" } });
  });
  app.use(errors);
  return app;
}
