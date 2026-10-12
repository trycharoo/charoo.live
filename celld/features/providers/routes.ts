import type { Hono } from "hono";
import { z } from "@charoo/contracts";
import { all, first, roomStub, iso } from "../../shared/data";
import { requireThat, unwrap } from "../../shared/errors";
import {
  actor,
  body,
  uuid,
  userRate,
  type HttpEnv,
  type HttpContext,
} from "../../http/context";
import { suggestion } from "./assistant";
import { callToken } from "./livekit";

export async function locate(c: HttpContext, kind: string) {
  const id = uuid(c.req.param("id")),
    r = await first(
      c.env,
      "SELECT room_id FROM entity_index WHERE id=? AND kind=?",
      [id, kind],
    );
  requireThat(
    r,
    404,
    kind === "call" ? "Call unavailable" : "Attachment unavailable",
  );
  return { id, room: roomStub(c.env, r.room_id), roomId: r.room_id };
}
export function providerRoutes(app: Hono<HttpEnv>) {
  app.get("/api/calls", async (c) => {
    const id = actor(c).userId,
      rows = await all(
        c.env,
        `SELECT DISTINCT e.room_id FROM entity_index e WHERE kind='call' AND json_extract(data,'$.state')<>'ENDED' AND json_extract(data,'$.expires_at')>? AND (json_extract(data,'$.caller_id')=? OR json_extract(data,'$.target_id')=?)`,
        [iso(), id, id],
      );
    const calls = [];
    for (const r of rows) {
      const value = await roomStub(c.env, r.room_id).command(
        actor(c),
        "call.list",
      );
      if (value.ok) calls.push(...value.value);
      else if (value.status >= 500) unwrap(value);
    }
    return c.json(calls);
  });
  app.post(
    "/api/calls",
    body(
      z.object({
        roomId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
        targetId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      }),
    ),
    async (c) => {
      await userRate(c, "call", 5, 600, "Call limit reached");
      return c.json(
        unwrap(
          await roomStub(c.env, c.get("input").roomId).command(
            actor(c),
            "call.create",
            c.get("input"),
          ),
        ),
        201,
      );
    },
  );
  app.post(
    "/api/calls/:id/respond",
    body(z.object({ accept: z.boolean() })),
    async (c) => {
      const r = await locate(c, "call");
      unwrap(
        await r.room.command(actor(c), "call.respond", {
          id: r.id,
          ...c.get("input"),
        }),
      );
      return c.body(null, 204);
    },
  );
  app.post("/api/calls/:id/token", async (c) => {
    const r = await locate(c, "call");
    unwrap(await r.room.command(actor(c), "call.token", { id: r.id }));
    return c.json(await callToken(c.env, r.id, actor(c).userId));
  });
  app.post("/api/calls/:id/end", async (c) => {
    const r = await locate(c, "call");
    unwrap(await r.room.command(actor(c), "call.end", { id: r.id }));
    return c.body(null, 204);
  });
  app.post(
    "/api/assistant",
    body(
      z.object({
        roomId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
        style: z.enum(["icebreaker", "playful", "reply", "revive"]),
      }),
    ),
    async (c) => c.json(await suggestion(c.env, actor(c), c.get("input"))),
  );
}
