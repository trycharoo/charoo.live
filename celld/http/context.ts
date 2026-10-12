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
    c.req.header("Origin") === c.env.WEB_ORIGIN,
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
