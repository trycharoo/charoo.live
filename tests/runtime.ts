// SQLite-backed test adapters. The browser suite separately runs the real Celld runtime.
import { DatabaseSync } from "node:sqlite";
import { AppCoordinator } from "../celld/durable-objects/app";
import { Room } from "../celld/durable-objects/room";
import { Matcher } from "../celld/durable-objects/matcher";
import { UserHub, Discovery, RateLimiter } from "../celld/durable-objects/hubs";
import type { Env, Job } from "../celld/env";
import type { Actor } from "../celld/shared/data";
import { unwrap } from "../celld/shared/errors";

const bindings = (values: any[]) =>
  values.map((v) => (typeof v === "boolean" ? Number(v) : v));
export class TestD1 {
  database = new DatabaseSync(":memory:");
  fail: ((sql: string) => boolean) | null = null;
  prepare(sql: string): any {
    let values: any[] = [];
    const query = {
      sql,
      bind(...params: any[]) {
        values = bindings(params);
        return query;
      },
      all: async () => ({ results: this.database.prepare(sql).all(...values) }),
      first: async (column?: string) => {
        const row: any = this.database.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      run: async () => {
        const meta = this.database.prepare(sql).run(...values);
        return { success: true, meta };
      },
      execute: () => {
        const s = this.database.prepare(sql);
        return s.columns().length
          ? { results: s.all(...values), success: true }
          : { meta: s.run(...values), success: true };
      },
    };
    return query;
  }
  async exec(sql: string) {
    this.database.exec(sql);
    return { count: 0, duration: 0 };
  }
  async batch(queries: any[]) {
    if (this.fail && queries.some((q) => this.fail!(q.sql))) {
      this.fail = null;
      throw new Error("Injected storage interruption");
    }
    this.database.exec("BEGIN");
    try {
      const results = queries.map((q) => q.execute());
      this.database.exec("COMMIT");
      return results;
    } catch (e) {
      this.database.exec("ROLLBACK");
      throw e;
    }
  }
}
export class TestState {
  database = new DatabaseSync(":memory:");
  id: { name: string };
  alarm: number | null = null;
  tail: Promise<unknown> = Promise.resolve();
  initialized = this.tail;
  sockets: WebSocket[] = [];
  constructor(name: string) {
    this.id = { name };
  }
  storage = {
    sql: {
      exec: (sql: string, ...params: any[]) => {
        if (!params.length && !/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
          this.database.exec(sql);
          return { toArray: () => [] };
        }
        const query = this.database.prepare(sql),
          rows = query.columns().length
            ? query.all(...bindings(params))
            : (query.run(...bindings(params)), []);
        return { toArray: () => rows };
      },
    },
    transactionSync: <T>(fn: () => T) => {
      this.database.exec("SAVEPOINT room");
      try {
        const value = fn();
        this.database.exec("RELEASE room");
        return value;
      } catch (e) {
        this.database.exec("ROLLBACK TO room; RELEASE room");
        throw e;
      }
    },
    setAlarm: async (at: number) => {
      this.alarm = at;
    },
    deleteAlarm: async () => {
      this.alarm = null;
    },
  };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const call = this.tail.then(fn);
    this.tail = call.catch(() => {});
    if (this.initialized === undefined || !this.started) {
      this.initialized = call;
      this.started = true;
    }
    return call;
  }
  private started = false;
  getWebSockets() {
    return this.sockets;
  }
}
class Namespace<T> {
  instances = new Map<string, T>();
  states = new Map<string, TestState>();
  constructor(
    private ctor: new (ctx: DurableObjectState, env: Env) => T,
    private env: Env,
  ) {}
  getByName(name: string): T {
    if (!this.instances.has(name)) {
      const state = this.states.get(name) || new TestState(name);
      this.states.set(name, state);
      this.instances.set(
        name,
        new this.ctor(state as unknown as DurableObjectState, this.env),
      );
    }
    return this.instances.get(name)!;
  }
  restart(name: string) {
    this.instances.delete(name);
    return this.getByName(name);
  }
}
export async function fixture() {
  const db = new TestD1(),
    jobs: Job[] = [],
    media = new Map<string, { bytes: Uint8Array; mime: string }>();
  const env = {
    WEB_ORIGIN: "http://localhost:5173",
    MESSAGE_KEY: btoa("x".repeat(32)),
    NODE_ENV: "development",
    DB: db,
    JOBS: {
      send: async (job: Job) => {
        jobs.push(job);
      },
    },
    MEDIA: {
      put: async (key: string, bytes: Uint8Array, options: any) => {
        if (options?.onlyIf?.etagDoesNotMatch === "*" && media.has(key))
          return null;
        media.set(key, { bytes, mime: options?.httpMetadata?.contentType });
      },
      delete: async (key: string) => {
        media.delete(key);
      },
      head: async (key: string) => {
        const m = media.get(key);
        return m
          ? { size: m.bytes.length, httpMetadata: { contentType: m.mime } }
          : null;
      },
      get: async (key: string) => {
        const m = media.get(key);
        return m
          ? {
              size: m.bytes.length,
              body: new Response(new Uint8Array(m.bytes)).body,
            }
          : null;
      },
    },
  } as unknown as Env;
  const rooms = new Namespace(Room, env),
    apps = new Namespace(AppCoordinator, env),
    matcher = new Namespace(Matcher, env),
    users = new Namespace(UserHub, env);
  Object.assign(env, {
    ROOM: rooms,
    APP: apps,
    MATCHER: matcher,
    USER_HUB: users,
    DISCOVERY: new Namespace(Discovery, env),
    RATE_LIMITER: new Namespace(RateLimiter, env),
  });
  const app = apps.getByName("charoo");
  await apps.states.get("charoo")!.initialized;
  async function guest(verified = false, role = "USER") {
    const value = unwrap(
      await app.command(null, "guest", { communityConsent: true }),
    );
    const { hash } = await import("../celld/shared/crypto");
    const actor: Actor = {
      userId: value.user.id,
      sessionHash: await hash(value.token),
    };
    if (verified || role !== "USER")
      await db
        .prepare(
          "UPDATE users SET verified=?,email=?,guest_expires_at=NULL,role=? WHERE id=?",
        )
        .bind(
          verified ? 1 : 0,
          `${actor.userId}@example.com`,
          role,
          actor.userId,
        )
        .run();
    unwrap(
      await users
        .getByName(actor.userId)
        .setPresence(actor, { status: "Online", heartbeat: false }),
    );
    return { actor, token: value.token as string, csrf: value.csrf as string };
  }
  async function drain() {
    for (const row of (await db.prepare("SELECT id FROM app_outbox").all())
      .results)
      await app.deliver(row.id);
    for (const [name, room] of rooms.instances) {
      await (room as Room).flush();
    }
  }
  return {
    env,
    db,
    app,
    rooms,
    apps,
    matcher,
    users,
    jobs,
    media,
    guest,
    drain,
  };
}
