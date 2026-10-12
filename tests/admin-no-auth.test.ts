import { describe, expect, it } from "vitest";
import { app } from "../celld/http/app";
import { fixture } from "./runtime";
import { authenticate, localAdminActor } from "../celld/shared/data";
import { defaultSettings } from "@charoo/contracts";

describe("local admin access", () => {
  it("requires explicit enablement and never bypasses production authentication", async () => {
    const f = await fixture();
    expect((await app.request("/api/admin/dashboard", {}, f.env)).status).toBe(
      401,
    );
    f.env.ADMIN_NO_AUTH = "true";
    expect((await app.request("/api/admin/dashboard", {}, f.env)).status).toBe(
      200,
    );
    f.env.NODE_ENV = "production";
    expect((await app.request("/api/admin/dashboard", {}, f.env)).status).toBe(
      401,
    );
    await expect(authenticate(f.env, localAdminActor())).rejects.toThrow(
      "Session expired",
    );
  });

  it("allows local settings updates and audits them without a staff session", async () => {
    const f = await fixture();
    f.env.ADMIN_NO_AUTH = "true";
    const response = await app.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...defaultSettings,
          available_room_slow_mode: 0,
        }),
      },
      f.env,
    );
    expect(response.status).toBe(200);
    const dashboard = await app.request("/api/admin/dashboard", {}, f.env);
    expect(await dashboard.json()).toMatchObject({
      settings: { available_room_slow_mode: 0 },
    });
    const audit = await app.request("/api/admin/audit", {}, f.env);
    expect(await audit.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "settings.update" }),
      ]),
    );
  });

  it("keeps normal app authentication and authenticated admin CSRF checks", async () => {
    const f = await fixture(),
      admin = await f.guest(true, "ADMIN");
    f.env.ADMIN_NO_AUTH = "true";
    expect((await app.request("/api/me", {}, f.env)).status).toBe(401);
    expect(
      (
        await app.request(
          "/api/rooms",
          {
            method: "POST",
            headers: { Origin: f.env.WEB_ORIGIN },
          },
          f.env,
        )
      ).status,
    ).toBe(401);
    const response = await app.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `charoo_session=${admin.token}`,
        },
        body: JSON.stringify(defaultSettings),
      },
      f.env,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Invalid request token",
    });
  });
});
