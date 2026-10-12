import type { Hono } from "hono";
import { z, roomSchema, messageSchema } from "@charoo/contracts";
import {
  all,
  first,
  roomStub,
  coordinator,
  eligible,
  iso,
  parseCursor,
  cursor,
} from "../../shared/data";
import { hash } from "../../shared/crypto";
import { unwrap, requireThat } from "../../shared/errors";
import {
  actor,
  body,
  uuid,
  userRate,
  socketRequest,
  type HttpEnv,
  type HttpContext,
} from "../../http/context";

export function roomRoutes(app: Hono<HttpEnv>) {
  app.post("/api/match", async (c) =>
    c.json(unwrap(await c.env.MATCHER.getByName("charoo").match(actor(c)))),
  );
  app.delete("/api/match", async (c) => {
    unwrap(await c.env.MATCHER.getByName("charoo").cancel(actor(c)));
    return c.body(null, 204);
  });
  app.get("/api/rooms", async (c) => {
    await eligible(c.env, c.get("user"));
    const q = z
      .object({
        q: z.string().max(100).default(""),
        category: z.string().max(30).default(""),
        before: z.string().max(300).optional(),
      })
      .parse(c.req.query());
    const pos = parseCursor(q.before),
      uid = actor(c).userId;
    const rows = await all(
      c.env,
      `SELECT r.* FROM room_index r WHERE type='AVAILABLE_TONIGHT' AND state='OPEN' AND expires_at>?
      AND (?='' OR coalesce(json_extract(data,'$.searchFolded.title'),lower(json_extract(data,'$.title'))) LIKE '%'||?||'%' OR coalesce(json_extract(data,'$.searchFolded.description'),lower(json_extract(data,'$.description'))) LIKE '%'||?||'%' OR coalesce(json_extract(data,'$.searchFolded.tags'),lower(json_extract(data,'$.tags'))) LIKE '%'||?||'%')
      AND (?='' OR json_extract(data,'$.category')=?) AND (? IS NULL OR (created_at,id)<(?,?))
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.target_id=r.creator_id) OR (b.target_id=? AND b.user_id=r.creator_id)) ORDER BY created_at DESC,id DESC LIMIT 30`,
      [
        iso(),
        q.q.toLowerCase(),
        q.q.toLowerCase(),
        q.q.toLowerCase(),
        q.q.toLowerCase(),
        q.category,
        q.category,
        pos?.at || null,
        pos?.at || null,
        pos?.id || null,
        uid,
        uid,
      ],
    );
    const rooms = [];
    for (const r of rows) {
      const value = await roomStub(c.env, r.id).preview(actor(c));
      if (value.ok) rooms.push(value.value);
      else if (value.status >= 500) unwrap(value);
    }
    return c.json({
      rooms,
      next: rows.length === 30 ? cursor(rows.at(-1)!) : null,
    });
  });
  app.get("/api/conversations", async (c) => {
    const rows = await all(
      c.env,
      `SELECT r.id FROM room_index r JOIN membership_index p ON p.room_id=r.id WHERE p.user_id=? AND p.state='JOINED' AND r.state='OPEN' AND (r.expires_at IS NULL OR r.expires_at>?) ORDER BY r.last_activity DESC LIMIT 50`,
      [actor(c).userId, iso()],
    );
    const rooms = [];
    for (const r of rows) {
      const value = await roomStub(c.env, r.id).command(actor(c), "snapshot");
      if (value.ok) rooms.push(value.value);
      else if (value.status >= 500) unwrap(value);
    }
    return c.json(rooms);
  });
  app.post("/api/rooms", body(roomSchema), async (c) => {
    await userRate(c, "room-create", 10, 3600, "Room creation limit reached");
    if (c.get("input").type === "AVAILABLE_TONIGHT")
      await eligible(c.env, c.get("user"));
    return c.json(
      unwrap(
        await coordinator(c.env).command(
          actor(c),
          "room.create",
          c.get("input"),
        ),
      ),
      201,
    );
  });
  app.post(
    "/api/shared/join",
    body(z.object({ token: z.string().min(30).max(100) })),
    async (c) => {
      const tokenHash = await hash(c.get("input").token),
        r = await first(
          c.env,
          "SELECT room_id FROM invite_index WHERE token_hash=?",
          [tokenHash],
        );
      requireThat(r, 404, "Room unavailable");
      return c.json(
        unwrap(
          await roomStub(c.env, r.room_id).command(actor(c), "join", {
            tokenHash,
          }),
        ),
      );
    },
  );
  const command = (
    c: HttpContext,
    kind: string,
    input = c.get("input") || {},
  ) =>
    roomStub(c.env, uuid(c.req.param("roomId")))
      .command(actor(c), kind, input)
      .then(unwrap);
  app.get("/api/rooms/:roomId", async (c) =>
    c.json(await command(c, "snapshot")),
  );
  app.get("/api/rooms/:roomId/messages", async (c) =>
    c.json(
      await command(
        c,
        "messages",
        z
          .object({ before: z.string().max(300).optional() })
          .parse(c.req.query()),
      ),
    ),
  );
  app.get("/api/rooms/:roomId/socket", (c) =>
    roomStub(c.env, uuid(c.req.param("roomId"))).fetch(socketRequest(c)),
  );
  app.post("/api/rooms/:roomId/join", async (c) => {
    await command(c, "join");
    return c.body(null, 204);
  });
  app.post("/api/rooms/:roomId/invite", async (c) =>
    c.json(await command(c, "invite")),
  );
  app.post("/api/rooms/:roomId/messages", body(messageSchema), async (c) => {
    await userRate(c, "message", 40, 60, "Message limit reached");
    return c.json(await command(c, "message"), 201);
  });
  app.post("/api/rooms/:roomId/read", async (c) => {
    await command(c, "read");
    return c.body(null, 204);
  });
  app.post(
    "/api/rooms/:roomId/reactions",
    body(
      z.object({
        messageId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
        emoji: z.enum(["❤️", "👍", "😂", "🔥"]),
        remove: z.boolean().default(false),
      }),
    ),
    async (c) => {
      await command(c, "reaction");
      return c.body(null, 204);
    },
  );
  app.post("/api/rooms/:roomId/leave", async (c) => {
    await command(c, "leave");
    return c.body(null, 204);
  });
  app.patch(
    "/api/rooms/:roomId",
    body(
      z.object({
        title: z.string().trim().min(3).max(100),
        description: z.string().trim().max(500),
        slowMode: z.number().int().min(0).max(60),
      }),
    ),
    async (c) => {
      await command(c, "edit");
      return c.body(null, 204);
    },
  );
  app.post(
    "/api/rooms/:roomId/moderate",
    body(
      z.object({
        action: z.enum(["CLOSE", "REMOVE", "MUTE"]),
        targetId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase())
          .optional(),
      }),
    ),
    async (c) => {
      await command(c, "moderate");
      return c.body(null, 204);
    },
  );
}
