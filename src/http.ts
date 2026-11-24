import type { Express, Request } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 422,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function exists<T>(value: T | null, label = "Record"): T {
  assert(value, `${label} was not found.`, 404);
  return value;
}
export function checkRevision(record: { revision: number }, revision: number) {
  assert(
    record.revision === revision,
    "This record changed. Refresh and review your changes.",
    409,
  );
}
export const key = (request: Request) => {
  const value = request.get("Idempotency-Key");
  assert(
    value && value.length <= 100,
    "An Idempotency-Key header is required.",
  );
  return value;
};
export const uid = () => randomUUID();
export const routes: {
  method: string;
  path: string;
  summary: string;
  body?: z.ZodType;
}[] = [];
export function endpoint(
  app: Express,
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  summary: string,
  schema: z.ZodType | undefined,
  handler: (request: Request<any>, body: any) => Promise<unknown>,
) {
  routes.push({ method, path, summary, body: schema });
  app[method]("/api/v1" + path, async (req, res, next) => {
    try {
      const body = schema ? schema.parse(req.body) : undefined;
      const result = await handler(req, body);
      res.json(result ?? { ok: true });
    } catch (e) {
      next(e);
    }
  });
}
export const paging = (req: Request) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const take = z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .parse(req.query.pageSize);
  return { skip: (page - 1) * take, take };
};
