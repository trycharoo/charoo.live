import { describe, expect, it } from "vitest";
import { fixture } from "./runtime";
import { app } from "../celld/http/app";
import { iso, roomStub } from "../celld/shared/data";
const origin = "http://localhost:5173";
async function request(
  f: Awaited<ReturnType<typeof fixture>>,
  path: string,
  method = "GET",
  body?: unknown,
  credentials?: Awaited<ReturnType<typeof f.guest>>,
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
describe("HTTP API", () => {
  it("preserves case-insensitive Unicode discovery and canonical UUID deduplication", async () => {
    const f = await fixture(),
      u = await f.guest(true);
    const created: any = await (
      await request(
        f,
        "/rooms",
        "POST",
        {
          type: "AVAILABLE_TONIGHT",
          title: "CAFÉ conversation",
          description: "Été in Manila",
          tags: ["MÜSIC"],
        },
        u,
      )
    ).json();
    for (const q of ["café", "été", "müsic"]) {
      const found: any = await (
        await request(
          f,
          `/rooms?q=${encodeURIComponent(q)}`,
          "GET",
          undefined,
          u,
        )
      ).json();
      expect(found.rooms.map((r: any) => r.id)).toContain(created.id);
    }
    const clientMessageId = crypto.randomUUID();
    expect(
      (
        await request(
          f,
          `/rooms/${created.id.toUpperCase()}/messages`,
          "POST",
          {
            clientMessageId: clientMessageId.toUpperCase(),
            text: "One canonical submission",
          },
          u,
        )
      ).status,
    ).toBe(201);
    const duplicate: any = await (
      await request(
        f,
        `/rooms/${created.id}/messages`,
        "POST",
        { clientMessageId, text: "One canonical submission" },
        u,
      )
    ).json();
    expect(duplicate.duplicate).toBe(true);
  });
  it("serves health, sanitizes errors and requires consent", async () => {
    const f = await fixture();
    expect((await request(f, "/health")).status).toBe(200);
    expect((await request(f, "/auth/guest", "POST", {})).status).toBe(400);
    const r = await request(f, "/auth/guest", "POST", {
      communityConsent: true,
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("x-request-id")).toBeTruthy();
    expect((await request(f, "/rooms")).status).toBe(401);
  });
  it("rejects CSRF, foreign origins, oversized input and forged actor headers", async () => {
    const f = await fixture(),
      u = await f.guest();
    expect(
      (
        await request(f, "/presence", "POST", { status: "Online" }, u, {
          "X-CSRF-Token": "bad",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(f, "/me", "GET", undefined, u, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(f, "/presence", "POST", { status: "x".repeat(33000) }, u))
        .status,
    ).toBe(413);
    expect(
      (
        await request(f, "/me", "GET", undefined, undefined, {
          "X-Charoo-User": u.actor.userId,
          "X-Charoo-Session": u.actor.sessionHash,
        })
      ).status,
    ).toBe(401);
  });
  it("saves a guest's chosen nickname and optional private profile across requests", async () => {
    const f = await fixture();
    for (const details of [
      { displayName: "  Coffee friend  ", age: 29, gender: "Female" },
      { displayName: "Anonymous friend", age: null, gender: "" },
    ]) {
      const profile = {
        ...details,
        region: "",
        bio: "",
        interests: [],
        aslVisibility: "private",
      };
      const created = await request(f, "/auth/guest", "POST", {
        communityConsent: true,
        profile,
      });
      expect(created.status).toBe(201);
      const expected = { ...profile, displayName: details.displayName.trim() };
      expect(await created.json()).toMatchObject({
        user: { displayName: expected.displayName, profile: expected },
      });
      const cookie = created.headers.get("set-cookie")!.split(";")[0];
      const reloaded = await request(f, "/me", "GET", undefined, undefined, {
        Cookie: cookie,
      });
      expect(reloaded.status).toBe(200);
      expect(await reloaded.json()).toMatchObject({
        user: { displayName: expected.displayName, profile: expected },
      });
    }
    for (const details of [
      { displayName: "  ", age: null, gender: "" },
      { displayName: "Friend", age: 17, gender: "" },
      { displayName: "Friend", age: 29.5, gender: "" },
      { displayName: "Friend", age: 121, gender: "" },
    ]) {
      expect(
        (
          await request(f, "/auth/guest", "POST", {
            communityConsent: true,
            profile: {
              ...details,
              region: "",
              bio: "",
              interests: [],
              aslVisibility: "private",
            },
          })
        ).status,
      ).toBe(400);
    }
  });
  it("preserves REST room, history and duplicate message responses", async () => {
    const f = await fixture(),
      u = await f.guest();
    const r = await request(
      f,
      "/rooms",
      "POST",
      { type: "SHARED_GROUP", title: "Coffee with friends" },
      u,
    );
    expect(r.status).toBe(201);
    const room: any = await r.json();
    const message = {
      text: "Hello everyone",
      clientMessageId: crypto.randomUUID(),
    };
    const first = await request(
      f,
      `/rooms/${room.id}/messages`,
      "POST",
      message,
      u,
    );
    expect(first.status).toBe(201);
    const second = await request(
      f,
      `/rooms/${room.id}/messages`,
      "POST",
      message,
      u,
    );
    expect(((await second.json()) as any).duplicate).toBe(true);
    const history: any = await (
      await request(f, `/rooms/${room.id}/messages`, "GET", undefined, u)
    ).json();
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].text).toBe(message.text);
    expect(
      (
        await request(
          f,
          `/rooms/${room.id}/messages`,
          "GET",
          undefined,
          await f.guest(),
        )
      ).status,
    ).toBe(404);
  });
  it("requires roomId for message reports and membership for room reports", async () => {
    const f = await fixture(),
      u = await f.guest();
    expect(
      (
        await request(
          f,
          "/reports",
          "POST",
          { messageId: crypto.randomUUID(), reason: "Unsafe message" },
          u,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          f,
          "/reports",
          "POST",
          { roomId: crypto.randomUUID(), reason: "Unsafe room" },
          u,
        )
      ).status,
    ).toBe(404);
  });
  it("preserves optional provider unavailable responses", async () => {
    const f = await fixture(),
      u = await f.guest();
    expect(
      (await request(f, "/auth/google", "POST", { communityConsent: true }, u))
        .status,
    ).toBe(503);
    expect(
      (
        await request(
          f,
          "/auth/email",
          "POST",
          { communityConsent: true, email: "a@example.com" },
          u,
        )
      ).status,
    ).toBe(503);
    const room: any = await (
      await request(
        f,
        "/rooms",
        "POST",
        { type: "SHARED_GROUP", title: "Test room" },
        u,
      )
    ).json();
    expect(
      (
        await request(
          f,
          "/assistant",
          "POST",
          { roomId: room.id, style: "icebreaker" },
          u,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await request(
          f,
          "/media/init",
          "POST",
          { roomId: room.id, name: "test.png", mime: "image/png", size: 10 },
          u,
        )
      ).status,
    ).toBe(503);
  });
  it("enforces staff roles and audits evidence reads", async () => {
    const f = await fixture(),
      u = await f.guest(),
      support = await f.guest(true, "SUPPORT"),
      mod = await f.guest(true, "MODERATOR");
    expect(
      (await request(f, "/admin/dashboard", "GET", undefined, u)).status,
    ).toBe(403);
    expect(
      (await request(f, "/admin/dashboard", "GET", undefined, support)).status,
    ).toBe(200);
    expect(
      (await request(f, "/admin/audit", "GET", undefined, support)).status,
    ).toBe(403);
    const id = crypto.randomUUID();
    await f.db
      .prepare("INSERT INTO reports(id,reason,created_at) VALUES(?,?,?)")
      .bind(id, "Unsafe content", iso())
      .run();
    expect(
      (
        await request(
          f,
          `/admin/reports/${id}/evidence`,
          "GET",
          undefined,
          support,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(f, `/admin/reports/${id}/evidence`, "GET", undefined, mod))
        .status,
    ).toBe(200);
    expect(
      (await f.db.prepare("SELECT * FROM audit_logs").all()).results,
    ).toHaveLength(1);
  });
  it("lists users for staff search", async () => {
    const f = await fixture(),
      u = await f.guest(),
      mod = await f.guest(true, "MODERATOR");
    expect(
      (await request(f, "/admin/users", "GET", undefined, u)).status,
    ).toBe(403);
    const all: any = await (
      await request(f, "/admin/users", "GET", undefined, mod)
    ).json();
    expect(all.length).toBe(2);
    expect(all.map((u: any) => u.role).sort()).toEqual(["MODERATOR", "USER"]);
    const other = all.find((u: any) => u.role === "USER");
    const filtered: any = await (
      await request(
        f,
        `/admin/users?q=${encodeURIComponent(other.display_name)}`,
        "GET",
        undefined,
        mod,
      )
    ).json();
    expect(filtered.length).toBe(1);
  });
});
