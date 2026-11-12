import type { Room } from "./durable-objects/room";
import type { AppCoordinator } from "./durable-objects/app";
import type { Matcher } from "./durable-objects/matcher";
import type { UserHub, Discovery, RateLimiter } from "./durable-objects/hubs";
export const workerEnvironment = {
  required: ["WEB_ORIGIN", "MESSAGE_KEY"] as const,
  optional: [
    "NODE_ENV",
    "ADMIN_ORIGIN",
    "EMAIL_FROM",
    "RESEND_API_KEY",
    "MAILPIT_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MEDIA_SCANNER_URL",
    "MEDIA_SCANNER_TOKEN",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "TRUSTED_CLIENT_IP_HEADER",
    "ADMIN_NO_AUTH",
  ] as const,
};
// Celld RPC returns plain values. Keep its structural client surface explicit;
// Cloudflare's promise-pipelining conditional types recurse through command payloads.
interface ObjectBinding<T> {
  getByName(name: string): T;
}
type RoomClient = Pick<
  Room,
  | "initialize"
  | "authorize"
  | "preview"
  | "hasParticipant"
  | "command"
  | "closeInternal"
  | "revokePair"
  | "revokeUser"
  | "evidence"
  | "scanAccess"
  | "fetch"
  | "deliver"
  | "sweep"
  | "flush"
>;
type AppClient = Pick<
  AppCoordinator,
  | "pictureScanAccess"
  | "ready"
  | "command"
  | "recoverRoom"
  | "reserveMatch"
  | "deliver"
  | "cleanup"
>;
type MatcherClient = Pick<
  Matcher,
  "match" | "cancel" | "cancelInternal" | "heartbeat" | "status"
>;
type UserClient = Pick<
  UserHub,
  "presence" | "setPresence" | "offline" | "notify" | "limit" | "fetch"
>;
type DiscoveryClient = Pick<Discovery, "notify" | "fetch">;
type RateClient = Pick<RateLimiter, "limit">;
export interface Env {
  WEB_ORIGIN: string;
  ADMIN_ORIGIN?: string;
  MESSAGE_KEY: string;
  NODE_ENV?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  MAILPIT_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MEDIA_SCANNER_URL?: string;
  MEDIA_SCANNER_TOKEN?: string;
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  TRUSTED_CLIENT_IP_HEADER?: string;
  ADMIN_NO_AUTH?: string;
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS: Queue<Job>;
  ROOM: ObjectBinding<RoomClient>;
  APP: ObjectBinding<AppClient>;
  MATCHER: ObjectBinding<MatcherClient>;
  USER_HUB: ObjectBinding<UserClient>;
  DISCOVERY: ObjectBinding<DiscoveryClient>;
  RATE_LIMITER: ObjectBinding<RateClient>;
}
export type Job = { source: "room" | "app"; id: string; operationId: string };
