import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { systemDb } from "./db.js";
import { assert, endpoint, HttpError } from "./http.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { runAsHousehold, type Identity } from "./tenant.js";

export const userSelect = {
  id: true,
  householdId: true,
  email: true,
  name: true,
  role: true,
  active: true,
  demo: true,
  revision: true,
  createdAt: true,
} as const;
const email = z.string().trim().toLowerCase().email().max(254);
export const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128);
export const registration = z
  .object({
    email,
    password,
    name: z.string().trim().min(1).max(120),
    householdName: z.string().trim().min(1).max(120),
  })
  .strict();
const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
const issuer = "homewise-api";
const audience = "homewise-app";
const cookieName = "homewise_refresh";
const lifetime = 7 * 24 * 3600000;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function secret() {
  const value = process.env.JWT_SECRET;
  assert(
    value && Buffer.byteLength(value) >= 32,
    "Authentication needs a signing key. Run npm run auth:setup in api, then restart the API.",
    503,
  );
  return new TextEncoder().encode(value);
}
const cookieOptions = () => ({
  httpOnly: true,
  secure:
    process.env.COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/v1/auth",
});
const refreshCookie = (req: Request) => {
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? value : null;
};
export function allowedOrigins() {
  return new Set([
    process.env.APP_ORIGIN ?? "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
}
function checkOrigin(req: Request) {
  const origin = req.get("Origin");
  assert(
    !origin || allowedOrigins().has(origin),
    "This origin cannot use the authentication service.",
    403,
  );
}
const attempts = new Map<string, { count: number; until: number }>();
function limit(req: Request, action: string, account = "") {
  const now = Date.now();
  for (const [key, entry] of attempts)
    if (entry.until < now) attempts.delete(key);
  assert(
    attempts.size < 10000,
    "Too many authentication requests. Try again later.",
    429,
  );
  const bucket = action + ":" + req.ip + ":" + account;
  const entry = attempts.get(bucket) ?? { count: 0, until: now + 15 * 60000 };
  assert(
    entry.count < (action === "refresh" ? 100 : 20),
    "Too many attempts. Try again in 15 minutes.",
    429,
  );
  entry.count++;
  attempts.set(bucket, entry);
}
async function signed(user: any, sessionId: string) {
  return new SignJWT({
    sid: sessionId,
    role: user.role,
    householdId: user.householdId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}
async function verifyAccess(value: string) {
  try {
    return (
      await jwtVerify(value, secret(), {
        algorithms: ["HS256"],
        issuer,
        audience,
        requiredClaims: ["sub", "sid", "role", "householdId", "exp", "iat"],
      })
    ).payload;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, "Your sign-in has expired. Sign in again.");
  }
}
export async function identify(
  req: Request,
): Promise<{ user: any; identity: Identity }> {
  const header = req.get("Authorization");
  assert(
    header && header.startsWith("Bearer "),
    "Sign in to access your household.",
    401,
  );
  const claims = await verifyAccess(header.slice(7));
  assert(
    typeof claims.sid === "string" && typeof claims.sub === "string",
    "Invalid sign-in token.",
    401,
  );
  const session = await systemDb.authSession.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  });
  assert(
    session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now() &&
      session.userId === claims.sub &&
      session.user.active &&
      session.user.role === claims.role &&
      session.user.householdId === claims.householdId,
    "This sign-in is no longer active. Sign in again.",
    401,
  );
  const user = Object.fromEntries(
    Object.keys(userSelect).map((key) => [key, (session.user as any)[key]]),
  );
  return {
    user,
    identity: {
      userId: session.userId,
      sessionId: session.id,
      householdId: session.user.householdId,
      role: session.user.role as Identity["role"],
    },
  };
}
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await identify(req);
    res.locals.user = result.user;
    runAsHousehold(result.identity, next);
  } catch (e) {
    next(e);
  }
}
export async function createAccount(
  input: z.infer<typeof registration>,
  role: "household" | "admin" = "household",
  actorId?: string,
) {
  const passwordHash = await hashPassword(input.password);
  return systemDb.$transaction(
    async (tx) => {
      const household = await tx.household.create({
        data: { name: input.householdName },
      });
      const user = await tx.user.create({
        data: {
          householdId: household.id,
          name: input.name,
          email: input.email,
          passwordHash,
          role,
        },
        select: userSelect,
      });
      if (actorId)
        await tx.adminAudit.create({
          data: { actorId, targetId: user.id, action: "Created account" },
        });
      return user;
    },
    { isolationLevel: "Serializable" },
  );
}
async function startSession(user: any, res: Response) {
  // Check signing configuration before persisting a session.
  secret();
  const refresh = randomBytes(32).toString("base64url");
  const session = await systemDb.authSession.create({
    data: {
      userId: user.id,
      refreshHash: digest(refresh),
      expiresAt: new Date(Date.now() + lifetime),
    },
  });
  const accessToken = await signed(user, session.id);
  res.cookie(cookieName, refresh, { ...cookieOptions(), maxAge: lifetime });
  return { user, accessToken, expiresIn: 900 };
}
export function authRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  e(
    "post",
    "/auth/register",
    "Register a new user and private household",
    registration,
    async (req, b) => {
      checkOrigin(req);
      limit(req, "register");
      assert(
        !b.email.endsWith("@homewise.demo"),
        "This email domain is reserved for demo accounts.",
      );
      secret();
      const user = await createAccount(b);
      return startSession(user, req.res!);
    },
  );
  e(
    "post",
    "/auth/login",
    "Sign in with a password and issue a JWT",
    loginSchema,
    async (req, b) => {
      checkOrigin(req);
      limit(req, "login");
      const user = await systemDb.user.findUnique({
        where: { email: b.email },
      });
      const dummy =
        "scrypt$32768$8$1$" + "0".repeat(32) + "$" + "0".repeat(128);
      const valid = await verifyPassword(
        b.password,
        user?.passwordHash ?? dummy,
      );
      assert(valid && user?.active, "Email or password is incorrect.", 401);
      const safe = Object.fromEntries(
        Object.keys(userSelect).map((key) => [key, (user as any)[key]]),
      );
      return startSession(safe, req.res!);
    },
  );
  e(
    "post",
    "/auth/refresh",
    "Rotate the HttpOnly refresh cookie and renew the JWT",
    z.object({}).strict(),
    async (req) => {
      checkOrigin(req);
      limit(req, "refresh");
      const token = refreshCookie(req);
      assert(token, "Sign in to continue.", 401);
      const nextToken = randomBytes(32).toString("base64url");
      const result = await systemDb.$transaction(
        async (tx) => {
          const session = await tx.authSession.findUnique({
            where: { refreshHash: digest(token) },
            include: { user: { select: userSelect } },
          });
          assert(
            session &&
              !session.revokedAt &&
              session.expiresAt.getTime() > Date.now() &&
              session.user.active,
            "This sign-in has expired. Sign in again.",
            401,
          );
          await tx.authSession.update({
            where: { id: session.id, refreshHash: digest(token) },
            data: { refreshHash: digest(nextToken) },
          });
          return {
            user: session.user,
            accessToken: await signed(session.user, session.id),
            expiresIn: 900,
            expiresAt: session.expiresAt,
          };
        },
        { isolationLevel: "Serializable" },
      );
      req.res!.cookie(cookieName, nextToken, {
        ...cookieOptions(),
        maxAge: result.expiresAt.getTime() - Date.now(),
      });
      const { expiresAt: _, ...response } = result;
      return response;
    },
  );
  e(
    "get",
    "/auth/me",
    "Read the current signed-in user",
    undefined,
    async (req) => (await identify(req)).user,
  );
  e(
    "post",
    "/auth/logout",
    "Revoke the current session and clear its refresh cookie",
    z.object({}).strict(),
    async (req) => {
      checkOrigin(req);
      const token = refreshCookie(req);
      const ids: string[] = [];
      if (token) {
        const s = await systemDb.authSession.findUnique({
          where: { refreshHash: digest(token) },
        });
        if (s) ids.push(s.id);
      }
      const bearer = req.get("Authorization");
      if (bearer?.startsWith("Bearer ")) {
        try {
          const claims = await verifyAccess(bearer.slice(7));
          if (typeof claims.sid === "string") ids.push(claims.sid);
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 401)) throw e;
        }
      }
      if (ids.length)
        await systemDb.authSession.updateMany({
          where: { id: { in: ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      req.res!.clearCookie(cookieName, cookieOptions());
      return { ok: true };
    },
  );
}
