import type { Express } from "express";
import { z } from "zod";
import { systemDb } from "./db.js";
import { assert, endpoint, exists, checkRevision, paging } from "./http.js";
import { currentIdentity } from "./tenant.js";
import { userSelect, createAccount, registration, password } from "./auth.js";
import { hashPassword } from "./passwords.js";

function administrator() {
  const actor = currentIdentity();
  assert(actor.role === "admin", "Administrator access is required.", 403);
  return actor;
}
export function adminRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  e(
    "get",
    "/admin/summary",
    "Account management overview for administrators",
    undefined,
    async () => {
      administrator();
      const [users, activeUsers, admins, households, sessions, audit] =
        await Promise.all([
          systemDb.user.count(),
          systemDb.user.count({ where: { active: true } }),
          systemDb.user.count({ where: { role: "admin", active: true } }),
          systemDb.household.count(),
          systemDb.authSession.count({
            where: { revokedAt: null, expiresAt: { gt: new Date() } },
          }),
          systemDb.adminAudit.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);
      return { users, activeUsers, admins, households, sessions, audit };
    },
  );
  e(
    "get",
    "/admin/users",
    "List user roles, account state and household names",
    undefined,
    async (req) => {
      administrator();
      const search = z
        .string()
        .max(120)
        .parse(req.query.q ?? "");
      return systemDb.user.findMany({
        ...paging(req),
        where: search
          ? {
              OR: [
                { email: { contains: search } },
                { name: { contains: search } },
              ],
            }
          : {},
        select: {
          ...userSelect,
          household: { select: { name: true, location: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    },
  );
  e(
    "post",
    "/admin/users",
    "Create a managed household or administrator account",
    registration.extend({ role: z.enum(["household", "admin"]) }),
    async (_, b) => {
      const actor = administrator();
      return createAccount(b, b.role, actor.userId);
    },
  );
  e(
    "patch",
    "/admin/users/:id",
    "Manage account name, role and active state",
    z
      .object({
        revision: z.number().int().positive(),
        name: z.string().trim().min(1).max(120),
        role: z.enum(["household", "admin"]),
        active: z.boolean(),
      })
      .strict(),
    async (req, b) => {
      const actor = administrator();
      return systemDb.$transaction(
        async (tx) => {
          const target = exists(
            await tx.user.findUnique({ where: { id: req.params.id } }),
            "User",
          );
          checkRevision(target, b.revision);
          assert(
            target.id !== actor.userId || (b.active && b.role === "admin"),
            "You cannot disable or demote your own administrator account.",
            409,
          );
          if (
            target.active &&
            target.role === "admin" &&
            (!b.active || b.role !== "admin")
          )
            assert(
              (await tx.user.count({
                where: { role: "admin", active: true },
              })) > 1,
              "Keep at least one active administrator.",
              409,
            );
          const user = await tx.user.update({
            where: { id: target.id },
            data: {
              name: b.name,
              role: b.role,
              active: b.active,
              revision: { increment: 1 },
            },
            select: userSelect,
          });
          if (target.role !== b.role || target.active !== b.active)
            await tx.authSession.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          await tx.adminAudit.create({
            data: {
              actorId: actor.userId,
              targetId: target.id,
              action: `Set role=${b.role}, active=${b.active}`,
            },
          });
          return user;
        },
        { isolationLevel: "Serializable" },
      );
    },
  );
  e(
    "post",
    "/admin/users/:id/revoke-sessions",
    "Revoke all sign-ins for a user",
    z.object({ revision: z.number().int().positive() }).strict(),
    async (req, b) => {
      const actor = administrator();
      return systemDb.$transaction(async (tx) => {
        const user = exists(
          await tx.user.findUnique({ where: { id: req.params.id } }),
          "User",
        );
        checkRevision(user, b.revision);
        const result = await tx.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.adminAudit.create({
          data: {
            actorId: actor.userId,
            targetId: user.id,
            action: "Revoked all sessions",
          },
        });
        return { revoked: result.count };
      });
    },
  );
  e(
    "post",
    "/admin/users/:id/password",
    "Set a replacement password and revoke existing sign-ins",
    z.object({ revision: z.number().int().positive(), password }).strict(),
    async (req, b) => {
      const actor = administrator();
      const passwordHash = await hashPassword(b.password);
      return systemDb.$transaction(async (tx) => {
        const target = exists(
          await tx.user.findUnique({ where: { id: req.params.id } }),
          "User",
        );
        checkRevision(target, b.revision);
        await tx.user.update({
          where: { id: target.id },
          data: { passwordHash, revision: { increment: 1 } },
        });
        await tx.authSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.adminAudit.create({
          data: {
            actorId: actor.userId,
            targetId: target.id,
            action: "Replaced password and revoked sessions",
          },
        });
        return { ok: true };
      });
    },
  );
}
