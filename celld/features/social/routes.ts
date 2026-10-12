import type { Hono } from "hono";
import { z, requestSchema, reportSchema } from "@charoo/contracts";
import { all, run, coordinator, roomStub, iso } from "../../shared/data";
import { requireThat, unwrap } from "../../shared/errors";
import { actor, body, uuid, userRate, type HttpEnv } from "../../http/context";

export function socialRoutes(app: Hono<HttpEnv>) {
  app.post(
    "/api/blocks",
    body(
      z.object({
        targetId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      }),
    ),
    async (c) => {
      unwrap(
        await coordinator(c.env).command(actor(c), "block", c.get("input")),
      );
      return c.body(null, 204);
    },
  );
  app.delete("/api/blocks/:id", async (c) => {
    unwrap(
      await coordinator(c.env).command(actor(c), "unblock", {
        targetId: uuid(c.req.param("id")),
      }),
    );
    return c.body(null, 204);
  });
  app.get("/api/blocks", async (c) =>
    c.json(
      await all(
        c.env,
        "SELECT u.id,u.display_name FROM blocks b JOIN users u ON u.id=b.target_id WHERE b.user_id=?",
        [actor(c).userId],
      ),
    ),
  );
  app.post(
    "/api/reports",
    body(
      reportSchema.refine(
        (v) => !v.messageId || !!v.roomId,
        "A message report needs roomId",
      ),
    ),
    async (c) => {
      const b = c.get("input");
      await userRate(c, "report", 10, 3600, "Report limit reached");
      if (b.roomId)
        unwrap(
          await roomStub(c.env, b.roomId).command(actor(c), "report.check", b),
        );
      await run(
        c.env,
        "INSERT INTO reports(id,reporter_id,target_id,room_id,message_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          actor(c).userId,
          b.targetId || null,
          b.roomId || null,
          b.messageId || null,
          b.reason,
          iso(),
        ],
      );
      return c.json(
        { message: "Report received. Thank you for helping keep Charoo safe." },
        201,
      );
    },
  );
  app.get("/api/requests", async (c) =>
    c.json(
      await all(
        c.env,
        `SELECT s.*,u.display_name FROM social_requests s JOIN users u ON u.id=s.requester_id WHERE s.target_id=? AND s.state='PENDING' AND s.expires_at>? ORDER BY s.created_at DESC`,
        [actor(c).userId, iso()],
      ),
    ),
  );
  app.post("/api/requests", body(requestSchema), async (c) => {
    await userRate(c, "request", 10, 3600, "Request limit reached");
    return c.json(
      unwrap(
        await coordinator(c.env).command(
          actor(c),
          "social.create",
          c.get("input"),
        ),
      ),
      201,
    );
  });
  app.post(
    "/api/requests/:id/respond",
    body(z.object({ accept: z.boolean() })),
    async (c) =>
      c.json(
        unwrap(
          await coordinator(c.env).command(actor(c), "social.respond", {
            ...c.get("input"),
            id: uuid(c.req.param("id")),
          }),
        ),
      ),
  );
  app.get("/api/contacts", async (c) => {
    const id = actor(c).userId;
    return c.json(
      await all(
        c.env,
        `SELECT c.room_id,u.id,u.display_name FROM contacts c JOIN users u ON u.id=CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END WHERE (c.user_a=? OR c.user_b=?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.target_id=u.id) OR (b.target_id=? AND b.user_id=u.id))`,
        [id, id, id, id, id],
      ),
    );
  });
  app.delete("/api/contacts/:id", async (c) => {
    unwrap(
      await coordinator(c.env).command(actor(c), "contact.remove", {
        targetId: uuid(c.req.param("id")),
      }),
    );
    return c.body(null, 204);
  });
  app.get("/api/reconnect", async (c) => {
    requireThat(c.get("user").verified, 403, "Verify your email first");
    const id = actor(c).userId;
    return c.json(
      await all(
        c.env,
        `SELECT u.id,u.display_name,h.matched_at FROM match_history h JOIN users u ON u.id=CASE WHEN h.user_a=? THEN h.user_b ELSE h.user_a END WHERE (h.user_a=? OR h.user_b=?) AND u.verified=1 AND u.banned=0 AND (u.suspended_until IS NULL OR u.suspended_until<=?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.target_id=u.id) OR (b.target_id=? AND b.user_id=u.id)) ORDER BY h.matched_at DESC LIMIT 30`,
        [id, id, id, iso(), id, id],
      ),
    );
  });
}
