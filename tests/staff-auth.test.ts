import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./runtime";
import { app } from "../celld/http/app";
import { defaultSettings } from "@charoo/contracts";

const adminOrigin = "http://127.0.0.1:5179";
type Fixture = Awaited<ReturnType<typeof fixture>>;

function request(
  f: Fixture,
  path: string,
  method = "GET",
  body?: unknown,
  credentials?: { token: string; csrf: string },
  origin = adminOrigin,
  headers: Record<string, string> = {},
) {
  return app.request(
    `/api${path}`,
    {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(credentials
          ? {
              Cookie: `charoo_session=${credentials.token}`,
              "X-CSRF-Token": credentials.csrf,
            }
          : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    f.env,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("staff authentication", () => {
  it("accepts configured chat and admin origins while retaining authentication, CSRF and role checks", async () => {
    const f = await fixture(),
      admin = await f.guest(true, "ADMIN");
    f.env.ADMIN_ORIGIN = adminOrigin;
    for (const origin of [
      f.env.WEB_ORIGIN,
      adminOrigin,
      "http://localhost:5179",
    ]) {
      expect(
        (await request(f, "/admin/dashboard", "GET", undefined, admin, origin))
          .status,
      ).toBe(200);
    }
    expect((await request(f, "/admin/dashboard")).status).toBe(401);
    expect(
      (
        await request(
          f,
          "/admin/dashboard",
          "GET",
          undefined,
          admin,
          "http://127.0.0.1:5180",
        )
      ).status,
    ).toBe(403);
    const missingCsrf = await request(
      f,
      "/admin/settings",
      "PATCH",
      defaultSettings,
      admin,
      adminOrigin,
      { "X-CSRF-Token": "" },
    );
    expect(missingCsrf.status).toBe(403);
    expect(await missingCsrf.json()).toMatchObject({
      error: "Invalid request token",
    });
    const support = await f.guest(true, "SUPPORT");
    expect(
      (await request(f, "/admin/settings", "PATCH", defaultSettings, support))
        .status,
    ).toBe(403);
    expect(
      (await request(f, "/admin/audit", "GET", undefined, support)).status,
    ).toBe(403);
    f.env.NODE_ENV = "production";
    expect(
      (
        await request(
          f,
          "/admin/dashboard",
          "GET",
          undefined,
          admin,
          "http://localhost:5179",
        )
      ).status,
    ).toBe(403);
  });

  it("sends email links back to the requesting configured app", async () => {
    const f = await fixture();
    f.env.ADMIN_ORIGIN = adminOrigin;
    f.env.MAILPIT_URL = "http://mailpit.test";
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", send);
    for (const origin of [
      adminOrigin,
      "http://localhost:5179",
      f.env.WEB_ORIGIN,
    ]) {
      const response = await request(
        f,
        "/auth/email",
        "POST",
        {
          email: "staff@example.com",
          communityConsent: true,
        },
        undefined,
        origin,
      );
      expect(response.status).toBe(200);
      const [, init] = send.mock.calls.at(-1)! as unknown as [
        string,
        RequestInit,
      ];
      expect(JSON.parse(String(init.body)).Text).toContain(
        `${origin}/#verify=`,
      );
    }
    const rejected = await request(
      f,
      "/auth/email",
      "POST",
      {
        email: "staff@example.com",
        communityConsent: true,
      },
      undefined,
      "https://foreign.example",
    );
    expect(rejected.status).toBe(403);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
