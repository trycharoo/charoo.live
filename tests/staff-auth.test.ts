import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./runtime";
import { app } from "../celld/http/app";
import { hash } from "../celld/shared/crypto";
import { unwrap } from "../celld/shared/errors";
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

async function emailCredential(f: Fixture, userId: string) {
  const account = await f.db
    .prepare("SELECT email FROM users WHERE id=?")
    .bind(userId)
    .first();
  return unwrap(
    await f.app.command(null, "email", {
      email: account.email,
      communityConsent: true,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("staff authentication and auditing", () => {
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

  it.each(["ADMIN", "MODERATOR", "SUPPORT"])(
    "audits %s email sign-in and sign-out without credentials in the log",
    async (role) => {
      const f = await fixture(),
        staff = await f.guest(true, role);
      const credential = await emailCredential(f, staff.actor.userId);
      const signedIn = unwrap(
        await f.app.command(null, "verify", { token: credential.token }),
      );
      let logs = (
        await f.db.prepare("SELECT * FROM audit_logs ORDER BY rowid").all()
      ).results;
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actor_id: staff.actor.userId,
        target_id: staff.actor.userId,
        action: "staff.sign_in",
      });
      expect(JSON.parse(logs[0].details)).toEqual({ role, method: "email" });
      expect(
        await f.app.command(null, "verify", { token: credential.token }),
      ).toMatchObject({ ok: false });
      const actor = {
        userId: signedIn.user.id,
        sessionHash: await hash(signedIn.token),
      };
      unwrap(await f.app.command(actor, "logout", {}));
      expect(
        await f.db
          .prepare("SELECT * FROM sessions WHERE token_hash=?")
          .bind(actor.sessionHash)
          .first(),
      ).toBeNull();
      logs = (
        await f.db.prepare("SELECT * FROM audit_logs ORDER BY rowid").all()
      ).results;
      expect(logs).toHaveLength(2);
      expect(logs[1]).toMatchObject({
        actor_id: staff.actor.userId,
        action: "staff.sign_out",
      });
      expect(JSON.parse(logs[1].details)).toEqual({ role });
      for (const secret of [
        credential.token,
        signedIn.token,
        signedIn.csrf,
        actor.sessionHash,
      ]) {
        expect(JSON.stringify(logs)).not.toContain(secret);
      }
    },
  );

  it("audits Google staff sign-ins and skips ordinary user sessions", async () => {
    const f = await fixture(),
      staff = await f.guest(true, "ADMIN");
    const account = await f.db
      .prepare("SELECT email FROM users WHERE id=?")
      .bind(staff.actor.userId)
      .first();
    unwrap(
      await f.app.command(null, "oauth.finish", {
        identity: {
          subject: "staff-google",
          email: account.email,
          name: "Staff",
          emailAuthoritative: true,
        },
        sessionHash: null,
      }),
    );
    const logs = (await f.db.prepare("SELECT * FROM audit_logs").all()).results;
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].details)).toEqual({
      role: "ADMIN",
      method: "google",
    });
    const regular = await f.guest(true),
      credential = await emailCredential(f, regular.actor.userId);
    const signedIn = unwrap(
      await f.app.command(null, "verify", { token: credential.token }),
    );
    unwrap(
      await f.app.command(
        { userId: signedIn.user.id, sessionHash: await hash(signedIn.token) },
        "logout",
        {},
      ),
    );
    expect(
      (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
    ).toHaveLength(1);
  });

  it("commits email credentials, session changes and their audit entries together", async () => {
    const f = await fixture(),
      staff = await f.guest(true, "ADMIN");
    const credential = await emailCredential(f, staff.actor.userId);
    f.db.fail = (sql) => sql.includes("INSERT INTO audit_logs");
    await expect(
      f.app.command(null, "verify", { token: credential.token }),
    ).rejects.toThrow("Injected storage interruption");
    expect(
      (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
    ).toHaveLength(0);
    expect(
      (await f.db.prepare("SELECT * FROM sessions").all()).results,
    ).toHaveLength(1);
    const signedIn = unwrap(
      await f.app.command(null, "verify", { token: credential.token }),
    );
    const actor = {
      userId: signedIn.user.id,
      sessionHash: await hash(signedIn.token),
    };
    f.db.fail = (sql) => sql.includes("INSERT INTO audit_logs");
    await expect(f.app.command(actor, "logout", {})).rejects.toThrow(
      "Injected storage interruption",
    );
    expect(
      await f.db
        .prepare("SELECT * FROM sessions WHERE token_hash=?")
        .bind(actor.sessionHash)
        .first(),
    ).not.toBeNull();
    expect(
      (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
    ).toHaveLength(1);
    unwrap(await f.app.command(actor, "logout", {}));
    expect(
      (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
    ).toHaveLength(2);
  });

  it("records the changed setting values before and after a save", async () => {
    const f = await fixture(),
      admin = await f.guest(true, "ADMIN");
    const after = defaultSettings.available_room_slow_mode === 0 ? 1 : 0;
    unwrap(
      await f.app.command(admin.actor, "settings", {
        ...defaultSettings,
        available_room_slow_mode: after,
      }),
    );
    const entry = await f.db
      .prepare("SELECT * FROM audit_logs WHERE action='settings.update'")
      .first();
    expect(JSON.parse(entry.details)).toEqual({
      changes: {
        available_room_slow_mode: {
          before: defaultSettings.available_room_slow_mode,
          after,
        },
      },
    });
  });
});
