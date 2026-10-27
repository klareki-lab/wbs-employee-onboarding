import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export const errors: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    });
    return;
  }
  const code =
    error instanceof ApiError
      ? error.code
      : error.code === "23505"
        ? "CONFLICT"
        : error.type === "entity.parse.failed"
          ? "INVALID_JSON"
          : error.status === 413
            ? "PAYLOAD_TOO_LARGE"
            : "INTERNAL_ERROR";
  const status =
    error instanceof ApiError
      ? error.status
      : error.code === "23505"
        ? 409
        : error.type === "entity.parse.failed"
          ? 400
          : error.status === 413
            ? 413
            : 500;
  // Deliberately never log request URL, body, cookies, or database error details.
  if (status === 500)
    console.error(
      JSON.stringify({ event: "request_failed", method: req.method, code }),
    );
  res.status(status).json({ error: { code } });
};
