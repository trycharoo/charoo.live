import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { authenticate, settings, eligible, type Actor } from "../shared/data";
import { result, requireThat } from "../shared/errors";
import { sendSocket, closeSocket } from "../shared/sockets";
import { z } from "@charoo/contracts";
class Hub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS charoo_values(key TEXT PRIMARY KEY,value TEXT NOT NULL,until INTEGER NOT NULL)",
    );
  }
  protected get(key: string): any {
    const r = this.ctx.storage.sql
      .exec(
        "SELECT value FROM charoo_values WHERE key=? AND until>?",
        key,
        Date.now(),
      )
      .toArray()[0];
    return r ? JSON.parse(r.value as string) : null;
  }
  protected put(key: string, value: any, until: number) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_values(key,value,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,until=excluded.until",
      key,
      JSON.stringify(value),
      until,
    );
  }
  protected remove(key: string) {
    this.ctx.storage.sql.exec("DELETE FROM charoo_values WHERE key=?", key);
  }
  async limit(key: string, max: number, seconds: number) {
    const r = this.get(`rate:${key}`) || {
      n: 0,
      until: Date.now() + seconds * 1000,
    };
    r.n++;
    this.put(`rate:${key}`, r, r.until);
    await this.arm();
    return r.n <= max;
  }
  protected async arm() {
    const r = this.ctx.storage.sql
      .exec("SELECT min(until) AS until FROM charoo_values")
      .toArray()[0];
    const due = Number(r?.until) || 0;
    const sockets = this.ctx.getWebSockets().length;
    const next = sockets ? Math.min(due || Infinity, Date.now() + 30000) : due;
    if (next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, next));
    else await this.ctx.storage.deleteAlarm();
  }
  protected async connectionLimit(actor: Actor) {
    return this.env.USER_HUB.getByName(actor.userId).limit(
      "socket:discovery",
      20,
      60,
    );
  }
  protected async eventLimit(actor: Actor) {
    return this.env.USER_HUB.getByName(actor.userId).limit(
      "socket:event",
      100,
      60,
    );
  }
  protected async validate(actor: Actor) {
    return authenticate(this.env, actor);
  }
  async notify(event: any) {
    for (const ws of this.ctx.getWebSockets())
      try {
        await this.validate(
          (ws.deserializeAttachment() as { actor: Actor }).actor,
        );
        sendSocket(ws, event);
      } catch {
        ws.close(4001, "Session unavailable");
      }
  }
  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const actor = {
      userId: request.headers.get("X-Charoo-User") || "",
      sessionHash: request.headers.get("X-Charoo-Session") || "",
    };
    try {
      await this.validate(actor);
      requireThat(
        await this.connectionLimit(actor),
        429,
        "Socket limit reached",
      );
    } catch {
      return new Response("Session unavailable", { status: 401 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ actor });
    await this.arm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      requireThat(
        typeof message === "string" && message.length < 8192,
        400,
        "Invalid event",
      );
      z.object({ type: z.literal("ping") }).parse(
        JSON.parse(message as string),
      );
      const actor = (ws.deserializeAttachment() as { actor: Actor }).actor;
      await this.validate(actor);
      requireThat(await this.eventLimit(actor), 429, "Too many events");
      sendSocket(ws, { type: "pong" });
    } catch {
      ws.close(4001, "Session unavailable");
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {}
    await this.arm();
  }
  async webSocketError(ws: WebSocket) {
    try {
      ws.close(4002, "Reconnect");
    } catch {}
    await this.arm();
  }
  async alarm() {
    this.ctx.storage.sql.exec(
      "DELETE FROM charoo_values WHERE until<=?",
      Date.now(),
    );
    for (const ws of this.ctx.getWebSockets())
      try {
        await this.validate(
          (ws.deserializeAttachment() as { actor: Actor }).actor,
        );
      } catch {
        ws.close(4001, "Session unavailable");
      }
    await this.arm();
  }
}
export class RateLimiter extends Hub {}
export class Discovery extends Hub {
  protected override async validate(actor: Actor) {
    const u = await authenticate(this.env, actor);
    await eligible(this.env, u);
    return u;
  }
}
export class UserHub extends Hub {
  protected override async connectionLimit(_actor: Actor) {
    return this.limit("socket:user", 20, 60);
  }
  protected override async eventLimit(_actor: Actor) {
    return this.limit("socket:event", 100, 60);
  }
  async presence(): Promise<{ status: string; availableExpires: boolean }> {
    const p = this.get("presence");
    return {
      status: p
        ? p === "Available Tonight" && !this.get("available")
          ? "Online"
          : p
        : "Offline",
      availableExpires: !!this.get("available"),
    };
  }
  async setPresence(
    actor: Actor,
    input: { status: string; heartbeat: boolean },
  ) {
    return result(async () => {
      const u = await authenticate(this.env, actor);
      requireThat(this.ctx.id.name === u.id, 403, "User unavailable");
      if (input.status === "Offline") {
        this.remove("presence");
        this.remove("available");
        await this.arm();
        return this.presence();
      }
      const cfg = await settings(this.env);
      if (input.status === "Available Tonight") {
        requireThat(
          u.verified,
          403,
          "Verify your email to use Available Tonight",
        );
        requireThat(
          cfg.available_tonight_enabled,
          403,
          "Available Tonight is currently disabled",
        );
      }
      this.ctx.storage.transactionSync(() => {
        if (input.status === "Available Tonight") {
          if (!input.heartbeat && !this.get("available"))
            this.put(
              "available",
              true,
              Date.now() + cfg.available_tonight_duration_hours * 3600000,
            );
        } else this.remove("available");
        this.put(
          "presence",
          input.status === "Available Tonight" && this.get("available")
            ? "Available Tonight"
            : "Online",
          Date.now() + 90000,
        );
      });
      await this.arm();
      return this.presence();
    });
  }
  async offline(sessionHash?: string) {
    this.remove("presence");
    this.remove("available");
    for (const ws of this.ctx.getWebSockets())
      try {
        if (
          sessionHash &&
          (ws.deserializeAttachment() as { actor: Actor }).actor.sessionHash !==
            sessionHash
        )
          continue;
        ws.send(JSON.stringify({ type: "session.revoked" }));
        ws.close(4001, "Session unavailable");
      } catch {}
    await this.arm();
  }
  protected override async validate(actor: Actor) {
    requireThat(this.ctx.id.name === actor.userId, 403, "User unavailable");
    return authenticate(this.env, actor);
  }
}
