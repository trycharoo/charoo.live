import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import {
  all,
  first,
  run,
  user,
  authenticate,
  settings,
  blocked,
  hub,
  coordinator,
  roomStub,
  type Actor,
} from "../shared/data";
import { result, requireThat, unwrap, type Result } from "../shared/errors";
export class Matcher extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS charoo_waiting(user_id TEXT PRIMARY KEY,queued_at INTEGER NOT NULL,until INTEGER NOT NULL)",
    );
  }
  async status() {
    return {
      queue: Number(
        this.ctx.storage.sql
          .exec(
            "SELECT count(*) AS n FROM charoo_waiting WHERE until>?",
            Date.now(),
          )
          .toArray()[0]!.n,
      ),
    };
  }
  async match(
    actor: Actor,
  ): Promise<Result<{ roomId: string } | { queued: true }>> {
    return this.ctx.blockConcurrencyWhile(() =>
      result(async () => {
        const env = this.env,
          u = await authenticate(env, actor),
          cfg = await settings(env);
        requireThat(
          u.verified || cfg.guest_access_enabled,
          403,
          "Guest matching disabled",
        );
        requireThat(
          (await hub(env, u.id).presence()).status !== "Offline",
          403,
          "Go online first",
        );
        const active = await first(
          env,
          "SELECT room_id FROM active_matches WHERE user_id=?",
          [u.id],
        );
        if (active) {
          const room = await roomStub(env, active.room_id).authorize(actor);
          if (room.ok) return { roomId: active.room_id };
          await coordinator(env).recoverRoom(active.room_id);
          const recovered = await roomStub(env, active.room_id).authorize(
            actor,
          );
          if (recovered.ok) return { roomId: active.room_id };
          if (recovered.status === 410)
            await roomStub(env, active.room_id).sweep();
          const index = await first(
            env,
            "SELECT state FROM room_index WHERE id=?",
            [active.room_id],
          );
          if (!index || index.state === "OPEN") unwrap(recovered);
          await run(env, "DELETE FROM active_matches WHERE user_id=?", [u.id]);
        }
        this.ctx.storage.sql.exec(
          "INSERT INTO charoo_waiting(user_id,queued_at,until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET until=excluded.until",
          u.id,
          Date.now(),
          Date.now() + 90000,
        );
        for (const row of this.ctx.storage.sql
          .exec(
            "SELECT user_id FROM charoo_waiting WHERE until>? ORDER BY queued_at,user_id LIMIT 200",
            Date.now(),
          )
          .toArray()) {
          const id = row.user_id as string;
          if (id === u.id) continue;
          if ((await hub(env, id).presence()).status === "Offline") {
            this.ctx.storage.sql.exec(
              "DELETE FROM charoo_waiting WHERE user_id=?",
              id,
            );
            continue;
          }
          const reservation = await coordinator(env).reserveMatch(u.id, id);
          if (!reservation.ok) {
            if (reservation.status >= 500) throw new Error(reservation.message);
            continue;
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM charoo_waiting WHERE user_id IN (?,?)",
            u.id,
            id,
          );
          await this.arm();
          return reservation.value;
        }
        await this.arm();
        return { queued: true };
      }),
    );
  }
  async cancel(actor: Actor) {
    return this.ctx.blockConcurrencyWhile(() =>
      result(async () => {
        await authenticate(this.env, actor);
        this.ctx.storage.sql.exec(
          "DELETE FROM charoo_waiting WHERE user_id=?",
          actor.userId,
        );
        await this.arm();
        return null;
      }),
    );
  }
  async cancelInternal(id: string) {
    this.ctx.storage.sql.exec("DELETE FROM charoo_waiting WHERE user_id=?", id);
    await this.arm();
  }
  async heartbeat(id: string) {
    this.ctx.storage.sql.exec(
      "UPDATE charoo_waiting SET until=? WHERE user_id=?",
      Date.now() + 90000,
      id,
    );
    await this.arm();
  }
  private async arm() {
    const r = this.ctx.storage.sql
      .exec("SELECT min(until) AS due FROM charoo_waiting")
      .toArray()[0];
    if (r?.due)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 100, Number(r.due)),
      );
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    this.ctx.storage.sql.exec(
      "DELETE FROM charoo_waiting WHERE until<=?",
      Date.now(),
    );
    await this.arm();
  }
}
