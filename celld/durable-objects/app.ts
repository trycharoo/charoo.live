import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import {
  guestSchema,
  emailSchema,
  profileSchema,
  roomSchema,
  requestSchema,
  settingsSchema,
} from "@charoo/contracts";
import {
  all,
  first,
  run,
  stmt,
  iso,
  user,
  authenticate,
  account,
  emptyProfile,
  settings,
  blocked,
  roomStub,
  publicUser,
  audit,
  type Actor,
  type RoomRecord,
} from "../shared/data";
import { token, hash, encrypt, decrypt } from "../shared/crypto";
import { requireThat, result, unwrap, type Result } from "../shared/errors";
import { ensureSchema } from "../shared/migrations";
import type { GoogleIdentity } from "../features/auth/google";

export class AppCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => ensureSchema(env));
  }
  async ready() {
    return true;
  }
  async command(
    actor: Actor | null,
    kind: string,
    input: any,
  ): Promise<Result<any>> {
    return this.ctx.blockConcurrencyWhile(() =>
      result(async () => {
        const env = this.env;
        const u =
          actor && kind !== "verify" ? await authenticate(env, actor) : null;
        switch (kind) {
          case "guest": {
            guestSchema.parse(input);
            requireThat(
              (await settings(env)).guest_access_enabled,
              403,
              "Guest access is disabled",
            );
            if (u)
              return {
                user: publicUser(u),
                csrf: (await first(
                  env,
                  "SELECT csrf FROM sessions WHERE token_hash=?",
                  [actor!.sessionHash],
                ))!.csrf,
              };
            const id = crypto.randomUUID(),
              name = `Guest ${token().slice(0, 4)}`;
            await run(
              env,
              "INSERT INTO users(id,display_name,profile,created_at,guest_expires_at) VALUES(?,?,?,?,?)",
              [
                id,
                name,
                JSON.stringify(emptyProfile(name)),
                iso(),
                iso(Date.now() + 604800000),
              ],
            );
            return this.issue(id);
          }
          case "email": {
            const b = emailSchema.parse(input);
            const id = u?.id || crypto.randomUUID();
            if (!u)
              await run(
                env,
                "INSERT INTO users(id,display_name,profile,created_at,guest_expires_at) VALUES(?,?,?,?,?)",
                [
                  id,
                  "New friend",
                  JSON.stringify(emptyProfile("New friend")),
                  iso(),
                  iso(Date.now() + 604800000),
                ],
              );
            const t = token();
            await run(
              env,
              "INSERT INTO email_tokens(token_hash,email,user_id,expires_at,room_token) VALUES(?,?,?,?,?)",
              [
                await hash(t),
                b.email.toLowerCase(),
                id,
                iso(Date.now() + 900000),
                b.roomToken || null,
              ],
            );
            return {
              email: b.email.toLowerCase(),
              token: t,
              roomToken: b.roomToken,
            };
          }
          case "verify": {
            const th = await hash(input.token);
            const v = await first(
              env,
              "SELECT * FROM email_tokens WHERE token_hash=? AND expires_at>?",
              [th, iso()],
            );
            requireThat(v, 400, "This link is invalid or expired");
            const existing = await first(
              env,
              "SELECT * FROM users WHERE email=?",
              [v.email],
            );
            // A valid one-use email credential may upgrade an expired guest.
            // Bans and suspensions still apply before issuing a new session.
            const current = await user(env, v.user_id, {
              allowExpiredGuest: true,
            });
            if (!existing && current.verified)
              requireThat(
                current.email === v.email,
                409,
                "Sign out before verifying a different email",
              );
            const id = existing?.id || v.user_id;
            await user(env, id, { allowExpiredGuest: !existing });
            const t = token(),
              csrf = token(),
              sh = await hash(t);
            const writes = [
              stmt(env, "DELETE FROM email_tokens WHERE token_hash=?", [th]),
            ];
            if (!existing && !current.verified)
              writes.push(
                stmt(
                  env,
                  "UPDATE users SET email=?,verified=1,guest_expires_at=NULL WHERE id=?",
                  [v.email, id],
                ),
                stmt(env, "DELETE FROM sessions WHERE user_id=?", [id]),
              );
            if (actor)
              writes.push(
                stmt(env, "DELETE FROM sessions WHERE token_hash=?", [
                  actor.sessionHash,
                ]),
              );
            writes.push(
              stmt(
                env,
                "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
                [sh, id, csrf, iso(Date.now() + 604800000)],
              ),
            );
            await env.DB.batch(writes);
            return { user: publicUser(await user(env, id)), csrf, token: t };
          }
          case "oauth.start": {
            if (input.oldBrowserHash)
              await run(env, "DELETE FROM oauth_flows WHERE browser_hash=?", [
                input.oldBrowserHash,
              ]);
            await run(
              env,
              "INSERT INTO oauth_flows(state_hash,browser_hash,nonce,code_verifier,session_hash,user_id,room_token,create_room,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
              [
                input.stateHash,
                input.browserHash,
                input.nonce,
                input.codeVerifier,
                actor?.sessionHash || null,
                u?.id || null,
                input.roomToken || null,
                input.createRoom ? 1 : 0,
                iso(Date.now() + 600000),
              ],
            );
            return null;
          }
          case "oauth.consume": {
            const flow = await first(
              env,
              "DELETE FROM oauth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *",
              [input.stateHash, input.browserHash, iso()],
            );
            requireThat(flow, 400, "Google sign-in expired");
            return flow;
          }
          case "oauth.finish": {
            const identity = input.identity as GoogleIdentity;
            requireThat(
              (actor?.sessionHash || null) === input.sessionHash,
              409,
              "session_changed",
            );
            const linked = await first(
              env,
              "SELECT user_id FROM oauth_identities WHERE provider='google' AND subject=?",
              [identity.subject],
            );
            let id: string;
            if (linked) {
              requireThat(
                !u?.verified || u.id === linked.user_id,
                409,
                "account_conflict",
              );
              id = linked.user_id;
              await user(env, id);
            } else {
              requireThat(
                !u?.verified || u.email === identity.email,
                409,
                "account_conflict",
              );
              requireThat(
                identity.emailAuthoritative ||
                  (u?.verified && u.email === identity.email),
                403,
                "email_required",
              );
              const existing = await first(
                env,
                "SELECT * FROM users WHERE email=?",
                [identity.email],
              );
              id = existing?.id || u?.id || crypto.randomUUID();
              requireThat(
                !(await first(
                  env,
                  "SELECT 1 FROM oauth_identities WHERE provider='google' AND user_id=?",
                  [id],
                )),
                409,
                "account_conflict",
              );
              if (existing) await user(env, id);
              const writes = [];
              if (!existing && u)
                writes.push(
                  stmt(
                    env,
                    "UPDATE users SET email=?,verified=1,guest_expires_at=NULL WHERE id=?",
                    [identity.email, id],
                  ),
                  stmt(env, "DELETE FROM sessions WHERE user_id=?", [id]),
                );
              else if (!existing)
                writes.push(
                  stmt(
                    env,
                    "INSERT INTO users(id,email,verified,display_name,profile,created_at) VALUES(?,?,1,?,?,?)",
                    [
                      id,
                      identity.email,
                      identity.name,
                      JSON.stringify(emptyProfile(identity.name)),
                      iso(),
                    ],
                  ),
                );
              writes.push(
                stmt(
                  env,
                  "INSERT INTO oauth_identities(provider,subject,user_id) VALUES('google',?,?)",
                  [identity.subject, id],
                ),
              );
              await env.DB.batch(writes);
            }
            if (actor)
              await run(env, "DELETE FROM sessions WHERE token_hash=?", [
                actor.sessionHash,
              ]);
            return this.issue(id);
          }
          case "logout": {
            requireThat(u, 401, "Sign in to continue");
            await this.effect(
              "user.revoke",
              { userId: u.id, sessionHash: actor!.sessionHash },
              [
                stmt(env, "DELETE FROM sessions WHERE token_hash=?", [
                  actor!.sessionHash,
                ]),
              ],
            );
            return null;
          }
          case "profile": {
            requireThat(u, 401, "Sign in to continue");
            const p = profileSchema.parse(input);
            await run(
              env,
              "UPDATE users SET display_name=?,profile=? WHERE id=?",
              [p.displayName, JSON.stringify(p), u.id],
            );
            return publicUser(await user(env, u.id));
          }
          case "room.create": {
            requireThat(u, 401, "Sign in to continue");
            const b = roomSchema.parse(input);
            const cfg = await settings(env);
            const operationId = b.clientOperationId
              ? `create:${u.id}:${b.clientOperationId}`
              : undefined;
            const previous = operationId
              ? await first(env, "SELECT payload FROM operations WHERE id=?", [
                  operationId,
                ])
              : null;
            if (previous) {
              const saved = JSON.parse(previous.payload);
              requireThat(!saved.purged, 410, "This conversation has ended");
              await this.deliverInternal(operationId!);
              unwrap(await roomStub(env, saved.record.id).authorize(actor!));
              return {
                id: saved.record.id,
                shareUrl: saved.invite
                  ? `${env.WEB_ORIGIN}/#room=${await decrypt(saved.invite.ciphertext, env.MESSAGE_KEY, `room-invite:${saved.record.id}`)}`
                  : null,
              };
            }

            if (b.type === "AVAILABLE_TONIGHT") {
              requireThat(
                u.verified,
                403,
                "Verify your email to use Available Tonight",
              );
              const count = await first(
                env,
                "SELECT count(*) AS n FROM room_index WHERE creator_id=? AND type='AVAILABLE_TONIGHT' AND state='OPEN' AND expires_at>?",
                [u.id, iso()],
              );
              const pending = await first(
                env,
                "SELECT count(*) AS n FROM operations WHERE state='PENDING' AND json_extract(payload,'$.record.creator_id')=? AND json_extract(payload,'$.record.type')='AVAILABLE_TONIGHT'",
                [u.id],
              );
              requireThat(
                count!.n + pending!.n < cfg.available_room_creation_limit,
                429,
                "Close an active room before creating another",
              );
            } else
              requireThat(
                u.verified || cfg.guest_access_enabled,
                403,
                "Guest rooms disabled",
              );
            const id = crypto.randomUUID(),
              link = b.type === "SHARED_GROUP" ? token() : null;
            const hours = Math.min(
              b.durationHours || 24,
              b.type === "AVAILABLE_TONIGHT"
                ? cfg.available_room_retention_hours
                : cfg.shared_room_retention_hours,
            );
            const record = this.roomRecord(id, b.type, u.id, {
              title: b.title,
              description: b.description,
              category: b.category,
              region: b.region,
              tags: b.tags,
              verified_only: b.type === "AVAILABLE_TONIGHT" || b.verifiedOnly,
              slow_mode: cfg.available_room_slow_mode,
              expires_at: iso(Date.now() + hours * 3600000),
            });
            const invite = link
              ? {
                  hash: await hash(link),
                  ciphertext: await encrypt(
                    link,
                    env.MESSAGE_KEY,
                    `room-invite:${id}`,
                  ),
                }
              : null;
            await this.create(record, [u.id], invite, operationId);
            return {
              id,
              shareUrl: link ? `${env.WEB_ORIGIN}/#room=${link}` : null,
            };
          }
          case "social.create": {
            requireThat(u?.verified, 403, "Verify your email first");
            const b = requestSchema.parse(input);
            const target = await user(env, b.targetId);
            requireThat(
              target.verified && target.id !== u.id,
              400,
              "Choose another verified user",
            );
            requireThat(
              !(await blocked(env, u.id, target.id)),
              403,
              "Request unavailable",
            );
            if (b.kind === "RECONNECT") {
              const [a, c] = [u.id, target.id].sort();
              requireThat(
                await first(
                  env,
                  "SELECT 1 FROM match_history WHERE user_a=? AND user_b=?",
                  [a, c],
                ),
                403,
                "No previous match",
              );
            } else {
              requireThat(b.roomId, 400, "A shared conversation is required");
              unwrap(await roomStub(env, b.roomId).authorize(actor!, false));
              unwrap(await roomStub(env, b.roomId).hasParticipant(target.id));
            }
            await run(
              env,
              "UPDATE social_requests SET state='REJECTED' WHERE state='PENDING' AND expires_at<=?",
              [iso()],
            );
            const previous = await first(
              env,
              "SELECT id FROM social_requests WHERE requester_id=? AND target_id=? AND kind=? AND state='PENDING'",
              [u.id, target.id, b.kind],
            );
            const id = previous?.id || crypto.randomUUID();
            await this.effect(
              "event",
              { type: "request", userIds: [target.id] },
              previous
                ? []
                : [
                    stmt(
                      env,
                      "INSERT INTO social_requests(id,requester_id,target_id,kind,source_room_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
                      [
                        id,
                        u.id,
                        target.id,
                        b.kind,
                        b.roomId || null,
                        iso(),
                        iso(Date.now() + 86400000),
                      ],
                    ),
                  ],
            );
            return { id };
          }
          case "social.respond": {
            requireThat(u?.verified, 403, "Verify your email first");
            const r = await first(
              env,
              "SELECT * FROM social_requests WHERE id=? AND target_id=?",
              [input.id, u.id],
            );
            requireThat(r && r.expires_at > iso(), 404, "Request unavailable");
            if (r.state === "ACCEPTED")
              return { roomId: r.result_room_id, requesterId: r.requester_id };
            requireThat(r.state === "PENDING", 404, "Request unavailable");
            await user(env, r.requester_id);
            requireThat(
              !(await blocked(env, u.id, r.requester_id)),
              403,
              "Request unavailable",
            );
            let roomId: string | null = null;
            if (input.accept) {
              const [a, b] = [u.id, r.requester_id].sort();
              const contact =
                r.kind === "CONTACT"
                  ? await first(
                      env,
                      "SELECT room_id FROM contacts WHERE user_a=? AND user_b=?",
                      [a, b],
                    )
                  : null;
              const op = await first(
                env,
                "SELECT payload FROM operations WHERE id=?",
                [`request:${r.id}`],
              );
              roomId =
                contact?.room_id ||
                (op ? JSON.parse(op.payload).record.id : crypto.randomUUID());
              if (!contact)
                await this.create(
                  this.roomRecord(
                    roomId!,
                    r.kind === "CONTACT" ? "CONTACT" : "PRIVATE",
                    r.requester_id,
                    { slow_mode: 1 },
                  ),
                  [u.id, r.requester_id],
                  null,
                  `request:${r.id}`,
                  {
                    requestId: r.id,
                    a,
                    b,
                    contact: r.kind === "CONTACT",
                    requesterId: r.requester_id,
                  },
                );
              const writes = [
                stmt(
                  env,
                  "UPDATE social_requests SET state='ACCEPTED',result_room_id=? WHERE id=? AND state='PENDING'",
                  [roomId, r.id],
                ),
              ];
              if (r.kind === "CONTACT")
                writes.push(
                  stmt(
                    env,
                    "INSERT INTO contacts(user_a,user_b,room_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
                    [a, b, roomId],
                  ),
                );
              await env.DB.batch(writes);
            } else
              await run(
                env,
                "UPDATE social_requests SET state='REJECTED' WHERE id=?",
                [r.id],
              );
            const outcome = { roomId, requesterId: r.requester_id };
            await this.enqueue("event", {
              type: "request.responded",
              userIds: [u.id, r.requester_id],
              payload: outcome,
            });
            return outcome;
          }
          case "contact.remove": {
            requireThat(u, 401, "Sign in to continue");
            const [a, b] = [u.id, input.targetId].sort();
            const c = await first(
              env,
              "SELECT room_id FROM contacts WHERE user_a=? AND user_b=?",
              [a, b],
            );
            if (c)
              await this.effect(
                "room.close",
                { roomId: c.room_id, actorId: u.id },
                [
                  stmt(
                    env,
                    "DELETE FROM contacts WHERE user_a=? AND user_b=?",
                    [a, b],
                  ),
                ],
              );
            return null;
          }
          case "block": {
            requireThat(u, 401, "Sign in to continue");
            requireThat(u.id !== input.targetId, 400, "Cannot block yourself");
            await user(env, input.targetId);
            const revokeId = crypto.randomUUID(),
              eventId = crypto.randomUUID();
            await env.DB.batch([
              stmt(
                env,
                "INSERT INTO blocks(user_id,target_id) VALUES(?,?) ON CONFLICT DO NOTHING",
                [u.id, input.targetId],
              ),
              stmt(
                env,
                "UPDATE social_requests SET state='REJECTED' WHERE state='PENDING' AND ((requester_id=? AND target_id=?) OR (requester_id=? AND target_id=?))",
                [u.id, input.targetId, input.targetId, u.id],
              ),
              this.effectStatement(revokeId, "pair.revoke", {
                a: u.id,
                b: input.targetId,
              }),
              this.effectStatement(eventId, "event", {
                type: "blocked",
                userIds: [u.id, input.targetId],
              }),
            ]);
            await this.ctx.storage.setAlarm(Date.now() + 1000);
            await this.deliverInternal(revokeId);
            await this.deliverInternal(eventId);
            return null;
          }
          case "unblock": {
            requireThat(u, 401, "Sign in to continue");
            await run(
              env,
              "DELETE FROM blocks WHERE user_id=? AND target_id=?",
              [u.id, input.targetId],
            );
            return null;
          }
          case "settings": {
            requireThat(u?.role === "ADMIN", 403, "Admin role required");
            const b = settingsSchema.parse(input);
            await env.DB.batch([
              stmt(env, "UPDATE settings SET value=? WHERE id=1", [
                JSON.stringify(b),
              ]),
              stmt(
                env,
                "INSERT INTO audit_logs(id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)",
                [
                  crypto.randomUUID(),
                  u.id,
                  "settings.update",
                  "settings",
                  "{}",
                  iso(),
                ],
              ),
            ]);
            return b;
          }
          case "admin.action": {
            requireThat(
              u && ["ADMIN", "MODERATOR"].includes(u.role),
              403,
              "Moderator role required",
            );
            if (input.action === "CLOSE_ROOM")
              await this.enqueue("room.close", {
                roomId: input.targetId,
                actorId: u.id,
              });
            else if (input.action === "RESOLVE_REPORT")
              await run(env, "UPDATE reports SET state='RESOLVED' WHERE id=?", [
                input.targetId,
              ]);
            else {
              requireThat(
                input.targetId !== u.id,
                400,
                "Cannot act on yourself",
              );
              const target = await first(
                env,
                "SELECT role FROM users WHERE id=?",
                [input.targetId],
              );
              requireThat(
                target?.role === "USER",
                403,
                "Staff accounts require an operator",
              );
              await this.effect("user.revoke", { userId: input.targetId }, [
                stmt(
                  env,
                  input.action === "BAN"
                    ? "UPDATE users SET banned=1 WHERE id=?"
                    : "UPDATE users SET suspended_until=? WHERE id=?",
                  input.action === "BAN"
                    ? [input.targetId]
                    : [iso(Date.now() + 86400000), input.targetId],
                ),
                stmt(env, "DELETE FROM sessions WHERE user_id=?", [
                  input.targetId,
                ]),
                stmt(
                  env,
                  "INSERT INTO audit_logs(id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?)",
                  [
                    crypto.randomUUID(),
                    u.id,
                    input.action.toLowerCase(),
                    input.targetId,
                    "{}",
                    iso(),
                  ],
                ),
              ]);
            }
            if (["CLOSE_ROOM", "RESOLVE_REPORT"].includes(input.action))
              await audit(
                env,
                u.id,
                input.action.toLowerCase(),
                input.targetId,
              );
            return null;
          }
          default:
            throw new Error("Unknown application command");
        }
      }),
    );
  }
  private async issue(id: string) {
    const t = token(),
      csrf = token();
    await run(
      this.env,
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
      [await hash(t), id, csrf, iso(Date.now() + 604800000)],
    );
    return { user: publicUser(await user(this.env, id)), csrf, token: t };
  }
  private roomRecord(
    id: string,
    type: RoomRecord["type"],
    creator: string,
    extra: any = {},
  ): RoomRecord {
    return {
      id,
      type,
      creator_id: creator,
      title: "Private conversation",
      description: "",
      category: "Conversation",
      region: "",
      tags: [],
      verified_only: false,
      slow_mode: 1,
      state: "OPEN",
      asl_revealed: false,
      created_at: iso(),
      last_activity: iso(),
      expires_at: null,
      closed_at: null,
      purge_at: null,
      version: 1,
      ...extra,
    };
  }
  private async create(
    record: RoomRecord,
    members: string[],
    invite: any,
    operationId = `room:${record.id}`,
    completion?: any,
  ) {
    const old = await first(
      this.env,
      "SELECT payload FROM operations WHERE id=?",
      [operationId],
    );
    const payload = old
      ? JSON.parse(old.payload)
      : { record, members, invite, completion };
    if (!old)
      await this.env.DB.batch([
        stmt(
          this.env,
          "INSERT INTO operations(id,kind,payload,created_at) VALUES(?,?,?,?)",
          [operationId, "room.initialize", JSON.stringify(payload), iso()],
        ),
        stmt(
          this.env,
          "INSERT INTO app_outbox(id,kind,payload,created_at) VALUES(?,?,?,?)",
          [operationId, "room.initialize", JSON.stringify(payload), iso()],
        ),
      ]);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.deliverInternal(operationId);
  }
  async recoverRoom(id: string) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const r = await first(
        this.env,
        "SELECT id FROM operations WHERE json_extract(payload,'$.record.id')=? AND state='PENDING'",
        [id],
      );
      if (r) await this.deliverInternal(r.id);
    });
  }
  async reserveMatch(a: string, b: string) {
    return this.ctx.blockConcurrencyWhile(() =>
      result(async () => {
        const env = this.env,
          cfg = await settings(env);
        const ua = await user(env, a),
          ub = await user(env, b);
        requireThat(
          a !== b &&
            (ua.verified || cfg.guest_access_enabled) &&
            (ub.verified || cfg.guest_access_enabled),
          403,
          "Match unavailable",
        );
        requireThat(!(await blocked(env, a, b)), 403, "Match unavailable");
        requireThat(
          (await env.USER_HUB.getByName(a).presence()).status !== "Offline" &&
            (await env.USER_HUB.getByName(b).presence()).status !== "Offline",
          409,
          "Match unavailable",
        );
        const existing = await first(
          env,
          "SELECT room_id FROM active_matches WHERE user_id IN (?,?)",
          [a, b],
        );
        requireThat(!existing, 409, "Already matched");
        const [x, y] = [a, b].sort();
        requireThat(
          !(await first(
            env,
            "SELECT 1 FROM match_history WHERE user_a=? AND user_b=? AND matched_at>?",
            [x, y, iso(Date.now() - 1800000)],
          )),
          409,
          "Recent match",
        );
        const id = crypto.randomUUID(),
          record = this.roomRecord(id, "STRANGER", a),
          op = `match:${id}`,
          payload = { record, members: [a, b], invite: null, matched: true };
        await env.DB.batch([
          stmt(
            env,
            "INSERT INTO active_matches(user_id,room_id) VALUES(?,?),(?,?)",
            [a, id, b, id],
          ),
          stmt(
            env,
            "INSERT INTO operations(id,kind,payload,created_at) VALUES(?,?,?,?)",
            [op, "room.initialize", JSON.stringify(payload), iso()],
          ),
          stmt(
            env,
            "INSERT INTO app_outbox(id,kind,payload,created_at) VALUES(?,?,?,?)",
            [op, "room.initialize", JSON.stringify(payload), iso()],
          ),
          stmt(
            env,
            "INSERT INTO match_history(user_a,user_b,room_id,matched_at) VALUES(?,?,?,?) ON CONFLICT(user_a,user_b) DO UPDATE SET room_id=excluded.room_id,matched_at=excluded.matched_at",
            [x, y, id, iso()],
          ),
        ]);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        await this.deliverInternal(op);
        return { roomId: id };
      }),
    );
  }
  private effectStatement(id: string, kind: string, payload: any) {
    return stmt(
      this.env,
      "INSERT INTO app_outbox(id,kind,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
      [id, kind, JSON.stringify(payload), iso()],
    );
  }
  private async effect(
    kind: string,
    payload: any,
    writes: D1PreparedStatement[] = [],
    id = crypto.randomUUID(),
  ) {
    await this.env.DB.batch([
      ...writes,
      this.effectStatement(id, kind, payload),
    ]);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    await this.deliverInternal(id);
  }
  private async enqueue(kind: string, payload: any) {
    await this.effect(kind, payload);
  }

  async deliver(id: string) {
    await this.ctx.blockConcurrencyWhile(() => this.deliverInternal(id));
  }
  private async deliverInternal(id: string) {
    const item = await first(this.env, "SELECT * FROM app_outbox WHERE id=?", [
      id,
    ]);
    if (!item) return;
    const b = JSON.parse(item.payload),
      env = this.env;
    switch (item.kind) {
      case "room.initialize": {
        await roomStub(env, b.record.id).initialize(
          b.record,
          b.members,
          b.invite,
        );
        const writes = [
          stmt(env, "UPDATE operations SET state='DONE' WHERE id=?", [id]),
        ];
        if (b.completion) {
          const c = b.completion;
          writes.push(
            stmt(
              env,
              "UPDATE social_requests SET state='ACCEPTED',result_room_id=? WHERE id=? AND state='PENDING'",
              [b.record.id, c.requestId],
            ),
          );
          if (c.contact)
            writes.push(
              stmt(
                env,
                "INSERT INTO contacts(user_a,user_b,room_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
                [c.a, c.b, b.record.id],
              ),
            );
          writes.push(
            this.effectStatement(`request-event:${c.requestId}`, "event", {
              type: "request.responded",
              userIds: b.members,
              payload: { roomId: b.record.id, requesterId: c.requesterId },
            }),
          );
        }
        if (b.matched)
          writes.push(
            this.effectStatement(`match-event:${b.record.id}`, "event", {
              type: "matched",
              userIds: b.members,
              payload: { roomId: b.record.id },
            }),
          );
        writes.push(stmt(env, "DELETE FROM app_outbox WHERE id=?", [id]));
        await env.DB.batch(writes);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return;
      }
      case "room.close":
        await roomStub(env, b.roomId).closeInternal(b.actorId);
        break;
      case "event":
        for (const uid of b.userIds || [])
          await env.USER_HUB.getByName(uid).notify(b);
        break;
      case "pair.revoke": {
        for (const r of await all(
          env,
          "SELECT room_id FROM membership_index WHERE user_id=? AND room_id IN (SELECT room_id FROM membership_index WHERE user_id=?)",
          [b.a, b.b],
        ))
          await roomStub(env, r.room_id).revokePair(b.a, b.b);
        break;
      }
      case "user.revoke": {
        await env.USER_HUB.getByName(b.userId).offline(b.sessionHash);
        await env.MATCHER.getByName("charoo").cancelInternal(b.userId);
        for (const r of await all(
          env,
          "SELECT room_id FROM membership_index WHERE user_id=?",
          [b.userId],
        ))
          await roomStub(env, r.room_id).revokeUser(b.userId, b.sessionHash);
        break;
      }
    }
    await run(env, "DELETE FROM app_outbox WHERE id=?", [id]);
  }
  async alarm() {
    for (const r of await all(
      this.env,
      "SELECT id FROM app_outbox ORDER BY created_at LIMIT 50",
    ))
      try {
        await this.env.JOBS.send({
          source: "app",
          id: "charoo",
          operationId: r.id,
        });
      } catch {}
    if (await first(this.env, "SELECT 1 FROM app_outbox LIMIT 1"))
      await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async cleanup() {
    const env = this.env;
    await this.ctx.blockConcurrencyWhile(async () => {
      await env.DB.batch([
        stmt(env, "DELETE FROM sessions WHERE expires_at<=?", [iso()]),
        stmt(env, "DELETE FROM email_tokens WHERE expires_at<=?", [iso()]),
        stmt(env, "DELETE FROM oauth_flows WHERE expires_at<=?", [iso()]),
        stmt(
          env,
          "UPDATE social_requests SET state='REJECTED' WHERE state='PENDING' AND expires_at<=? AND NOT EXISTS(SELECT 1 FROM operations WHERE id='request:'||social_requests.id AND state='PENDING')",
          [iso()],
        ),
      ]);
      const expired = await all(
        env,
        "SELECT u.id FROM users u WHERE verified=0 AND guest_expires_at<=? AND NOT EXISTS(SELECT 1 FROM room_index r WHERE r.creator_id=u.id) AND NOT EXISTS(SELECT 1 FROM membership_index p WHERE p.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM operations o,json_each(o.payload,'$.members') m WHERE o.state='PENDING' AND m.value=u.id) LIMIT 50",
        [iso()],
      );
      for (const g of expired)
        await env.DB.batch([
          stmt(env, "UPDATE reports SET reporter_id=NULL WHERE reporter_id=?", [
            g.id,
          ]),
          stmt(env, "UPDATE reports SET target_id=NULL WHERE target_id=?", [
            g.id,
          ]),
          stmt(env, "UPDATE audit_logs SET actor_id=NULL WHERE actor_id=?", [
            g.id,
          ]),
          stmt(env, "DELETE FROM blocks WHERE user_id=? OR target_id=?", [
            g.id,
            g.id,
          ]),
          stmt(env, "DELETE FROM match_history WHERE user_a=? OR user_b=?", [
            g.id,
            g.id,
          ]),
          stmt(
            env,
            "DELETE FROM social_requests WHERE requester_id=? OR target_id=?",
            [g.id, g.id],
          ),
          stmt(env, "DELETE FROM contacts WHERE user_a=? OR user_b=?", [
            g.id,
            g.id,
          ]),
          stmt(env, "DELETE FROM sessions WHERE user_id=?", [g.id]),
          stmt(env, "DELETE FROM email_tokens WHERE user_id=?", [g.id]),
          stmt(env, "DELETE FROM users WHERE id=? AND verified=0", [g.id]),
          this.effectStatement(`guest-expired:${g.id}`, "user.revoke", {
            userId: g.id,
          }),
        ]);
    });
    for (const r of await all(
      env,
      "SELECT id FROM room_index WHERE (state='OPEN' AND expires_at<=?) OR (state='CLOSED' AND purge_at<=?) LIMIT 100",
      [iso(), iso()],
    ))
      await roomStub(env, r.id).sweep();
    await this.alarm();
  }
}
