import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z, guestSchema, emailSchema, profileSchema } from "@charoo/contracts";
import { coordinator } from "../../shared/data";
import { token, hash, base64url, bytes } from "../../shared/crypto";
import { requireThat, unwrap, HttpError } from "../../shared/errors";
import {
  actor,
  body,
  session,
  sessionCookie,
  oauthCookie,
  rate,
  trustedOrigin,
  type HttpEnv,
} from "../../http/context";
import { authorizationUrl, exchange } from "./google";
import { mail } from "../providers/email";

export function authRoutes(app: Hono<HttpEnv>) {
  app.get("/api/auth/providers", (c) =>
    c.json({
      google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    }),
  );
  app.post("/api/auth/guest", body(guestSchema), async (c) => {
    await rate(c, "guest", 10, 3600, "Guest session limit reached");
    const value = unwrap(
      await coordinator(c.env).command(c.get("actor"), "guest", c.get("input")),
    );
    if (value.token) sessionCookie(c, value.token);
    return c.json(
      { user: value.user, csrf: value.csrf },
      value.token ? 201 : 200,
    );
  });
  app.post("/api/auth/email", body(emailSchema), async (c) => {
    requireThat(
      (c.env.RESEND_API_KEY && c.env.EMAIL_FROM) ||
        (c.env.NODE_ENV !== "production" && c.env.MAILPIT_URL),
      503,
      "Email service is not configured",
    );
    await rate(
      c,
      "email",
      5,
      900,
      "Please wait before requesting another link",
    );
    const value = unwrap(
      await coordinator(c.env).command(c.get("actor"), "email", c.get("input")),
    );
    const fragment = new URLSearchParams({ verify: value.token });
    if (value.roomToken) fragment.set("room", value.roomToken);
    const origin = c.req.header("Origin");
    const returnOrigin =
      c.env.ADMIN_ORIGIN &&
      trustedOrigin(
        { WEB_ORIGIN: c.env.ADMIN_ORIGIN, NODE_ENV: c.env.NODE_ENV },
        origin,
      )
        ? origin!
        : c.env.WEB_ORIGIN;
    await mail(c.env, value.email, `${returnOrigin}/#${fragment}`);
    return c.json({
      message: "Check your email for a sign-in link. It expires in 15 minutes.",
    });
  });
  app.post(
    "/api/auth/verify",
    body(z.object({ token: z.string().min(30).max(100) })),
    async (c) => {
      await rate(c, "verify", 20, 600, "Verification limit reached");
      const value = unwrap(
        await coordinator(c.env).command(
          c.get("actor"),
          "verify",
          c.get("input"),
        ),
      );
      sessionCookie(c, value.token);
      return c.json({ user: value.user, csrf: value.csrf });
    },
  );
  app.post("/api/auth/logout", async (c) => {
    unwrap(await coordinator(c.env).command(actor(c), "logout", {}));
    sessionCookie(c, "", 0);
    return c.body(null, 204);
  });
  app.patch("/api/me/profile", body(profileSchema), async (c) =>
    c.json(
      unwrap(
        await coordinator(c.env).command(actor(c), "profile", c.get("input")),
      ),
    ),
  );
  app.post(
    "/api/auth/google",
    body(
      z.intersection(
        guestSchema,
        z.object({
          roomToken: z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/)
            .optional(),
          createRoom: z.boolean().default(false),
        }),
      ),
    ),
    async (c) => {
      requireThat(
        c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET,
        503,
        "Google sign-in is currently unavailable",
      );
      await rate(
        c,
        "google",
        10,
        600,
        "Please wait before trying Google sign-in again",
      );
      const state = token(),
        browser = token(),
        nonce = token(),
        codeVerifier = token(),
        old = getCookie(c, "charoo_oauth");
      unwrap(
        await coordinator(c.env).command(c.get("actor"), "oauth.start", {
          ...c.get("input"),
          stateHash: await hash(state),
          browserHash: await hash(browser),
          oldBrowserHash: old ? await hash(old) : null,
          nonce,
          codeVerifier,
        }),
      );
      oauthCookie(c, browser);
      return c.json({
        url: authorizationUrl(c.env, {
          state,
          nonce,
          codeChallenge: base64url(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", bytes(codeVerifier)),
            ),
          ),
        }),
      });
    },
  );
  app.get("/api/auth/google/callback", async (c) => {
    let flow: any = null,
      reason: string | undefined;
    try {
      requireThat(
        c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET,
        503,
        "Google sign-in unavailable",
      );
      const input = z
        .object({
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code: z.string().min(1).max(4096).optional(),
          error: z.string().max(100).optional(),
        })
        .parse(c.req.query());
      const browser = getCookie(c, "charoo_oauth");
      requireThat(browser, 400, "Google sign-in expired");
      flow = unwrap(
        await coordinator(c.env).command(null, "oauth.consume", {
          stateHash: await hash(input.state),
          browserHash: await hash(browser),
        }),
      );
      oauthCookie(c, "", 0);
      requireThat(
        ((await session(c))?.token_hash || null) === flow.session_hash,
        409,
        "session_changed",
      );
      if (input.error)
        throw new HttpError(
          409,
          input.error === "access_denied" ? "cancelled" : "failed",
        );
      requireThat(input.code, 400, "Missing authorization code");
      const identity = await exchange(
        c.env,
        input.code,
        flow.code_verifier,
        flow.nonce,
      );
      const s = await session(c);
      requireThat(
        (s?.token_hash || null) === flow.session_hash,
        409,
        "session_changed",
      );
      const value = unwrap(
        await coordinator(c.env).command(
          s ? { userId: s.user_id, sessionHash: s.token_hash } : null,
          "oauth.finish",
          { identity, sessionHash: flow.session_hash },
        ),
      );
      sessionCookie(c, value.token);
    } catch (e) {
      reason =
        e instanceof HttpError &&
        [
          "session_changed",
          "account_conflict",
          "email_required",
          "cancelled",
        ].includes(e.message)
          ? e.message
          : (e instanceof HttpError && e.status === 400) ||
              e instanceof z.ZodError
            ? "expired"
            : "failed";
    }
    const fragment = new URLSearchParams();
    if (flow?.room_token) fragment.set("room", flow.room_token);
    if (flow?.create_room && !reason) fragment.set("create", "1");
    fragment.set(reason ? "authError" : "auth", reason || "google");
    return c.redirect(`${c.env.WEB_ORIGIN}/#${fragment}`, 303);
  });
}
