import type { Context, MiddlewareHandler } from "hono";
import { sValidator } from "@hono/standard-validator";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "@charoo/contracts";
import type { Env } from "../env";
import { first, iso, type Account, type Actor } from "../shared/data";
import { hash } from "../shared/crypto";
import { HttpError, requireThat } from "../shared/errors";

export type HttpEnv = {
  Bindings: Env;
  Variables: {
    actor: Actor | null;
    user: Account;
    session: any;
    input: any;
    requestId: string;
    clientKey: string;
  };
};
export type HttpContext = Context<HttpEnv>;
export const body = (schema: z.ZodType): MiddlewareHandler<HttpEnv> =>
  sValidator("json", schema, (r, c) => {
    if (!r.success) throw new HttpError(400, "Invalid input");
    c.set("input", r.data);
  });
export const actor = (c: HttpContext): Actor => {
  const a = c.get("actor");
  requireThat(a, 401, "Sign in to continue");
  return a;
};
export const uuid = (value: string | undefined) =>
  z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase())
    .parse(value);
// Same-machine dev twin: Vite prints both http://localhost:5173 and
// http://127.0.0.1:5173, but browsers treat them as different origins.
// Outside production, accept the twin so either URL works.
export function trustedOrigin(
  env: Pick<Env, "WEB_ORIGIN" | "ADMIN_ORIGIN" | "NODE_ENV">,
  origin: string | undefined | null,
): boolean {
  if (!origin) return false;
  const configuredOrigins = [env.WEB_ORIGIN, env.ADMIN_ORIGIN].filter(
    (value): value is string => !!value,
  );
  if (configuredOrigins.includes(origin)) return true;
  if (env.NODE_ENV === "production") return false;
  try {
    const a = new URL(origin),
      loopbacks = new Set(["localhost", "127.0.0.1"]);
    return configuredOrigins.some((configured) => {
      const b = new URL(configured);
      return (
        a.protocol === b.protocol &&
        a.port === b.port &&
        a.hostname !== b.hostname &&
        loopbacks.has(a.hostname) &&
        loopbacks.has(b.hostname)
      );
    });
  } catch {
    return false;
  }
}
export async function session(c: HttpContext) {
  const t = getCookie(c, "charoo_session");
  return t
    ? first(
        c.env,
        "SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
        [await hash(t), iso()],
      )
    : null;
}
export function sessionCookie(c: HttpContext, value: string, maxAge = 604800) {
  setCookie(c, "charoo_session", value, {
    httpOnly: true,
    secure: c.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
}
export function oauthCookie(c: HttpContext, value: string, maxAge = 600) {
  setCookie(c, "charoo_oauth", value, {
    httpOnly: true,
    secure: c.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/auth/google",
    maxAge,
  });
}
export async function rate(
  c: HttpContext,
  key: string,
  max: number,
  seconds: number,
  message: string,
) {
  requireThat(
    await c.env.RATE_LIMITER.getByName(c.get("clientKey")).limit(
      key,
      max,
      seconds,
    ),
    429,
    message,
  );
}
export async function userRate(
  c: HttpContext,
  key: string,
  max: number,
  seconds: number,
  message: string,
) {
  requireThat(
    await c.env.USER_HUB.getByName(actor(c).userId).limit(key, max, seconds),
    429,
    message,
  );
}
export function socketRequest(c: HttpContext) {
  requireThat(
    trustedOrigin(c.env, c.req.header("Origin")),
    403,
    "Untrusted origin",
  );
  requireThat(
    c.req.header("Upgrade")?.toLowerCase() === "websocket",
    426,
    "Expected WebSocket",
  );
  const a = actor(c),
    headers = new Headers(c.req.raw.headers);
  headers.set("X-Charoo-User", a.userId);
  headers.set("X-Charoo-Session", a.sessionHash);
  return new Request(c.req.raw, { headers });
}
