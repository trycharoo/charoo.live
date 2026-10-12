// Test-only entry point. Production wrangler.jsonc points exclusively at celld/index.ts.
import worker from "../../celld/index";
import { Room as ApplicationRoom } from "../../celld/durable-objects/room";
import {
  coordinator,
  roomStub,
  run,
  publicUser,
  user,
} from "../../celld/shared/data";
import { unwrap } from "../../celld/shared/errors";
import type { Env } from "../../celld/env";
export {
  AppCoordinator,
  Matcher,
  UserHub,
  Discovery,
  RateLimiter,
} from "../../celld/index";
export class Room extends ApplicationRoom {
  inspect() {
    return {
      meta: this.ctx.storage.sql.exec("SELECT data FROM charoo_meta").toArray(),
      messages: this.ctx.storage.sql
        .exec("SELECT * FROM charoo_messages")
        .toArray(),
      outbox: this.ctx.storage.sql
        .exec("SELECT * FROM charoo_outbox")
        .toArray(),
    };
  }
  expire() {
    const row = this.ctx.storage.sql
      .exec("SELECT data FROM charoo_meta")
      .toArray()[0];
    const r = JSON.parse(row!.data as string);
    r.expires_at = new Date(Date.now() - 1).toISOString();
    this.ctx.storage.sql.exec(
      "UPDATE charoo_meta SET data=?",
      JSON.stringify(r),
    );
  }
}
export default {
  ...worker,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__test/")) {
      if (request.headers.get("X-Test-Key") !== "charoo-native-fixture")
        return new Response("Unavailable", { status: 403 });
      await coordinator(env).ready();
      if (url.pathname === "/__test/session") {
        const input: any = await request.json(),
          value = unwrap(
            await coordinator(env).command(null, "guest", {
              communityConsent: true,
            }),
          );
        if (input.verified)
          await run(
            env,
            "UPDATE users SET verified=1,email=?,guest_expires_at=NULL,role=? WHERE id=?",
            [
              input.email || `${value.user.id}@fixture.example`,
              input.role || "USER",
              value.user.id,
            ],
          );
        return Response.json(
          { ...value, user: publicUser(await user(env, value.user.id)) },
          {
            headers: {
              "Set-Cookie": `charoo_session=${value.token}; Path=/; HttpOnly; SameSite=Lax`,
            },
          },
        );
      }
      if (url.pathname === "/__test/room") {
        const input: any = await request.json(),
          room: any = roomStub(env, input.id);
        if (input.action === "expire") await room.expire();
        return Response.json(await room.inspect());
      }
      if (url.pathname === "/__test/settings") {
        const input = await request.json();
        await run(env, "UPDATE settings SET value=?", [JSON.stringify(input)]);
        return new Response(null, { status: 204 });
      }
      return new Response("Unavailable", { status: 404 });
    }
    return worker.fetch(request, env, ctx);
  },
};
