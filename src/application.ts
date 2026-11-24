import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { systemDb, databaseAuthentication } from "./db.js";
import { HttpError, endpoint } from "./http.js";
import { budgetRoutes } from "./budget.js";
import { inventoryRoutes } from "./inventory.js";
import { catalogueRoutes } from "./catalogue.js";
import { planningRoutes } from "./planning.js";
import { assistantRoutes } from "./assistant.js";
import { openapi } from "./contract.js";
import { CalculationError } from "./domain.js";
import { authRoutes, authenticate, allowedOrigins } from "./auth.js";
import { adminRoutes } from "./admin.js";

export function createApp(app = express()) {
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/", (_req, res) => res.json({
    service: "Homewise API",
    status: "running",
    health: "/api/v1/health",
    documentation: "/api/v1/openapi.json",
  }));
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || allowedOrigins().has(origin)),
      credentials: true,
      allowedHeaders: ["Content-Type", "Idempotency-Key", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "3mb" }));
  app.use("/api/v1/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  endpoint(
    app,
    "get",
    "/health",
    "SQL Server connection and application readiness",
    undefined,
    async () => {
      const versions: any =
        await systemDb.$queryRaw`SELECT CONVERT(nvarchar(30), SERVERPROPERTY('ProductVersion')) AS version`;
      return {
        status: "ok",
        database: process.env.SQL_SERVER?.toLowerCase().endsWith(".database.windows.net") ? "Azure SQL Database" : "SQL Server",
        version: versions[0].version,
        authentication: databaseAuthentication === "windows" ? "Windows" : "SQL",
      };
    },
  );
  authRoutes(app);
  app.get("/api/v1/openapi.json", (_, res) => res.json(openapi()));
  app.use("/api/v1", authenticate);
  adminRoutes(app);
  budgetRoutes(app);
  inventoryRoutes(app);
  catalogueRoutes(app);
  planningRoutes(app);
  assistantRoutes(app);
  app.use((_req, res) =>
    res.status(404).json({ error: { message: "API route was not found." } }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(422).json({
          error: {
            message: "Please correct the highlighted values.",
            details: error.issues,
          },
        });
        return;
      }
      if (error instanceof HttpError) {
        res
          .status(error.status)
          .json({ error: { message: error.message, details: error.details } });
        return;
      }
      if (error instanceof CalculationError) {
        res.status(422).json({ error: { message: error.message } });
        return;
      }
      if (error.code === "P2002") {
        res.status(409).json({
          error: {
            message: "A record with this unique value already exists.",
          },
        });
        return;
      }
      if (error.code === "P2025") {
        res.status(404).json({ error: { message: "Record was not found." } });
        return;
      }
      if (error.code === "P2034") {
        res.status(409).json({
          error: {
            message: "A concurrent update occurred. Refresh and retry.",
          },
        });
        return;
      }
      if (error.type === "entity.parse.failed") {
        res
          .status(400)
          .json({ error: { message: "Request body must be valid JSON." } });
        return;
      }
      if (error.type === "entity.too.large") {
        res
          .status(413)
          .json({ error: { message: "Upload is too large (maximum 3 MB)." } });
        return;
      }
      console.error(
        error.name,
        error.code ?? "",
        error.message?.split("\n").slice(-2).join(" "),
      );
      res.status(503).json({
        error: {
          message:
            "The service could not complete this request. Check the API console and SQL Server connection, then retry.",
        },
      });
    },
  );
  return app;
}
