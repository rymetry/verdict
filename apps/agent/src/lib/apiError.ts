import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Single source of truth for the `{ error: { code, message } }` envelope.
 * Routes import this instead of re-typing the object literal everywhere.
 */
export function apiError(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode
): Response {
  return c.json({ error: { code, message } }, status);
}
