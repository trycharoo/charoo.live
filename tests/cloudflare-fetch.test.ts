import { afterEach, describe, expect, it, vi } from "vitest";
import { exchange } from "../celld/features/auth/google";
import { mail } from "../celld/features/providers/email";
import { endCall } from "../celld/features/providers/livekit";
import { suggestion } from "../celld/features/providers/assistant";
import { app } from "../celld/http/app";
import { roomStub } from "../celld/shared/data";
import { unwrap } from "../celld/shared/errors";
import { fixture } from "./runtime";

// Model the Workers restriction rather than Node's broader fetch redirect support.
function workerFetch(response: () => Response) {
  const request = vi.fn(async (_url: unknown, input?: RequestInit) => {
    if (input?.redirect === "error")
      throw new TypeError("Unsupported redirect mode");
    return response();
  });
  vi.stubGlobal("fetch", request);
  return request;
}
afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare-compatible provider dispatch", () => {
  it.each(["Mailpit", "Resend", "Google", "LiveKit", "assistant", "scanner"])(
    "%s refuses redirects without following credential-bearing requests",
    async (provider) => {
      const f = await fixture();
      Object.assign(f.env, {
        EMAIL_FROM: "Charoo <hello@fixture.example>",
        GOOGLE_CLIENT_ID: "fixture-client",
        GOOGLE_CLIENT_SECRET: "fixture-secret",
        LIVEKIT_URL: "https://livekit.fixture.example",
        LIVEKIT_API_KEY: "fixture-key",
        LIVEKIT_API_SECRET: "fixture-secret",
      });
      let invoke: () => Promise<unknown>;
      if (provider === "Mailpit" || provider === "Resend") {
        if (provider === "Mailpit")
          f.env.MAILPIT_URL = "http://mailpit.fixture.example";
        else
          Object.assign(f.env, {
            NODE_ENV: "production",
            RESEND_API_KEY: "fixture-key",
          });
        invoke = () =>
          mail(
            f.env,
            "friend@fixture.example",
            "https://charoo.example/#verify=fixture",
          );
      } else if (provider === "Google")
        invoke = () =>
          exchange(f.env, "fixture-code", "fixture-verifier", "fixture-nonce");
      else if (provider === "LiveKit")
        invoke = () => endCall(f.env, crypto.randomUUID());
      else {
        const owner = await f.guest();
        const created = unwrap(
          await f.app.command(owner.actor, "room.create", {
            type: "SHARED_GROUP",
            title: "Provider check",
          }),
        );
        if (provider === "assistant") {
          Object.assign(f.env, {
            AI_BASE_URL: "https://ai.fixture.example/v1",
            AI_API_KEY: "fixture-key",
            AI_MODEL: "fixture-model",
          });
          const settings = JSON.parse(
            (await f.db.prepare("SELECT value FROM settings").first()).value,
          );
          settings.AI_assistant_enabled = true;
          await f.db
            .prepare("UPDATE settings SET value=?")
            .bind(JSON.stringify(settings))
            .run();
          invoke = () =>
            suggestion(f.env, owner.actor, {
              roomId: created.id,
              style: "friendly",
            });
        } else {
          Object.assign(f.env, {
            MEDIA_SCANNER_URL: "https://scanner.fixture.example/scan",
            MEDIA_SCANNER_TOKEN: "fixture-key",
          });
          const room = roomStub(f.env, created.id);
          const file = unwrap(
            await room.command(owner.actor, "attachment.init", {
              name: "picture.png",
              mime: "image/png",
              size: 8,
            }),
          );
          const upload = unwrap(
            await room.command(owner.actor, "attachment.upload.begin", {
              id: file.id,
            }),
          );
          await f.env.MEDIA.put(upload.object_key, new Uint8Array(8), {
            httpMetadata: { contentType: "image/png" },
          });
          unwrap(
            await room.command(owner.actor, "attachment.upload.finish", {
              id: file.id,
              attempt: upload.attempt,
            }),
          );
          invoke = async () => {
            const response = await app.request(
              `/api/media/${file.id}/complete`,
              {
                method: "POST",
                headers: {
                  Origin: f.env.WEB_ORIGIN,
                  Cookie: `charoo_session=${owner.token}`,
                  "X-CSRF-Token": owner.csrf,
                },
              },
              f.env,
            );
            expect(response.status).toBe(503);
            expect(
              (
                await room.command(owner.actor, "attachment.download", {
                  id: file.id,
                })
              ).ok,
            ).toBe(false);
          };
        }
      }
      const request = workerFetch(
        () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://untrusted.fixture.example/redirect" },
          }),
      );
      if (provider === "scanner") await invoke();
      else await expect(invoke()).rejects.toMatchObject({ status: 503 });
      expect(request).toHaveBeenCalledTimes(1);
      // Keep this assertion outside adapters' error handling, so a swallowed
      // unsupported-mode error cannot make the redirect-denial check pass.
      expect(request.mock.calls[0][1]?.redirect).toBe("manual");
    },
  );

  it("sends local and production email successfully with Workers-compatible fetch", async () => {
    const f = await fixture();
    f.env.EMAIL_FROM = "Charoo <hello@fixture.example>";
    f.env.MAILPIT_URL = "http://mailpit.fixture.example";
    const request = workerFetch(() => new Response("{}"));
    await expect(
      mail(
        f.env,
        "friend@fixture.example",
        "https://charoo.example/#verify=fixture",
      ),
    ).resolves.toBeUndefined();
    Object.assign(f.env, {
      NODE_ENV: "production",
      RESEND_API_KEY: "fixture-key",
    });
    await expect(
      mail(
        f.env,
        "friend@fixture.example",
        "https://charoo.example/#verify=fixture",
      ),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(([, input]) => input?.redirect === "manual"),
    ).toBe(true);
  });
});
