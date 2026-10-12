import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, jwtVerify } from "jose";
import { fixture } from "./runtime";
import { unwrap } from "../celld/shared/errors";
import { roomStub, iso } from "../celld/shared/data";
import { bytes } from "../celld/shared/crypto";
import { verifyGoogle, authorizationUrl } from "../celld/features/auth/google";
import { callToken } from "../celld/features/providers/livekit";
import { mail } from "../celld/features/providers/email";
import { suggestion } from "../celld/features/providers/assistant";
import { app } from "../celld/http/app";

afterEach(() => vi.unstubAllGlobals());
describe("Worker provider adapters", () => {
  it("maps network failures and invalid assistant output to unavailable-provider errors", async () => {
    const f = await fixture(),
      a = await f.guest();
    f.env.MAILPIT_URL = "http://mailpit";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("sensitive upstream details");
      }),
    );
    await expect(
      mail(f.env, "friend@example.com", "https://charoo.example/#verify=token"),
    ).rejects.toMatchObject({
      status: 503,
      message: "Email temporarily unavailable",
    });
    const room = unwrap(
      await f.app.command(a.actor, "room.create", {
        type: "SHARED_GROUP",
        title: "Assistant room",
      }),
    );
    const cfg = JSON.parse(
      (await f.db.prepare("SELECT value FROM settings").first()).value,
    );
    cfg.AI_assistant_enabled = true;
    await f.db
      .prepare("UPDATE settings SET value=?")
      .bind(JSON.stringify(cfg))
      .run();
    Object.assign(f.env, {
      AI_BASE_URL: "https://ai.example/v1",
      AI_API_KEY: "fixture-key",
      AI_MODEL: "fixture-model",
    });
    await expect(
      suggestion(f.env, a.actor, { roomId: room.id, style: "icebreaker" }),
    ).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid upstream JSON")),
    );
    await expect(
      suggestion(f.env, a.actor, { roomId: room.id, style: "icebreaker" }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("validates Google signatures, issuer, audience, nonce and verified mailbox claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwt = await new SignJWT({
      email: "friend@gmail.com",
      email_verified: true,
      nonce: "nonce",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("subject")
      .setIssuer("https://accounts.google.com")
      .setAudience("client")
      .setIssuedAt()
      .setExpirationTime("1m")
      .sign(privateKey);
    expect(await verifyGoogle(jwt, "client", "nonce", publicKey)).toMatchObject(
      { subject: "subject", emailAuthoritative: true },
    );
    await expect(
      verifyGoogle(jwt, "wrong", "nonce", publicKey),
    ).rejects.toThrow();
    await expect(
      verifyGoogle(jwt, "client", "wrong", publicKey),
    ).rejects.toThrow();
    const f = await fixture();
    f.env.GOOGLE_CLIENT_ID = "client";
    const url = new URL(
      authorizationUrl(f.env, {
        state: "state",
        nonce: "nonce",
        codeChallenge: "pkce",
      }),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe("nonce");
  });
  it("uses Mailpit HTTP locally and Resend HTTP with idempotency in production", async () => {
    const f = await fixture(),
      requests: any[] = [];
    f.env.MAILPIT_URL = "http://mailpit";
    f.env.EMAIL_FROM = "Charoo <hello@example.com>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        requests.push({ url, ...options });
        return new Response("{}");
      }),
    );
    await mail(
      f.env,
      "friend@example.com",
      "https://charoo.example/#verify=secret",
    );
    expect(requests[0].url).toBe("http://mailpit/api/v1/send");
    expect(JSON.parse(requests[0].body).To[0].Email).toBe("friend@example.com");
    f.env.NODE_ENV = "production";
    f.env.RESEND_API_KEY = "fixture-key";
    await mail(
      f.env,
      "friend@example.com",
      "https://charoo.example/#verify=secret",
    );
    expect(requests[1].url).toBe("https://api.resend.com/emails");
    expect(requests[1].headers["Idempotency-Key"]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps private conversation history out of AI requests", async () => {
    const f = await fixture(),
      a = await f.guest(),
      room = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Private group",
        }),
      );
    const cfg = JSON.parse(
      (await f.db.prepare("SELECT value FROM settings").first()).value,
    );
    cfg.AI_assistant_enabled = true;
    await f.db
      .prepare("UPDATE settings SET value=?")
      .bind(JSON.stringify(cfg))
      .run();
    Object.assign(f.env, {
      AI_BASE_URL: "https://ai.example/v1",
      AI_API_KEY: "fixture-key",
      AI_MODEL: "fixture-model",
    });
    let request: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        request = JSON.parse(options.body);
        return Response.json({
          choices: [{ message: { content: "Hello, friend!" } }],
        });
      }),
    );
    unwrap(
      await roomStub(f.env, room.id).command(a.actor, "message", {
        text: "Private history content",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    expect(
      await suggestion(f.env, a.actor, {
        roomId: room.id,
        style: "icebreaker",
      }),
    ).toEqual({ suggestion: "Hello, friend!" });
    expect(JSON.stringify(request)).not.toContain("Private history content");
  });
  it("requires call consent and durably retries provider termination", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      matcher = f.matcher.getByName("charoo");
    await matcher.match(a.actor);
    const matched = unwrap(await matcher.match(b.actor));
    if (!("roomId" in matched)) throw new Error("Expected match");
    const cfg = JSON.parse(
      (await f.db.prepare("SELECT value FROM settings").first()).value,
    );
    cfg.video_enabled = true;
    await f.db
      .prepare("UPDATE settings SET value=?")
      .bind(JSON.stringify(cfg))
      .run();
    Object.assign(f.env, {
      LIVEKIT_URL: "wss://livekit.example",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "fixture-livekit-secret",
    });
    const room = roomStub(f.env, matched.roomId),
      call = unwrap(
        await room.command(a.actor, "call.create", {
          targetId: b.actor.userId,
        }),
      );
    expect(
      await room.command(a.actor, "call.token", { id: call.id }),
    ).toMatchObject({ ok: false });
    expect(
      await room.command(a.actor, "call.respond", {
        id: call.id,
        accept: true,
      }),
    ).toMatchObject({ ok: false });
    unwrap(
      await room.command(b.actor, "call.respond", {
        id: call.id,
        accept: true,
      }),
    );
    unwrap(await room.command(a.actor, "call.token", { id: call.id }));
    const token = await callToken(f.env, call.id, a.actor.userId);
    const verified = await jwtVerify(
      token.token,
      bytes(f.env.LIVEKIT_API_SECRET!),
      { issuer: "key" },
    );
    expect(verified.payload.video).toMatchObject({
      roomJoin: true,
      room: `call-${call.id}`,
    });
    expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBe(
      300,
    );
    unwrap(await room.command(a.actor, "call.end", { id: call.id }));
    const state = f.rooms.states.get(`charoo:${matched.roomId}`)!;
    const outbox = state.database
      .prepare("SELECT id FROM charoo_outbox WHERE kind='call.end'")
      .get()!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    await expect(room.deliver(outbox.id as string)).rejects.toThrow();
    expect(
      state.database.prepare("SELECT count(*) AS n FROM charoo_outbox").get()!
        .n,
    ).toBeGreaterThan(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    await room.deliver(outbox.id as string);
    await room.deliver(outbox.id as string);
    expect(
      state.database.prepare("SELECT count(*) AS n FROM charoo_outbox").get()!
        .n,
    ).toBe(0);
  });
  it("quarantines media, scopes scanner URLs and revokes old attempts", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Media group",
        }),
      );
    Object.assign(f.env, {
      MEDIA_SCANNER_URL: "https://scanner.example/scan",
      MEDIA_SCANNER_TOKEN: "fixture-secret",
    });
    const room = roomStub(f.env, created.id),
      file = unwrap(
        await room.command(a.actor, "attachment.init", {
          name: "image.png",
          mime: "image/png",
          size: 10,
        }),
      );
    expect(
      await room.command(b.actor, "attachment.upload.begin", { id: file.id }),
    ).toMatchObject({ ok: false });
    expect(
      await room.command(a.actor, "attachment.download", { id: file.id }),
    ).toMatchObject({ ok: false });
    const upload = unwrap(
      await room.command(a.actor, "attachment.upload.begin", { id: file.id }),
    );
    await f.env.MEDIA.put(upload.object_key, new Uint8Array(10), {
      httpMetadata: { contentType: "image/png" },
    });
    unwrap(
      await room.command(a.actor, "attachment.upload.finish", {
        id: file.id,
        attempt: upload.attempt,
      }),
    );
    const scan = unwrap(
      await room.command(a.actor, "attachment.scan.begin", { id: file.id }),
    );
    expect((await room.scanAccess(file.id, "other-attempt", "read")).ok).toBe(
      false,
    );
    unwrap(
      await room.command(a.actor, "attachment.scan.abort", {
        id: file.id,
        attempt: scan.scanAttempt,
      }),
    );
    expect((await room.scanAccess(file.id, scan.scanAttempt, "read")).ok).toBe(
      false,
    );
    const second = unwrap(
      await room.command(a.actor, "attachment.scan.begin", { id: file.id }),
    );
    await f.env.MEDIA.put(second.approved_key, new Uint8Array(8), {
      httpMetadata: { contentType: "image/png" },
    });
    unwrap(
      await room.command(a.actor, "attachment.scan.finish", {
        id: file.id,
        attempt: second.scanAttempt,
        approved: true,
        size: 8,
      }),
    );
    expect(
      unwrap(
        await room.command(a.actor, "attachment.download", { id: file.id }),
      ).object_key,
    ).toBe(second.approved_key);
  });
  it("checks scanner capability operation and rejects spoofed approval without sanitized output", async () => {
    const f = await fixture(),
      a = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Media group",
        }),
      );
    Object.assign(f.env, {
      MEDIA_SCANNER_URL: "https://scanner.example/scan",
      MEDIA_SCANNER_TOKEN: "fixture-secret",
    });
    const room = roomStub(f.env, created.id),
      file = unwrap(
        await room.command(a.actor, "attachment.init", {
          name: "image.png",
          mime: "image/png",
          size: 10,
        }),
      ),
      upload = unwrap(
        await room.command(a.actor, "attachment.upload.begin", { id: file.id }),
      );
    await f.env.MEDIA.put(upload.object_key, new Uint8Array(10));
    unwrap(
      await room.command(a.actor, "attachment.upload.finish", {
        id: file.id,
        attempt: upload.attempt,
      }),
    );
    const nativeFetch = globalThis.fetch;
    let readUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const request = JSON.parse(options.body);
        readUrl = request.url;
        expect(request.stripMetadata).toBe(true);
        const read = await app.request(request.url, undefined, f.env);
        expect(read.status).toBe(200);
        const denied = await app.request(
          request.url.replace("/input?", "/output?"),
          {
            method: "PUT",
            body: new Uint8Array(1),
            headers: { "Content-Type": "image/png" },
          },
          f.env,
        );
        expect(denied.status).toBe(403);
        return Response.json({
          clean: true,
          magicBytesValid: true,
          metadataStripped: true,
          contentSafe: true,
        });
      }),
    );
    const response = await app.request(
      `/api/media/${file.id}/complete`,
      {
        method: "POST",
        headers: {
          Origin: f.env.WEB_ORIGIN,
          Cookie: `charoo_session=${a.token}`,
          "X-CSRF-Token": a.csrf,
        },
      },
      f.env,
    );
    expect(response.status).toBe(400);
    expect((await app.request(readUrl, undefined, f.env)).status).toBe(403);
    expect(
      await room.command(a.actor, "attachment.download", { id: file.id }),
    ).toMatchObject({ ok: false });
  });
});
