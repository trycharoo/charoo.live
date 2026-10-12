import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "@charoo/contracts";
import {
  authenticate,
  coordinator,
  hub,
  publicUser,
  settings,
  roomStub,
} from "../shared/data";
import { HttpError, requireThat, unwrap } from "../shared/errors";
import {
  session,
  actor,
  body,
  rate,
  socketRequest,
  type HttpEnv,
} from "./context";
import { authRoutes } from "../features/auth/routes";
import { roomRoutes } from "../features/rooms/routes";
import { socialRoutes } from "../features/social/routes";
import { adminRoutes } from "../features/admin/routes";
import {
  mediaRoutes,
  scanRequest,
  boundedBody,
} from "../features/media/routes";
import { providerRoutes } from "../features/providers/routes";

export const app = new Hono<HttpEnv>();
app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  c.header("X-Request-Id", c.get("requestId"));
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  if (/^\/api\/media\/[^/]+\/scan\/[^/]+\/(input|output)$/.test(c.req.path))
    return next();
  const origin = c.req.header("Origin");
  requireThat(!origin || origin === c.env.WEB_ORIGIN, 403, "Untrusted origin");
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
    return c.body(null, 204);
  }
  requireThat(
    ["GET", "HEAD"].includes(c.req.method) || origin === c.env.WEB_ORIGIN,
    403,
    "Origin required",
  );
  if (
    c.req.raw.body &&
    c.req.header("Content-Type")?.includes("application/json")
  ) {
    await boundedBody(c.req.raw.clone(), 32768);
  }
  try {
    await coordinator(c.env).ready();
  } catch {
    throw new HttpError(503, "Service temporarily unavailable");
  }
  const ip = c.env.TRUSTED_CLIENT_IP_HEADER
    ? c.req.header(c.env.TRUSTED_CLIENT_IP_HEADER)
    : undefined;
  c.set("clientKey", ip?.slice(0, 128) || "anonymous");
  const s = await session(c);
  c.set("session", s);
  c.set("actor", s ? { userId: s.user_id, sessionHash: s.token_hash } : null);
  if (!ip && s) c.set("clientKey", `user:${s.user_id}`);
  if (!["/health", "/api/health"].includes(c.req.path))
    await rate(c, "http", 180, 60, "Too many requests; try again shortly");
  if (
    s &&
    !["/api/auth/google/callback", "/api/auth/verify"].includes(c.req.path)
  )
    c.set("user", await authenticate(c.env, actor(c)));
  const publicPath =
    c.req.path.startsWith("/api/auth/") ||
    ["/health", "/api/health"].includes(c.req.path);
  if (!publicPath) actor(c);
  if (
    s &&
    !["GET", "HEAD"].includes(c.req.method) &&
    !["/api/auth/guest", "/api/auth/verify"].includes(c.req.path)
  )
    requireThat(
      c.req.header("X-CSRF-Token") === s.csrf,
      403,
      "Invalid request token",
    );
  return next();
});
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/me", async (c) =>
  c.json({
    user: publicUser(
      c.get("user"),
      (await hub(c.env, actor(c).userId).presence()).status,
    ),
    csrf: c.get("session").csrf,
    settings: await settings(c.env),
  }),
);
app.post(
  "/api/presence",
  body(
    z.object({
      status: z.enum(["Offline", "Online", "Available Tonight"]),
      heartbeat: z.boolean().default(false),
      roomId: z
        .string()
        .uuid()
        .transform((value) => value.toLowerCase())
        .optional(),
    }),
  ),
  async (c) => {
    const a = actor(c),
      input = c.get("input");
    const p = unwrap(await hub(c.env, a.userId).setPresence(a, input));
    if (input.status === "Offline")
      unwrap(await c.env.MATCHER.getByName("charoo").cancel(a));
    else {
      await c.env.MATCHER.getByName("charoo").heartbeat(a.userId);
      if (input.roomId)
        unwrap(await roomStub(c.env, input.roomId).command(a, "presence", {}));
    }
    return c.json(p);
  },
);
app.get("/api/events/socket", (c) =>
  hub(c.env, actor(c).userId).fetch(socketRequest(c)),
);
app.get("/api/discovery/socket", (c) =>
  c.env.DISCOVERY.getByName("charoo").fetch(socketRequest(c)),
);
authRoutes(app);
roomRoutes(app);
socialRoutes(app);
adminRoutes(app);
mediaRoutes(app);
providerRoutes(app);
app.all("/api/media/:id/scan/:attempt/:operation", scanRequest);
app.notFound((c) =>
  c.json({ error: "Endpoint unavailable", requestId: c.get("requestId") }, 404),
);
app.onError((error, c) => {
  const status =
    error instanceof HttpError || error instanceof HTTPException
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 500;
  if (status === 500)
    console.error(
      JSON.stringify({
        event: "request.error",
        requestId: c.get("requestId"),
        code: "INTERNAL",
      }),
    );
  return c.json(
    {
      error:
        status === 500
          ? "Something went wrong. Please try again."
          : status === 400 && error instanceof z.ZodError
            ? "Invalid input"
            : error.message,
      requestId: c.get("requestId"),
    },
    status as 400,
  );
});
export type AppType = typeof app;
