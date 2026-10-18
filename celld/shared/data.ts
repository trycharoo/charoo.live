import type { Env } from "../env";
import type { Profile, Settings, RoomType } from "@charoo/contracts";
import { defaultSettings } from "@charoo/contracts";
import { requireThat } from "./errors";
export interface Actor {
  userId: string;
  sessionHash: string;
}
export interface Account {
  id: string;
  email: string | null;
  verified: boolean;
  display_name: string;
  profile: Profile;
  role: "USER" | "SUPPORT" | "MODERATOR" | "ADMIN";
  banned: boolean;
  suspended_until: string | null;
  created_at: string;
  guest_expires_at: string | null;
}
export interface RoomRecord {
  id: string;
  type: RoomType;
  creator_id: string;
  title: string;
  description: string;
  category: string;
  region: string;
  tags: string[];
  verified_only: boolean;
  slow_mode: number;
  state: "OPEN" | "CLOSED";
  asl_revealed: boolean;
  created_at: string;
  last_activity: string;
  expires_at: string | null;
  closed_at: string | null;
  purge_at: string | null;
  version: number;
}
export const iso = (at = Date.now()) => new Date(at).toISOString();
// Local no-auth mode (ADMIN_NO_AUTH=true): requests to /api/admin/* run as
// this synthetic admin. For trusted networks / Zero Trust only — never enable
// in production.
export const LOCAL_ADMIN_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_ADMIN_SESSION = "no-auth";
export function localAdminEnabled(
  env: Pick<Env, "ADMIN_NO_AUTH" | "NODE_ENV">,
) {
  return env.NODE_ENV !== "production" && env.ADMIN_NO_AUTH === "true";
}
export function isLocalAdmin(actor: Actor) {
  return (
    actor.userId === LOCAL_ADMIN_ID && actor.sessionHash === LOCAL_ADMIN_SESSION
  );
}
export function localAdminAccount(): Account {
  return {
    id: LOCAL_ADMIN_ID,
    email: null,
    verified: true,
    display_name: "Local admin",
    profile: {
      displayName: "Local admin",
      age: null,
      gender: "",
      region: "",
      bio: "",
      interests: [],
      aslVisibility: "private",
    },
    role: "ADMIN",
    banned: false,
    suspended_until: null,
    created_at: iso(),
    guest_expires_at: null,
  };
}
export function localAdminActor(): Actor {
  return { userId: LOCAL_ADMIN_ID, sessionHash: LOCAL_ADMIN_SESSION };
}
export const roomStub = (env: Env, id: string) =>
  env.ROOM.getByName(`charoo:${id}`);
export const coordinator = (env: Env) => env.APP.getByName("charoo");
export const hub = (env: Env, id: string) => env.USER_HUB.getByName(id);
export const stmt = (env: Env, sql: string, params: unknown[] = []) =>
  env.DB.prepare(sql).bind(...params);
export async function all<T = any>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await stmt(env, sql, params).all<T>()).results;
}
export async function first<T = any>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return stmt(env, sql, params).first<T>();
}
export async function run(env: Env, sql: string, params: unknown[] = []) {
  return stmt(env, sql, params).run();
}
export function account(row: any): Account {
  return {
    ...row,
    verified: !!row.verified,
    banned: !!row.banned,
    profile:
      typeof row.profile === "string" ? JSON.parse(row.profile) : row.profile,
  };
}
export async function user(
  env: Env,
  id: string,
  options: { allowExpiredGuest?: boolean } = {},
) {
  const u = await first(env, "SELECT * FROM users WHERE id=?", [id]);
  requireThat(u, 401, "Session expired");
  requireThat(
    options.allowExpiredGuest ||
      u.verified ||
      !u.guest_expires_at ||
      Date.parse(u.guest_expires_at) > Date.now(),
    401,
    "Session expired",
  );
  requireThat(
    !u.banned &&
      (!u.suspended_until || Date.parse(u.suspended_until) <= Date.now()),
    403,
    "Account unavailable",
  );
  return account(u);
}
export async function authenticate(env: Env, actor: Actor) {
  const s = await first(
    env,
    "SELECT * FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?",
    [actor.sessionHash, actor.userId, iso()],
  );
  if (!s) {
    if (localAdminEnabled(env) && isLocalAdmin(actor))
      return localAdminAccount();
    requireThat(s, 401, "Session expired");
  }
  return user(env, actor.userId);
}
export async function settings(env: Env): Promise<Settings> {
  const r = await first(env, "SELECT value FROM settings WHERE id=1");
  return { ...defaultSettings, ...(r ? JSON.parse(r.value) : {}) };
}
export async function blocked(env: Env, a: string, b: string) {
  return !!(await first(
    env,
    "SELECT 1 FROM blocks WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)",
    [a, b, b, a],
  ));
}
export function publicUser(u: Account, status = "Offline") {
  return {
    id: u.id,
    displayName: u.display_name,
    verified: u.verified,
    role: u.role,
    profile: u.profile,
    status,
  };
}
export async function eligible(env: Env, u: Account) {
  requireThat(u.verified, 403, "Verify your email to use Available Tonight");
  requireThat(
    (await hub(env, u.id).presence()).status !== "Offline",
    403,
    "Go online to use Available Tonight",
  );
  requireThat(
    (await settings(env)).available_tonight_enabled,
    403,
    "Available Tonight is currently disabled",
  );
}
export function cursor(row: { created_at: string; id: string }) {
  return btoa(JSON.stringify({ at: row.created_at, id: row.id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function parseCursor(s?: string) {
  if (!s) return null;
  try {
    const r = JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
    requireThat(
      typeof r.at === "string" &&
        !Number.isNaN(Date.parse(r.at)) &&
        /^[0-9a-f-]{36}$/i.test(r.id),
      400,
      "Invalid pagination cursor",
    );
    return { at: r.at, id: r.id.toLowerCase() } as { at: string; id: string };
  } catch {
    requireThat(false, 400, "Invalid pagination cursor");
  }
}
export const emptyProfile = (name: string): Profile => ({
  displayName: name,
  age: null,
  gender: "",
  region: "",
  bio: "",
  interests: [],
  aslVisibility: "private",
});
export function auditStatement(
  env: Env,
  actor: string,
  action: string,
  target: string,
  details: unknown = {},
) {
  return stmt(
    env,
    "INSERT INTO audit_logs(id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      actor,
      action,
      target,
      JSON.stringify(details),
      iso(),
    ],
  );
}

export async function audit(
  env: Env,
  actor: string,
  action: string,
  target: string,
  details: unknown = {},
) {
  await auditStatement(env, actor, action, target, details).run();
}
