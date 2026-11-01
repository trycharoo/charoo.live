import type { Hono } from "hono";
import { z, settingsSchema } from "@charoo/contracts";
import {
  all,
  first,
  coordinator,
  settings,
  roomStub,
  audit,
  iso,
} from "../../shared/data";
import { unwrap, requireThat } from "../../shared/errors";
import { actor, body, uuid, type HttpEnv } from "../../http/context";

export function adminRoutes(app: Hono<HttpEnv>) {
  app.use("/api/admin/*", async (c, next) => {
    actor(c);
    requireThat(
      ["ADMIN", "MODERATOR", "SUPPORT"].includes(c.get("user").role),
      403,
      "Staff role required",
    );
    return next();
  });
  app.get("/api/admin/dashboard", async (c) =>
    c.json({
      ...(await first(
        c.env,
        `SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM room_index WHERE state='OPEN' AND type='AVAILABLE_TONIGHT' AND (expires_at IS NULL OR expires_at>?)) AS public_rooms,(SELECT count(*) FROM room_index WHERE state='OPEN' AND type='SHARED_GROUP' AND (expires_at IS NULL OR expires_at>?)) AS shared_rooms,(SELECT count(*) FROM reports WHERE state='OPEN') AS reports`,
        [iso(), iso()],
      )),
      ...(await c.env.MATCHER.getByName("charoo").status()),
      settings: await settings(c.env),
      providers: {
        email: !!(c.env.RESEND_API_KEY || c.env.MAILPIT_URL),
        media: !!(c.env.MEDIA_SCANNER_URL && c.env.MEDIA_SCANNER_TOKEN),
        video: !!(
          c.env.LIVEKIT_API_KEY &&
          c.env.LIVEKIT_API_SECRET &&
          c.env.LIVEKIT_URL
        ),
        ai: !!(c.env.AI_API_KEY && c.env.AI_BASE_URL && c.env.AI_MODEL),
      },
    }),
  );
  app.get("/api/admin/reports", async (c) =>
    c.json(
      await all(
        c.env,
        "SELECT * FROM reports ORDER BY created_at DESC LIMIT 100",
      ),
    ),
  );
  app.get("/api/admin/reports/:id/evidence", async (c) => {
    requireThat(
      ["ADMIN", "MODERATOR"].includes(c.get("user").role),
      403,
      "Moderator role required",
    );
    const id = uuid(c.req.param("id")),
      r = await first(c.env, "SELECT * FROM reports WHERE id=?", [id]);
    requireThat(r, 404, "Report unavailable");
    await audit(c.env, actor(c).userId, "report.evidence.read", id);
    return c.json(
      r.room_id
        ? unwrap(await roomStub(c.env, r.room_id).evidence(actor(c), id))
        : { text: null },
    );
  });
  app.get("/api/admin/rooms", async (c) =>
    c.json(
      await all(
        c.env,
        "SELECT id,type,json_extract(data,'$.title') AS title,creator_id,state,created_at,expires_at FROM room_index WHERE coalesce(json_extract(data,'$.purged'),0)=0 ORDER BY created_at DESC LIMIT 100",
      ),
    ),
  );
  app.get("/api/admin/users", async (c) => {
    const q = z
      .object({
        q: z.string().max(100).default(""),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(c.req.query());
    const like = `%${q.q.trim().toLowerCase()}%`;
    return c.json(
      await all(
        c.env,
        `SELECT id,display_name,email,verified,role,banned,suspended_until,created_at FROM users WHERE (?='' OR lower(display_name) LIKE ? OR lower(coalesce(email,'')) LIKE ?) ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        [q.q.trim(), like, like, q.limit],
      ),
    );
  });
  app.get("/api/admin/audit", async (c) => {
    requireThat(c.get("user").role === "ADMIN", 403, "Admin role required");
    return c.json(
      (
        await all(
          c.env,
          "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100",
        )
      ).map((r) => ({ ...r, details: JSON.parse(r.details) })),
    );
  });
  app.patch("/api/admin/settings", body(settingsSchema), async (c) =>
    c.json(
      unwrap(
        await coordinator(c.env).command(actor(c), "settings", c.get("input")),
      ),
    ),
  );
  app.post(
    "/api/admin/actions",
    body(
      z.object({
        action: z.enum(["CLOSE_ROOM", "BAN", "SUSPEND", "RESOLVE_REPORT"]),
        targetId: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      }),
    ),
    async (c) => {
      unwrap(
        await coordinator(c.env).command(
          actor(c),
          "admin.action",
          c.get("input"),
        ),
      );
      return c.body(null, 204);
    },
  );
}
