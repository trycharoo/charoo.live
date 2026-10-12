import { describe, expect, it } from "vitest";
import { fixture } from "./runtime";
import { unwrap } from "../celld/shared/errors";
import { roomStub, iso } from "../celld/shared/data";
import { hash } from "../celld/shared/crypto";

describe("Durable authorities and coordination", () => {
  it("keeps invitation navigation on email credentials and allows a valid credential to upgrade an expired guest", async () => {
    const f = await fixture(),
      a = await f.guest();
    const invitation = "a".repeat(43);
    const email = unwrap(
      await f.app.command(a.actor, "email", {
        email: "invite@example.com",
        communityConsent: true,
        roomToken: invitation,
      }),
    );
    expect(email.roomToken).toBe(invitation);
    expect(
      (await f.db.prepare("SELECT room_token FROM email_tokens").first())
        .room_token,
    ).toBe(invitation);
    await f.db
      .prepare("UPDATE users SET guest_expires_at=? WHERE id=?")
      .bind(iso(Date.now() - 1), a.actor.userId)
      .run();
    expect(
      await roomStub(f.env, crypto.randomUUID()).authorize(a.actor),
    ).toMatchObject({ ok: false });
    const verified = unwrap(
      await f.app.command(a.actor, "verify", { token: email.token }),
    );
    expect(verified.user).toMatchObject({ id: a.actor.userId, verified: true });
    expect(
      await f.app.command(null, "verify", { token: email.token }),
    ).toMatchObject({ ok: false });
  });
  it("upgrades guests through one-use email links and rotates sessions", async () => {
    const f = await fixture(),
      a = await f.guest();
    const email = unwrap(
      await f.app.command(a.actor, "email", {
        communityConsent: true,
        email: "a@example.com",
      }),
    );
    const result = unwrap(
      await f.app.command(a.actor, "verify", { token: email.token }),
    );
    expect(result.user.id).toBe(a.actor.userId);
    expect(result.user.verified).toBe(true);
    expect(
      (
        await f.db
          .prepare("SELECT * FROM sessions WHERE token_hash=?")
          .bind(a.actor.sessionHash)
          .all()
      ).results,
    ).toHaveLength(0);
    expect(
      (await f.app.command(null, "verify", { token: email.token })).ok,
    ).toBe(false);
  });
  it("serializes concurrent Google account linking to one identity", async () => {
    const f = await fixture(),
      identity = {
        subject: "google-subject",
        email: "a@gmail.com",
        name: "Friend",
        emailAuthoritative: true,
      };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.app.command(null, "oauth.finish", { identity, sessionHash: null }),
      ),
    );
    expect(new Set(results.map((r) => unwrap(r).user.id)).size).toBe(1);
    expect(
      (await f.db.prepare("SELECT * FROM oauth_identities").all()).results,
    ).toHaveLength(1);
  });
  it("requires mailbox verification for external Google addresses and rejects identity conflicts", async () => {
    const f = await fixture(),
      a = await f.guest(true),
      identity = {
        subject: "external",
        email: "person@external.test",
        name: "Friend",
        emailAuthoritative: false,
      };
    const denied = await f.app.command(null, "oauth.finish", {
      identity,
      sessionHash: null,
    });
    expect(denied).toMatchObject({ ok: false, message: "email_required" });
    expect(
      await f.app.command(a.actor, "oauth.finish", {
        identity,
        sessionHash: a.actor.sessionHash,
      }),
    ).toMatchObject({ ok: false, message: "account_conflict" });
  });
  it("consumes browser-bound OAuth flows atomically and preserves invitation navigation", async () => {
    const f = await fixture(),
      input = {
        stateHash: "state",
        browserHash: "browser",
        nonce: "nonce",
        codeVerifier: "verifier",
        roomToken: "a".repeat(43),
        createRoom: true,
      };
    unwrap(await f.app.command(null, "oauth.start", input));
    expect(
      await f.app.command(null, "oauth.consume", {
        stateHash: "state",
        browserHash: "wrong",
      }),
    ).toMatchObject({ ok: false });
    const consumed = await Promise.all([
      f.app.command(null, "oauth.consume", input),
      f.app.command(null, "oauth.consume", input),
    ]);
    expect(consumed.filter((r) => r.ok)).toHaveLength(1);
    expect(unwrap(consumed.find((r) => r.ok)!)).toMatchObject({
      room_token: input.roomToken,
      create_room: 1,
    });
  });
  it("persists invitations, membership and encrypted history across restarts", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Test group",
        }),
      );
    const room = roomStub(f.env, created.id),
      token = new URL(created.shareUrl).hash.slice(6);
    const pending = unwrap(
      await room.command(b.actor, "join", { tokenHash: await hash(token) }),
    );
    expect(pending.pending).toBe(true);
    const requests = unwrap(await room.command(a.actor, "join_requests", {}));
    unwrap(
      await room.command(a.actor, "join_respond", {
        requestId: requests[0].id,
        accept: true,
      }),
    );
    unwrap(
      await room.command(a.actor, "message", {
        text: "Private hello",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    const state = f.rooms.states.get(`charoo:${created.id}`)!;
    expect(
      state.database.prepare("SELECT ciphertext FROM charoo_messages").get()!
        .ciphertext,
    ).not.toContain("Private hello");
    const restarted = f.rooms.restart(`charoo:${created.id}`);
    expect(
      unwrap(await restarted.command(b.actor, "messages")).messages[0].text,
    ).toBe("Private hello");
    expect(unwrap(await restarted.command(a.actor, "invite")).shareUrl).toBe(
      created.shareUrl,
    );
  });
  it("deduplicates concurrent message submissions before slow mode", async () => {
    const f = await fixture(),
      a = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Test group",
        }),
      ),
      room = roomStub(f.env, created.id);
    const payload = {
        text: "One message only",
        clientMessageId: crypto.randomUUID(),
      },
      results = await Promise.all(
        Array.from({ length: 8 }, () =>
          room.command(a.actor, "message", payload),
        ),
      );
    expect(new Set(results.map((r) => unwrap(r).id)).size).toBe(1);
    expect(
      unwrap(await room.command(a.actor, "messages")).messages,
    ).toHaveLength(1);
  });
  it("enforces host moderation for history, writes, rejoining and invites", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Test group",
        }),
      ),
      room = roomStub(f.env, created.id),
      tokenHash = await hash(new URL(created.shareUrl).hash.slice(6));
    const joinResult = unwrap(await room.command(b.actor, "join", { tokenHash }));
    expect(joinResult.pending).toBe(true);
    // Requester sees pending, host sees the queue.
    expect(unwrap(await room.command(b.actor, "join_status", {}))).toMatchObject({
      status: "PENDING",
    });
    const queue = unwrap(await room.command(a.actor, "join_requests", {}));
    expect(queue).toHaveLength(1);
    unwrap(
      await room.command(a.actor, "join_respond", {
        requestId: queue[0].id,
        accept: true,
      }),
    );
    expect(
      unwrap(await room.command(b.actor, "join_status", {})),
    ).toMatchObject({ status: "APPROVED" });
    expect(await room.command(b.actor, "invite")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      await room.command(b.actor, "moderate", { action: "CLOSE" }),
    ).toMatchObject({ ok: false, status: 403 });
    unwrap(
      await room.command(a.actor, "moderate", {
        action: "MUTE",
        targetId: b.actor.userId,
      }),
    );
    expect(
      await room.command(b.actor, "message", {
        text: "Muted",
        clientMessageId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: false, status: 403 });
    const muted = unwrap(await room.command(b.actor, "snapshot"));
    expect(Date.parse(muted.mutedUntil)).toBeGreaterThan(Date.now());
    expect(
      muted.participants.find((p: any) => p.id === b.actor.userId).mutedUntil,
    ).toBe(muted.mutedUntil);
    expect(
      await room.command(b.actor, "moderate", {
        action: "UNMUTE",
        targetId: b.actor.userId,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    unwrap(
      await room.command(a.actor, "moderate", {
        action: "UNMUTE",
        targetId: b.actor.userId,
      }),
    );
    expect(
      unwrap(await room.command(b.actor, "snapshot")).mutedUntil,
    ).toBeNull();
    expect(
      await room.command(b.actor, "message", {
        text: "Unmuted",
        clientMessageId: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await room.command(a.actor, "moderate", {
        action: "REMOVE",
        targetId: b.actor.userId,
      }),
    ).toMatchObject({ ok: false, status: 400 });
    unwrap(
      await room.command(a.actor, "moderate", {
        action: "REMOVE",
        targetId: b.actor.userId,
        reason: "Spamming the room",
      }),
    );
    expect(unwrap(await room.command(b.actor, "join_status", {}))).toMatchObject({
      status: "REMOVED",
    });
    expect(await room.command(b.actor, "messages")).toMatchObject({
      ok: false,
    });
    expect(await room.command(b.actor, "join", { tokenHash })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
  it("queues link joins for host approval, reject and cancel", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      c = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Approval room",
        }),
      ),
      room = roomStub(f.env, created.id),
      tokenHash = await hash(new URL(created.shareUrl).hash.slice(6));
    const first = unwrap(await room.command(b.actor, "join", { tokenHash }));
    expect(first.pending).toBe(true);
    // Duplicate knocks return the same pending request.
    const again = unwrap(await room.command(b.actor, "join", { tokenHash }));
    expect(again.requestId).toBe(first.requestId);
    const queue = unwrap(await room.command(a.actor, "join_requests", {}));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ status: "PENDING" });
    // Non-members cannot review the queue.
    expect(await room.command(b.actor, "join_requests", {})).toMatchObject({
      ok: false,
    });
    // Reject with a reason the requester can see.
    unwrap(
      await room.command(a.actor, "join_respond", {
        requestId: queue[0].id,
        accept: false,
        reason: "Room is full right now",
      }),
    );
    expect(
      unwrap(await room.command(b.actor, "join_status", {})),
    ).toMatchObject({ status: "REJECTED", reason: "Room is full right now" });
    // Rejected visitors can knock again.
    const retry = unwrap(await room.command(b.actor, "join", { tokenHash }));
    expect(retry.pending).toBe(true);
    // Requesters can cancel a pending knock.
    unwrap(await room.command(b.actor, "join_cancel", {}));
    expect(
      unwrap(await room.command(b.actor, "join_status", {})),
    ).toMatchObject({ status: "NONE" });
    expect(
      unwrap(await room.command(a.actor, "join_requests", {})),
    ).toHaveLength(0);
    // Approving lets the visitor in.
    unwrap(await room.command(c.actor, "join", { tokenHash }));
    const pending = unwrap(await room.command(a.actor, "join_requests", {}));
    unwrap(
      await room.command(a.actor, "join_respond", {
        requestId: pending[0].id,
        accept: true,
      }),
    );
    expect(
      unwrap(await room.command(c.actor, "snapshot", {} as any)).participants.map(
        (p: any) => p.id,
      ),
    ).toContain(c.actor.userId);
  });
  it("serializes available-room limits", async () => {
    const f = await fixture(),
      a = await f.guest(true),
      results = await Promise.all(
        Array.from({ length: 7 }, () =>
          f.app.command(a.actor, "room.create", {
            type: "AVAILABLE_TONIGHT",
            title: "Public group",
          }),
        ),
      );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(
      results.filter((r) => !r.ok).every((r) => !r.ok && r.status === 429),
    ).toBe(true);
  });
  it("matches each user once and serializes cancellation", async () => {
    const f = await fixture(),
      users = await Promise.all(Array.from({ length: 8 }, () => f.guest())),
      matcher = f.matcher.getByName("charoo");
    await Promise.all(users.map((u) => matcher.match(u.actor)));
    const rows = (await f.db.prepare("SELECT * FROM active_matches").all())
      .results;
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r: any) => r.room_id)).size).toBe(4);
    const waiting = await f.guest();
    await matcher.match(waiting.actor);
    await Promise.all([
      matcher.cancel(waiting.actor),
      matcher.cancel(waiting.actor),
    ]);
    expect((await matcher.status()).queue).toBe(0);
  });
  it("excludes blocks and recent pairs from matching", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      matcher = f.matcher.getByName("charoo");
    unwrap(await f.app.command(a.actor, "block", { targetId: b.actor.userId }));
    await matcher.match(a.actor);
    expect(unwrap(await matcher.match(b.actor))).toEqual({ queued: true });
    unwrap(
      await f.app.command(a.actor, "unblock", { targetId: b.actor.userId }),
    );
    const matched = unwrap(await matcher.match(b.actor));
    expect(matched).toHaveProperty("roomId");
    if ("roomId" in matched)
      unwrap(await roomStub(f.env, matched.roomId).command(a.actor, "leave"));
    await matcher.match(a.actor);
    expect(unwrap(await matcher.match(b.actor))).toEqual({ queued: true });
  });
  it("accepts duplicate contact requests into one persistent room", async () => {
    const f = await fixture(),
      a = await f.guest(true),
      b = await f.guest(true),
      matcher = f.matcher.getByName("charoo");
    await matcher.match(a.actor);
    const match = unwrap(await matcher.match(b.actor));
    if (!("roomId" in match)) throw new Error("Expected match");
    const req = unwrap(
      await f.app.command(a.actor, "social.create", {
        kind: "CONTACT",
        targetId: b.actor.userId,
        roomId: match.roomId,
      }),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.app.command(b.actor, "social.respond", { id: req.id, accept: true }),
      ),
    );
    expect(new Set(results.map((r) => unwrap(r).roomId)).size).toBe(1);
    expect(
      (await f.db.prepare("SELECT * FROM contacts").all()).results,
    ).toHaveLength(1);
    const roomId = unwrap(results[0]!).roomId;
    unwrap(await roomStub(f.env, roomId).command(a.actor, "leave"));
    expect((await roomStub(f.env, roomId).authorize(a.actor)).ok).toBe(true);
    unwrap(
      await f.app.command(a.actor, "contact.remove", {
        targetId: b.actor.userId,
      }),
    );
    expect((await roomStub(f.env, roomId).authorize(b.actor)).ok).toBe(false);
  });
  it("rejects expired access before sweeping and purges encrypted content afterwards", async () => {
    const f = await fixture(),
      a = await f.guest(),
      created = unwrap(
        await f.app.command(a.actor, "room.create", {
          type: "SHARED_GROUP",
          title: "Test group",
        }),
      ),
      room = roomStub(f.env, created.id);
    unwrap(
      await room.command(a.actor, "message", {
        text: "To be deleted",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    const state = f.rooms.states.get(`charoo:${created.id}`)!;
    const r: any = JSON.parse(
      state.database.prepare("SELECT data FROM charoo_meta").get()!
        .data as string,
    );
    r.expires_at = iso(Date.now() - 1);
    state.database
      .prepare("UPDATE charoo_meta SET data=?")
      .run(JSON.stringify(r));
    expect(await room.authorize(a.actor)).toMatchObject({
      ok: false,
      status: 410,
    });
    await room.sweep();
    const closed = JSON.parse(
      state.database.prepare("SELECT data FROM charoo_meta").get()!
        .data as string,
    );
    closed.purge_at = iso(Date.now() - 1);
    state.database
      .prepare("UPDATE charoo_meta SET data=?")
      .run(JSON.stringify(closed));
    await room.sweep();
    await room.flush();
    expect(
      state.database.prepare("SELECT count(*) AS n FROM charoo_messages").get()!
        .n,
    ).toBe(0);
    expect(
      (
        await f.db
          .prepare("SELECT * FROM membership_index WHERE room_id=?")
          .bind(created.id)
          .all()
      ).results,
    ).toHaveLength(0);
  });
  it("recovers initialization interrupted between the room and its D1 projection", async () => {
    const f = await fixture(),
      a = await f.guest();
    f.db.fail = (sql) => sql.includes("INSERT INTO room_index");
    await expect(
      f.app.command(a.actor, "room.create", {
        type: "SHARED_GROUP",
        title: "Recover me",
      }),
    ).rejects.toThrow("Injected");
    const pending = (await f.db.prepare("SELECT * FROM operations").all())
      .results[0];
    expect(pending.state).toBe("PENDING");
    const restarted = f.apps.restart("charoo");
    await restarted.deliver(pending.id);
    await restarted.deliver(pending.id);
    expect(
      (await f.db.prepare("SELECT * FROM room_index").all()).results,
    ).toHaveLength(1);
    expect(
      (await f.db.prepare("SELECT * FROM membership_index").all()).results,
    ).toHaveLength(1);
    expect(
      (await f.db.prepare("SELECT state FROM operations").first()).state,
    ).toBe("DONE");
  });
  it("keeps presence deadlines fixed across heartbeats and preserves sessions while offline", async () => {
    const f = await fixture(),
      a = await f.guest(true),
      hub = f.users.getByName(a.actor.userId);
    unwrap(
      await hub.setPresence(a.actor, {
        status: "Available Tonight",
        heartbeat: false,
      }),
    );
    const state = f.users.states.get(a.actor.userId)!;
    const deadline = state.database
      .prepare("SELECT until FROM charoo_values WHERE key='available'")
      .get()!.until;
    unwrap(
      await hub.setPresence(a.actor, {
        status: "Available Tonight",
        heartbeat: true,
      }),
    );
    expect(
      state.database
        .prepare("SELECT until FROM charoo_values WHERE key='available'")
        .get()!.until,
    ).toBe(deadline);
    unwrap(
      await hub.setPresence(a.actor, { status: "Offline", heartbeat: false }),
    );
    expect((await hub.presence()).status).toBe("Offline");
    expect(
      (await f.db.prepare("SELECT * FROM sessions").all()).results,
    ).toHaveLength(1);
  });
  it("recovers contact acceptance without another client submission", async () => {
    const f = await fixture(),
      a = await f.guest(true),
      b = await f.guest(true),
      matcher = f.matcher.getByName("charoo");
    await matcher.match(a.actor);
    const match = unwrap(await matcher.match(b.actor));
    if (!("roomId" in match)) throw new Error("Expected match");
    const req = unwrap(
      await f.app.command(a.actor, "social.create", {
        kind: "CONTACT",
        targetId: b.actor.userId,
        roomId: match.roomId,
      }),
    );
    f.db.fail = (sql) => sql.includes("INSERT INTO room_index");
    await expect(
      f.app.command(b.actor, "social.respond", { id: req.id, accept: true }),
    ).rejects.toThrow();
    const op = (
      await f.db
        .prepare("SELECT id FROM operations WHERE state='PENDING'")
        .first()
    ).id;
    await f.app.deliver(op);
    await f.app.deliver(op);
    expect(
      (
        await f.db
          .prepare("SELECT state FROM social_requests WHERE id=?")
          .bind(req.id)
          .first()
      ).state,
    ).toBe("ACCEPTED");
    expect(
      (await f.db.prepare("SELECT * FROM contacts").all()).results,
    ).toHaveLength(1);
  });
  it("deduplicates room creation with a stable browser operation ID", async () => {
    const f = await fixture(),
      a = await f.guest(),
      input = {
        type: "SHARED_GROUP",
        title: "One group only",
        clientOperationId: crypto.randomUUID(),
      };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.app.command(a.actor, "room.create", input),
      ),
    );
    expect(new Set(results.map((r) => unwrap(r).id)).size).toBe(1);
    expect(new Set(results.map((r) => unwrap(r).shareUrl)).size).toBe(1);
    expect(
      (await f.db.prepare("SELECT * FROM room_index").all()).results,
    ).toHaveLength(1);
  });
  it("reveals ASL only after balanced qualifying messages and still enforces visibility", async () => {
    const f = await fixture(),
      a = await f.guest(),
      b = await f.guest(),
      matcher = f.matcher.getByName("charoo");
    await matcher.match(a.actor);
    const match = unwrap(await matcher.match(b.actor));
    if (!("roomId" in match)) throw new Error("Expected match");
    const room = roomStub(f.env, match.roomId),
      state = f.rooms.states.get(`charoo:${match.roomId}`)!;
    const cfg = JSON.parse(
      (await f.db.prepare("SELECT value FROM settings").first()).value,
    );
    cfg.minimum_messages_per_user = 1;
    cfg.asl_reveal_threshold = 2;
    cfg.asl_minimum_duration_seconds = 30;
    await f.db
      .prepare("UPDATE settings SET value=?")
      .bind(JSON.stringify(cfg))
      .run();
    const meta = JSON.parse(
      state.database.prepare("SELECT data FROM charoo_meta").get()!
        .data as string,
    );
    meta.created_at = iso(Date.now() - 31000);
    meta.slow_mode = 0;
    state.database
      .prepare("UPDATE charoo_meta SET data=?")
      .run(JSON.stringify(meta));
    for (const u of [a, b]) {
      const profile = JSON.parse(
        (
          await f.db
            .prepare("SELECT profile FROM users WHERE id=?")
            .bind(u.actor.userId)
            .first()
        ).profile,
      );
      profile.age = 25;
      profile.aslVisibility = u === a ? "public" : "private";
      await f.db
        .prepare("UPDATE users SET profile=? WHERE id=?")
        .bind(JSON.stringify(profile), u.actor.userId)
        .run();
    }
    unwrap(
      await room.command(a.actor, "message", {
        text: "How has your day been?",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    expect(
      unwrap(await room.command(b.actor, "snapshot")).participants.every(
        (p: any) => p.asl === null,
      ),
    ).toBe(true);
    unwrap(
      await room.command(b.actor, "message", {
        text: "A very nice day, thank you!",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    const visible = unwrap(await room.command(a.actor, "snapshot"));
    expect(visible.asl_revealed).toBe(true);
    expect(
      visible.participants.find((p: any) => p.id === b.actor.userId).asl,
    ).toBe(null);
    expect(
      unwrap(await room.command(b.actor, "snapshot")).participants.find(
        (p: any) => p.id === a.actor.userId,
      ).asl.age,
    ).toBe(25);
    unwrap(
      await room.command(a.actor, "message", {
        text: " HOW has your DAY been? ",
        clientMessageId: crypto.randomUUID(),
      }),
    );
    expect(
      unwrap(await room.command(a.actor, "snapshot")).aslProgress.find(
        (p: any) => p.id === a.actor.userId,
      ).count,
    ).toBe(1);
  });
  it("deletes expired unreferenced guests and anonymizes audit metadata", async () => {
    const f = await fixture(),
      a = await f.guest();
    await f.db
      .prepare("UPDATE users SET guest_expires_at=? WHERE id=?")
      .bind(iso(Date.now() - 1), a.actor.userId)
      .run();
    expect(await f.app.command(a.actor, "profile", {})).toMatchObject({
      ok: false,
      status: 401,
    });
    await f.app.cleanup();
    expect(
      (await f.db.prepare("SELECT * FROM users").all()).results,
    ).toHaveLength(0);
  });
});
