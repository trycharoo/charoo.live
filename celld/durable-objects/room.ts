import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { messageSchema, z } from "@charoo/contracts";
import {
  all,
  first,
  stmt,
  iso,
  authenticate,
  user,
  settings,
  blocked,
  eligible,
  hub,
  cursor,
  parseCursor,
  type Actor,
  type RoomRecord,
} from "../shared/data";
import { encrypt, decrypt, fingerprint, meaningful } from "../shared/crypto";
import { requireThat, result, type Result } from "../shared/errors";
import { sendSocket, closeSocket } from "../shared/sockets";
import { endCall } from "../features/providers/livekit";
type Participant = {
  user_id: string;
  state: "JOINED" | "LEFT" | "REMOVED";
  joined_at: string;
  muted_until: string | null;
  meaningful_count: number;
  last_qualifying_at: string | null;
  last_message_at: string | null;
  read_at: string | null;
  presence_until: number;
};
type Attachment = {
  id: string;
  room_id: string;
  uploader_id: string;
  name: string;
  mime: string;
  size: number;
  state: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  object_key: string;
  keys: string[];
  uploaded: boolean;
  uploadAttempt?: string;
  scanAttempt?: string;
  scanUntil?: number;
  scanActor?: Actor;
  approved_key?: string;
};
type Call = {
  id: string;
  room_id: string;
  caller_id: string;
  target_id: string;
  state: "RINGING" | "ACCEPTED" | "ENDED";
  created_at: string;
  expires_at: string;
  media_terminated: boolean;
};
type SocketState = { actor: Actor };
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS charoo_meta(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS charoo_participants(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS charoo_messages(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL,client_message_id TEXT NOT NULL,ciphertext TEXT NOT NULL,reply_to TEXT,attachment_id TEXT,created_at TEXT NOT NULL,UNIQUE(sender_id,client_message_id));
   CREATE INDEX IF NOT EXISTS charoo_messages_history ON charoo_messages(created_at DESC,id DESC);
   CREATE TABLE IF NOT EXISTS charoo_reactions(message_id TEXT NOT NULL,user_id TEXT NOT NULL,emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
   CREATE TABLE IF NOT EXISTS charoo_fingerprints(user_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(user_id,fingerprint));
   CREATE TABLE IF NOT EXISTS charoo_attachments(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS charoo_calls(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS charoo_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL);`);
  }
  private rows<T = any>(sql: string, ...params: any[]): T[] {
    return this.ctx.storage.sql.exec(sql, ...params).toArray() as T[];
  }
  private meta(): RoomRecord & {
    invite?: { hash: string; ciphertext: string };
    purged?: boolean;
  } {
    const r = this.rows("SELECT data FROM charoo_meta WHERE id=1")[0];
    requireThat(r, 404, "Conversation unavailable");
    return JSON.parse(r.data);
  }
  private save(r: RoomRecord) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_meta(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      JSON.stringify(r),
    );
  }
  private participant(id: string): Participant | undefined {
    const r = this.rows(
      "SELECT data FROM charoo_participants WHERE user_id=?",
      id,
    )[0];
    return r ? JSON.parse(r.data) : undefined;
  }
  private people(): Participant[] {
    return this.rows("SELECT data FROM charoo_participants").map((r) =>
      JSON.parse(r.data),
    );
  }
  private saveParticipant(p: Participant) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_participants(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      p.user_id,
      JSON.stringify(p),
    );
  }
  private add(id: string) {
    this.saveParticipant({
      user_id: id,
      state: "JOINED",
      joined_at: iso(),
      muted_until: null,
      meaningful_count: 0,
      last_qualifying_at: null,
      last_message_at: null,
      read_at: null,
      presence_until: Date.now() + 90000,
    });
  }
  private open(r = this.meta()) {
    requireThat(
      !r.purged &&
        r.state === "OPEN" &&
        (!r.expires_at || Date.parse(r.expires_at) > Date.now()),
      410,
      "This conversation has ended",
    );
  }
  private membership(id: string, write = false) {
    const r = this.meta(),
      p = this.participant(id);
    requireThat(p?.state === "JOINED", 404, "Conversation unavailable");
    this.open(r);
    if (write)
      requireThat(
        !p.muted_until || Date.parse(p.muted_until) <= Date.now(),
        403,
        "You are muted in this room",
      );
    return r;
  }
  private event(type: string, payload?: unknown, userIds?: string[]) {
    this.outbox("event", {
      type,
      roomId: this.meta().id,
      ...(payload === undefined ? {} : { payload }),
      ...(userIds ? { userIds } : {}),
    });
  }
  private outbox(kind: string, payload: any) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_outbox(id,kind,payload) VALUES(?,?,?)",
      crypto.randomUUID(),
      kind,
      JSON.stringify(payload),
    );
  }
  private changed() {
    const r = this.meta();
    r.version++;
    this.save(r);
    this.outbox("projection", {});
  }
  private async wake(retryDelay = 1000) {
    const r = this.meta(),
      cfg = await settings(this.env),
      due: number[] = [];
    if (r.state === "OPEN") {
      if (r.expires_at) due.push(Date.parse(r.expires_at));
      if (["STRANGER", "PRIVATE"].includes(r.type))
        due.push(
          Date.parse(r.last_activity) +
            cfg.conversation_retention_hours * 3600000,
        );
    }
    if (r.purge_at && !r.purged) due.push(Date.parse(r.purge_at));
    for (const a of this.attachments())
      if (a.state !== "APPROVED") due.push(Date.parse(a.created_at) + 3600000);
    for (const c of this.calls())
      if (c.state !== "ENDED") due.push(Date.parse(c.expires_at));
    if (this.rows("SELECT 1 FROM charoo_outbox LIMIT 1").length)
      due.push(Date.now() + retryDelay);
    if (this.ctx.getWebSockets().length) due.push(Date.now() + 30000);
    if (due.length)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 100, Math.min(...due)),
      );
    else await this.ctx.storage.deleteAlarm();
  }
  async initialize(
    record: RoomRecord,
    members: string[],
    invite: { hash: string; ciphertext: string } | null,
  ) {
    this.ctx.storage.transactionSync(() => {
      if (!this.rows("SELECT 1 FROM charoo_meta").length) {
        this.save({ ...record, ...(invite ? { invite } : {}) } as RoomRecord);
        members.forEach((id) => this.add(id));
        this.outbox("projection", {});
        this.event("room.changed");
      }
    });
    await this.wake();
    await this.flush();
    return this.meta().id;
  }
  async authorize(actor: Actor, write = false) {
    return result(async () => {
      const u = await authenticate(this.env, actor);
      const r = this.membership(u.id, write);
      if (["STRANGER", "PRIVATE", "CONTACT"].includes(r.type))
        for (const p of this.people())
          if (p.user_id !== u.id)
            requireThat(
              !(await blocked(this.env, u.id, p.user_id)),
              403,
              "Conversation unavailable",
            );
      if (["STRANGER", "PRIVATE"].includes(r.type))
        requireThat(
          Date.parse(this.meta().last_activity) +
            (await settings(this.env)).conversation_retention_hours * 3600000 >
            Date.now(),
          410,
          "This conversation has ended",
        );
      if (r.type === "AVAILABLE_TONIGHT") await eligible(this.env, u);
      this.membership(u.id, write);
      return r;
    });
  }
  async hasParticipant(id: string) {
    return result(() => {
      this.membership(id);
      return true;
    });
  }
  async sweep() {
    await this.alarm();
  }
  async preview(actor: Actor) {
    return result(async () => {
      const u = await authenticate(this.env, actor);
      await eligible(this.env, u);
      const r = this.meta();
      this.open(r);
      requireThat(
        r.type === "AVAILABLE_TONIGHT" &&
          !(await blocked(this.env, u.id, r.creator_id)),
        404,
        "Room unavailable",
      );
      this.open();
      const { invite, purged, ...safe } = this.meta();
      return {
        ...safe,
        online: this.people().filter(
          (p) => p.state === "JOINED" && p.presence_until > Date.now(),
        ).length,
      };
    });
  }
  private async permit(actor: Actor, write = false) {
    const a = await this.authorize(actor, write);
    if (!a.ok) requireThat(false, a.status, a.message);
    return a.value;
  }
  async command(
    actor: Actor,
    kind: string,
    input: any = {},
  ): Promise<Result<any>> {
    return result(async () => {
      const env = this.env;
      const u = await authenticate(env, actor);
      if (kind === "join") {
        const r = this.meta();
        this.open(r);
        const cfg = await settings(env);
        requireThat(
          r.type === "AVAILABLE_TONIGHT" ||
            (r.type === "SHARED_GROUP" &&
              r.invite &&
              input.tokenHash === r.invite.hash),
          404,
          "Room unavailable",
        );
        if (r.type === "AVAILABLE_TONIGHT") await eligible(env, u);
        requireThat(
          !r.verified_only || u.verified,
          403,
          "Verify your email to join",
        );
        requireThat(
          !(await blocked(env, u.id, r.creator_id)),
          403,
          "Room unavailable",
        );
        requireThat(
          u.verified || cfg.guest_access_enabled,
          403,
          "Guest access disabled",
        );
        this.ctx.storage.transactionSync(() => {
          this.open();
          const p = this.participant(u.id);
          requireThat(
            p?.state !== "REMOVED",
            403,
            "You were removed from this room",
          );
          if (p) {
            p.state = "JOINED";
            p.presence_until = Date.now() + 90000;
            this.saveParticipant(p);
          } else this.add(u.id);
          this.changed();
          this.event("room.changed");
        });
        await this.wake();
        await this.flush();
        return { id: r.id };
      }
      const write = [
        "message",
        "reaction",
        "attachment.init",
        "attachment.upload.begin",
        "attachment.upload.finish",
        "attachment.scan.begin",
        "attachment.scan.finish",
        "attachment.scan.abort",
      ].includes(kind);
      const room = await this.permit(actor, write);
      switch (kind) {
        case "snapshot":
          return this.snapshot(actor);
        case "messages":
          return this.messages(actor, input.before);
        case "call.list": {
          const calls = [];
          for (const c of this.calls())
            if (
              c.state !== "ENDED" &&
              c.expires_at > iso() &&
              [c.caller_id, c.target_id].includes(u.id)
            )
              calls.push({
                ...c,
                display_name: (await user(env, c.caller_id)).display_name,
              });
          return calls;
        }
        case "message": {
          const b = messageSchema.parse(input),
            sealed = await encrypt(b.text, env.MESSAGE_KEY, room.id),
            fp = await fingerprint(b.text, env.MESSAGE_KEY, room.id),
            cfg = await settings(env);
          const outcome = this.ctx.storage.transactionSync(() => {
            const r = this.membership(u.id, true);
            const old = this.rows(
              "SELECT id FROM charoo_messages WHERE sender_id=? AND client_message_id=?",
              u.id,
              b.clientMessageId,
            )[0];
            if (old) return { id: old.id as string, duplicate: true };
            const p = this.participant(u.id)!;
            requireThat(
              !p.last_message_at ||
                Date.now() - Date.parse(p.last_message_at) >=
                  r.slow_mode * 1000,
              429,
              "Slow mode: wait before sending again",
            );
            if (b.replyTo)
              requireThat(
                this.rows("SELECT 1 FROM charoo_messages WHERE id=?", b.replyTo)
                  .length,
                400,
                "Reply target unavailable",
              );
            if (b.attachmentId) {
              const a = this.attachment(b.attachmentId);
              requireThat(
                a?.state === "APPROVED" && a.uploader_id === u.id,
                400,
                "Attachment unavailable",
              );
            }
            const id = crypto.randomUUID(),
              at = iso();
            this.ctx.storage.sql.exec(
              "INSERT INTO charoo_messages(id,sender_id,client_message_id,ciphertext,reply_to,attachment_id,created_at) VALUES(?,?,?,?,?,?,?)",
              id,
              u.id,
              b.clientMessageId,
              sealed,
              b.replyTo || null,
              b.attachmentId || null,
              at,
            );
            if (
              meaningful(b.text, p.last_qualifying_at) &&
              !this.rows(
                "SELECT 1 FROM charoo_fingerprints WHERE user_id=? AND fingerprint=?",
                u.id,
                fp,
              ).length
            ) {
              this.ctx.storage.sql.exec(
                "INSERT INTO charoo_fingerprints(user_id,fingerprint) VALUES(?,?)",
                u.id,
                fp,
              );
              p.meaningful_count++;
              p.last_qualifying_at = at;
            }
            p.last_message_at = at;
            this.saveParticipant(p);
            r.last_activity = at;
            if (r.type === "STRANGER" && !r.asl_revealed) {
              const counts = this.people().map((v) => v.meaningful_count);
              if (
                counts.length === 2 &&
                counts.every((n) => n >= cfg.minimum_messages_per_user) &&
                counts.reduce((a, b) => a + b, 0) >= cfg.asl_reveal_threshold &&
                Date.now() - Date.parse(r.created_at) >=
                  cfg.asl_minimum_duration_seconds * 1000
              )
                r.asl_revealed = true;
            }
            this.save(r);
            this.changed();
            this.event("message", { id });
            return { id, duplicate: false };
          });
          await this.wake();
          await this.flush();
          return outcome;
        }
        case "read":
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id);
            const p = this.participant(u.id)!;
            p.read_at = iso();
            this.saveParticipant(p);
            this.event("read", { userId: u.id });
          });
          break;
        case "reaction":
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id, true);
            requireThat(
              this.rows(
                "SELECT 1 FROM charoo_messages WHERE id=?",
                input.messageId,
              ).length,
              404,
              "Message unavailable",
            );
            this.ctx.storage.sql.exec(
              input.remove
                ? "DELETE FROM charoo_reactions WHERE message_id=? AND user_id=? AND emoji=?"
                : "INSERT INTO charoo_reactions(message_id,user_id,emoji) VALUES(?,?,?) ON CONFLICT DO NOTHING",
              input.messageId,
              u.id,
              input.emoji,
            );
            this.event("message");
          });
          break;
        case "presence": {
          const p = this.participant(u.id)!;
          p.presence_until = Date.now() + 90000;
          this.saveParticipant(p);
          return null;
        }
        case "leave": {
          if (["STRANGER", "PRIVATE"].includes(room.type))
            await this.closeInternal(u.id);
          else if (room.type !== "CONTACT")
            this.ctx.storage.transactionSync(() => {
              const p = this.participant(u.id)!;
              p.state = "LEFT";
              this.saveParticipant(p);
              this.changed();
              this.event("room.changed");
            });
          break;
        }
        case "edit": {
          requireThat(
            room.creator_id === u.id &&
              ["AVAILABLE_TONIGHT", "SHARED_GROUP"].includes(room.type),
            403,
            "Room owner required",
          );
          this.ctx.storage.transactionSync(() => {
            const r = this.membership(u.id);
            r.title = input.title;
            r.description = input.description;
            r.slow_mode = input.slowMode;
            this.save(r);
            this.changed();
            this.event("room.changed");
            this.outbox("audit", {
              actor: u.id,
              action: "room.edit",
              details: {},
            });
          });
          break;
        }
        case "moderate": {
          requireThat(
            room.creator_id === u.id &&
              ["AVAILABLE_TONIGHT", "SHARED_GROUP"].includes(room.type),
            403,
            "Room owner required",
          );
          if (input.action === "CLOSE") await this.closeInternal(u.id);
          else
            this.ctx.storage.transactionSync(() => {
              this.membership(u.id);
              requireThat(
                input.targetId && input.targetId !== u.id,
                400,
                "Choose another participant",
              );
              const p = this.participant(input.targetId);
              requireThat(
                p?.state === "JOINED",
                404,
                "Participant unavailable",
              );
              if (input.action === "REMOVE") p.state = "REMOVED";
              else p.muted_until = iso(Date.now() + 1800000);
              this.saveParticipant(p);
              this.changed();
              this.event("room.changed");
              this.outbox("audit", {
                actor: u.id,
                action: `room.${input.action.toLowerCase()}`,
                details: { targetId: input.targetId },
              });
            });
          break;
        }
        case "invite": {
          requireThat(
            room.type === "SHARED_GROUP" && room.creator_id === u.id,
            403,
            "Only the host can manage this room's invite link",
          );
          return { shareUrl: await this.inviteUrl() };
        }
        case "attachment.init": {
          const cfg = await settings(env);
          requireThat(
            env.MEDIA_SCANNER_URL && env.MEDIA_SCANNER_TOKEN,
            503,
            "Media scanning is not configured",
          );
          requireThat(
            input.size <= cfg.upload_size_limit_mb * 1048576,
            400,
            "File too large",
          );
          if (room.type === "AVAILABLE_TONIGHT")
            requireThat(
              cfg.available_room_media_enabled,
              403,
              "Media is disabled in public rooms",
            );
          const id = crypto.randomUUID(),
            a: Attachment = {
              ...input,
              id,
              room_id: room.id,
              uploader_id: u.id,
              state: "PENDING",
              created_at: iso(),
              object_key: "",
              keys: [],
              uploaded: false,
            };
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id, true);
            this.saveAttachment(a);
            this.changed();
          });
          await this.wake();
          await this.flush();
          return { id, url: `/api/media/${id}/upload` };
        }
        case "attachment.upload.begin": {
          const a = this.ownAttachment(input.id, u.id);
          requireThat(
            a.state === "PENDING" && !a.scanAttempt,
            409,
            "Attachment already processed",
          );
          const attempt = crypto.randomUUID();
          a.uploadAttempt = attempt;
          a.uploaded = false;
          a.object_key = `quarantine/${room.id}/${a.id}/${attempt}`;
          a.keys.push(a.object_key);
          this.saveAttachment(a);
          await this.wake();
          return { ...a, attempt };
        }
        case "attachment.upload.finish": {
          const a = this.ownAttachment(input.id, u.id);
          requireThat(
            a.state === "PENDING" &&
              !a.scanAttempt &&
              a.uploadAttempt === input.attempt,
            409,
            "Upload superseded",
          );
          a.uploaded = true;
          this.saveAttachment(a);
          return null;
        }
        case "attachment.scan.begin": {
          const a = this.ownAttachment(input.id, u.id);
          if (a.state === "APPROVED") return a;
          requireThat(
            a.state === "PENDING" && a.uploaded,
            409,
            "Attachment unavailable",
          );
          requireThat(
            !a.scanAttempt || (a.scanUntil || 0) < Date.now(),
            409,
            "Attachment is being scanned",
          );
          a.scanActor = actor;
          a.scanAttempt = crypto.randomUUID();
          a.scanUntil = Date.now() + 300000;
          a.approved_key = `approved/${room.id}/${a.id}/${a.scanAttempt}`;
          a.keys.push(a.approved_key);
          this.saveAttachment(a);
          await this.wake();
          return a;
        }
        case "attachment.scan.abort": {
          this.ctx.storage.transactionSync(() => {
            const a = this.ownAttachment(input.id, u.id);
            if (a.state === "PENDING" && a.scanAttempt === input.attempt) {
              if (a.approved_key)
                this.outbox("object.delete", { key: a.approved_key });
              delete a.scanAttempt;
              delete a.scanUntil;
              delete a.scanActor;
              delete a.approved_key;
              this.saveAttachment(a);
            }
          });
          break;
        }
        case "attachment.scan.finish": {
          const a = this.ownAttachment(input.id, u.id);
          requireThat(
            a.state === "PENDING" &&
              a.scanAttempt === input.attempt &&
              (a.scanUntil || 0) > Date.now(),
            409,
            "Scan expired",
          );
          a.state = input.approved ? "APPROVED" : "REJECTED";
          if (input.approved) {
            a.object_key = a.approved_key!;
            a.size = input.size;
          }
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id, true);
            this.saveAttachment(a);
            for (const key of a.keys)
              if (!input.approved || key !== a.object_key)
                this.outbox("object.delete", { key });
            this.changed();
          });
          await this.wake();
          await this.flush();
          requireThat(
            input.approved,
            400,
            "Attachment rejected by safety scanning",
          );
          return { id: a.id, state: a.state };
        }
        case "attachment.download": {
          const a = this.attachment(input.id);
          requireThat(a?.state === "APPROVED", 404, "Attachment unavailable");
          requireThat(
            !(await blocked(env, u.id, a.uploader_id)),
            403,
            "Attachment unavailable",
          );
          this.membership(u.id);
          return a;
        }
        case "call.create": {
          requireThat(
            (await settings(env)).video_enabled &&
              env.LIVEKIT_URL &&
              env.LIVEKIT_API_KEY &&
              env.LIVEKIT_API_SECRET,
            503,
            "Video calls are not configured",
          );
          requireThat(
            ["STRANGER", "PRIVATE", "CONTACT"].includes(room.type),
            403,
            "Video is available only in private conversations",
          );
          requireThat(
            input.targetId !== u.id,
            400,
            "Choose another participant",
          );
          await user(env, input.targetId);
          requireThat(
            !(await blocked(env, u.id, input.targetId)),
            403,
            "Conversation unavailable",
          );
          const c: Call = {
            id: crypto.randomUUID(),
            room_id: room.id,
            caller_id: u.id,
            target_id: input.targetId,
            state: "RINGING",
            created_at: iso(),
            expires_at: iso(Date.now() + 3600000),
            media_terminated: false,
          };
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id);
            this.membership(input.targetId);
            requireThat(
              !this.calls().some(
                (c) => c.state !== "ENDED" && c.expires_at > iso(),
              ),
              409,
              "This action already exists",
            );
            this.saveCall(c);
            this.changed();
            this.event("call.request", undefined, [u.id, c.target_id]);
          });
          await this.wake();
          await this.flush();
          return { id: c.id };
        }
        case "call.respond": {
          const c = this.call(input.id);
          requireThat(
            c?.target_id === u.id &&
              c.state === "RINGING" &&
              c.expires_at > iso(),
            404,
            "Call unavailable",
          );
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id);
            c.state = input.accept ? "ACCEPTED" : "ENDED";
            this.saveCall(c);
            this.changed();
            if (!input.accept) this.outbox("call.end", { id: c.id });
            this.event("call.changed", undefined, [c.caller_id, c.target_id]);
          });
          break;
        }
        case "call.token": {
          requireThat(
            (await settings(env)).video_enabled && env.LIVEKIT_API_KEY,
            503,
            "Video unavailable",
          );
          const c = this.call(input.id);
          requireThat(
            c?.state === "ACCEPTED" &&
              c.expires_at > iso() &&
              [c.caller_id, c.target_id].includes(u.id),
            403,
            "Both users must accept the call",
          );
          return c;
        }
        case "call.end": {
          const c = this.call(input.id);
          requireThat(
            c && [c.caller_id, c.target_id].includes(u.id),
            404,
            "Call unavailable",
          );
          this.ctx.storage.transactionSync(() => {
            this.membership(u.id);
            this.end(c);
            this.changed();
          });
          break;
        }
        case "report.check": {
          if (input.messageId)
            requireThat(
              this.rows(
                "SELECT 1 FROM charoo_messages WHERE id=?",
                input.messageId,
              ).length,
              404,
              "Message unavailable",
            );
          return true;
        }
        default:
          throw new Error("Unknown room command");
      }
      await this.wake();
      await this.flush();
      return null;
    });
  }
  private async inviteUrl() {
    const r = this.meta();
    return r.invite
      ? `${this.env.WEB_ORIGIN}/#room=${await decrypt(r.invite.ciphertext, this.env.MESSAGE_KEY, `room-invite:${r.id}`)}`
      : null;
  }
  private async snapshot(actor: Actor) {
    const r = await this.permit(actor),
      people = this.people()
        .filter((p) => p.state === "JOINED")
        .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
        .slice(0, 100),
      profiles = [];
    for (const p of people) {
      const raw = await first(this.env, "SELECT * FROM users WHERE id=?", [
        p.user_id,
      ]);
      if (!raw) continue;
      const u = { ...raw, profile: JSON.parse(raw.profile) };
      let visible =
        u.id === actor.userId || u.profile.aslVisibility === "public";
      if (u.profile.aslVisibility === "contacts_only") {
        const [a, b] = [u.id, actor.userId].sort();
        visible = !!(await first(
          this.env,
          "SELECT 1 FROM contacts WHERE user_a=? AND user_b=?",
          [a, b],
        ));
      }
      profiles.push({
        id: u.id,
        name: r.type === "STRANGER" ? "Stranger" : u.display_name,
        verified: !!u.verified,
        asl:
          (r.type !== "STRANGER" || r.asl_revealed) && visible
            ? {
                age: u.profile.age,
                gender: u.profile.gender,
                region: u.profile.region,
              }
            : null,
      });
    }
    await this.permit(actor);
    const { invite, purged, ...safe } = this.meta();
    return {
      ...safe,
      shareUrl:
        r.type === "SHARED_GROUP" && r.creator_id === actor.userId
          ? await this.inviteUrl()
          : undefined,
      online: this.people().filter(
        (p) => p.state === "JOINED" && p.presence_until > Date.now(),
      ).length,
      participants: profiles,
      aslProgress: people.map((p) => ({
        id: p.user_id,
        count: p.meaningful_count,
      })),
    };
  }
  private async messages(actor: Actor, before?: string) {
    const r = this.meta(),
      pos = parseCursor(before),
      rows = this.rows(
        "SELECT * FROM charoo_messages WHERE (? IS NULL OR (created_at,id)<(?,?)) ORDER BY created_at DESC,id DESC LIMIT 50",
        pos?.at || null,
        pos?.at || null,
        pos?.id || null,
      ),
      next = rows.length === 50 ? cursor(rows.at(-1)!) : null,
      resultRows = [];
    const reactions = this.rows("SELECT * FROM charoo_reactions"),
      readers = this.people();
    for (const m of rows.reverse()) {
      if (
        m.sender_id !== actor.userId &&
        (await blocked(this.env, actor.userId, m.sender_id))
      )
        continue;
      const sender = await first(
        this.env,
        "SELECT display_name FROM users WHERE id=?",
        [m.sender_id],
      );
      const grouped: Record<string, string[]> = {};
      for (const x of reactions)
        if (x.message_id === m.id) (grouped[x.emoji] ??= []).push(x.user_id);
      resultRows.push({
        id: m.id,
        roomId: r.id,
        senderId: m.sender_id,
        name:
          r.type === "STRANGER"
            ? "Stranger"
            : sender?.display_name || "Former member",
        text: await decrypt(m.ciphertext, this.env.MESSAGE_KEY, r.id),
        createdAt: m.created_at,
        clientMessageId: m.client_message_id,
        replyTo: m.reply_to,
        attachmentId: m.attachment_id,
        reactions: grouped,
        readBy: ["STRANGER", "PRIVATE", "CONTACT"].includes(r.type)
          ? readers
              .filter(
                (p) =>
                  p.user_id !== m.sender_id &&
                  p.read_at &&
                  p.read_at >= m.created_at,
              )
              .map((p) => p.user_id)
          : [],
      });
    }
    await this.permit(actor);
    return { messages: resultRows, next };
  }
  private attachments(): Attachment[] {
    return this.rows("SELECT data FROM charoo_attachments").map((r) =>
      JSON.parse(r.data),
    );
  }
  private attachment(id: string): Attachment | undefined {
    const r = this.rows(
      "SELECT data FROM charoo_attachments WHERE id=?",
      id,
    )[0];
    return r ? JSON.parse(r.data) : undefined;
  }
  private saveAttachment(a: Attachment) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_attachments(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      a.id,
      JSON.stringify(a),
    );
  }
  private ownAttachment(id: string, uid: string) {
    const a = this.attachment(id);
    requireThat(a?.uploader_id === uid, 404, "Attachment unavailable");
    return a;
  }
  private calls(): Call[] {
    return this.rows("SELECT data FROM charoo_calls").map((r) =>
      JSON.parse(r.data),
    );
  }
  private call(id: string): Call | undefined {
    return this.calls().find((c) => c.id === id);
  }
  private saveCall(c: Call) {
    this.ctx.storage.sql.exec(
      "INSERT INTO charoo_calls(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      c.id,
      JSON.stringify(c),
    );
  }
  private end(c: Call) {
    if (c.state !== "ENDED") {
      c.state = "ENDED";
      this.saveCall(c);
      this.outbox("call.end", { id: c.id });
      this.event("call.changed", undefined, [c.caller_id, c.target_id]);
    }
  }
  async closeInternal(actorId: string) {
    const cfg = await settings(this.env);
    this.ctx.storage.transactionSync(() => {
      const r = this.meta();
      if (r.state === "CLOSED") return;
      r.state = "CLOSED";
      r.closed_at = iso();
      r.purge_at = iso(Date.now() + cfg.conversation_retention_hours * 3600000);
      this.save(r);
      this.calls().forEach((c) => this.end(c));
      this.changed();
      this.event("room.closed");
      this.outbox("audit", {
        actor: actorId,
        action: "room.close",
        details: {},
      });
    });
    await this.wake();
    await this.flush();
  }
  async revokePair(a: string, b: string) {
    this.ctx.storage.transactionSync(() => {
      this.calls()
        .filter(
          (c) => [a, b].includes(c.caller_id) && [a, b].includes(c.target_id),
        )
        .forEach((c) => this.end(c));
      this.changed();
    });
    await this.wake();
    await this.flush();
  }
  async revokeUser(id: string, sessionHash?: string) {
    this.ctx.storage.transactionSync(() => {
      if (!sessionHash)
        this.calls()
          .filter((c) => [c.caller_id, c.target_id].includes(id))
          .forEach((c) => this.end(c));
      this.changed();
    });
    for (const ws of this.ctx.getWebSockets())
      if (
        (ws.deserializeAttachment() as SocketState).actor.userId === id &&
        (!sessionHash ||
          (ws.deserializeAttachment() as SocketState).actor.sessionHash ===
            sessionHash)
      )
        ws.close(4001, "Session unavailable");
    await this.wake();
    await this.flush();
  }
  async evidence(
    actor: Actor,
    reportId: string,
  ): Promise<
    Result<{ text: string | null; senderId?: string; createdAt?: string }>
  > {
    return result(async () => {
      const u = await authenticate(this.env, actor);
      requireThat(
        ["ADMIN", "MODERATOR"].includes(u.role),
        403,
        "Moderator role required",
      );
      const r = await first(
        this.env,
        "SELECT * FROM reports WHERE id=? AND room_id=?",
        [reportId, this.meta().id],
      );
      requireThat(r, 404, "Report unavailable");
      const m = this.rows(
        "SELECT * FROM charoo_messages WHERE id=?",
        r.message_id || "",
      )[0];
      return {
        text: m
          ? await decrypt(m.ciphertext, this.env.MESSAGE_KEY, this.meta().id)
          : null,
        senderId: m?.sender_id,
        createdAt: m?.created_at,
      };
    });
  }
  async scanAccess(id: string, attempt: string, operation: string) {
    return result(async () => {
      this.open();
      const a = this.attachment(id);
      requireThat(
        a?.state === "PENDING" &&
          a.scanAttempt === attempt &&
          (a.scanUntil || 0) > Date.now() &&
          a.scanActor,
        403,
        "Scan expired",
      );
      await this.permit(a.scanActor, true);
      const current = this.attachment(id);
      requireThat(
        current?.state === "PENDING" &&
          current.scanAttempt === attempt &&
          (current.scanUntil || 0) > Date.now(),
        403,
        "Scan expired",
      );
      return {
        key: operation === "read" ? current.object_key : current.approved_key!,
        mime: current.mime,
        size: current.size,
      };
    });
  }

  private async project() {
    const r = this.meta(),
      { invite, purged, ...safe } = r,
      env = this.env;
    if (purged) Object.assign(safe, { purged: true });
    const writes = [
      stmt(
        env,
        "INSERT INTO room_index(id,type,creator_id,state,created_at,last_activity,expires_at,purge_at,version,data) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,last_activity=excluded.last_activity,expires_at=excluded.expires_at,purge_at=excluded.purge_at,version=excluded.version,data=excluded.data WHERE excluded.version>room_index.version",
        [
          r.id,
          r.type,
          r.creator_id,
          r.state,
          r.created_at,
          r.last_activity,
          r.expires_at,
          purged ? null : r.purge_at,
          r.version,
          JSON.stringify({
            ...safe,
            searchFolded: {
              title: r.title.toLowerCase(),
              description: r.description.toLowerCase(),
              tags: JSON.stringify(r.tags).toLowerCase(),
            },
          }),
        ],
      ),
      stmt(
        env,
        "DELETE FROM membership_index WHERE room_id=? AND EXISTS(SELECT 1 FROM room_index WHERE id=? AND version=?)",
        [r.id, r.id, r.version],
      ),
      stmt(
        env,
        "DELETE FROM entity_index WHERE room_id=? AND EXISTS(SELECT 1 FROM room_index WHERE id=? AND version=?)",
        [r.id, r.id, r.version],
      ),
    ];
    if (!purged) {
      for (const p of this.people())
        writes.push(
          stmt(
            env,
            "INSERT INTO membership_index(room_id,user_id,state) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM room_index WHERE id=? AND version=?) ON CONFLICT(room_id,user_id) DO UPDATE SET state=excluded.state",
            [r.id, p.user_id, p.state, r.id, r.version],
          ),
        );
      for (const [kind, list] of [
        ["attachment", this.attachments()],
        ["call", this.calls()],
      ] as const)
        for (const e of list)
          writes.push(
            stmt(
              env,
              "INSERT INTO entity_index(id,room_id,kind,data) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM room_index WHERE id=? AND version=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
              [e.id, r.id, kind, JSON.stringify(e), r.id, r.version],
            ),
          );
      if (invite)
        writes.push(
          stmt(
            env,
            "INSERT INTO invite_index(token_hash,room_id) VALUES(?,?) ON CONFLICT DO NOTHING",
            [invite.hash, r.id],
          ),
        );
    } else
      writes.push(
        stmt(env, "DELETE FROM invite_index WHERE room_id=?", [r.id]),
        stmt(env, "DELETE FROM contacts WHERE room_id=?", [r.id]),
        stmt(
          env,
          "UPDATE social_requests SET source_room_id=NULL WHERE source_room_id=?",
          [r.id],
        ),
        stmt(
          env,
          "UPDATE social_requests SET result_room_id=NULL WHERE result_room_id=?",
          [r.id],
        ),
        stmt(env, "UPDATE match_history SET room_id=NULL WHERE room_id=?", [
          r.id,
        ]),
        stmt(
          env,
          "UPDATE reports SET room_id=NULL,message_id=NULL WHERE room_id=?",
          [r.id],
        ),
        stmt(
          env,
          "UPDATE operations SET payload=json_object('record',json_object('id',?),'purged',json('true')) WHERE state='DONE' AND json_extract(payload,'$.record.id')=?",
          [r.id, r.id],
        ),
      );
    if (r.state === "CLOSED")
      writes.push(
        stmt(env, "DELETE FROM active_matches WHERE room_id=?", [r.id]),
      );
    // Publish a complete version atomically; indexes never grant permission.
    await env.DB.batch(writes);
    await env.DISCOVERY.getByName("charoo").notify({
      type: "discovery.changed",
    });
  }
  async flush() {
    for (const item of this.rows(
      "SELECT * FROM charoo_outbox ORDER BY rowid",
    )) {
      if (["call.end", "object.delete"].includes(item.kind)) {
        try {
          await this.env.JOBS.send({
            source: "room",
            id: this.meta().id,
            operationId: item.id,
          });
        } catch {}
        continue;
      }
      if (item.kind === "event") {
        try {
          await this.deliver(item.id);
        } catch {}
        continue;
      }
      await this.deliver(item.id);
    }
  }
  async deliver(id: string) {
    const item = this.rows("SELECT * FROM charoo_outbox WHERE id=?", id)[0];
    if (!item) return;
    const b = JSON.parse(item.payload);
    if (item.kind === "projection") await this.project();
    if (item.kind === "event") {
      if (b.userIds)
        for (const uid of b.userIds) await hub(this.env, uid).notify(b);
      else await this.broadcast(b);
    }
    if (item.kind === "object.delete") await this.env.MEDIA.delete(b.key);
    if (item.kind === "call.end") {
      await endCall(this.env, b.id);
      const c = this.call(b.id);
      if (c) {
        c.media_terminated = true;
        this.saveCall(c);
      }
    }
    if (item.kind === "audit") await runAudit(this.env, id, b, this.meta().id);
    this.ctx.storage.sql.exec("DELETE FROM charoo_outbox WHERE id=?", id);
  }
  private async broadcast(event: any) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { actor } = ws.deserializeAttachment() as SocketState;
        await authenticate(this.env, actor);
        if (event.type !== "room.closed") await this.permit(actor);
        else
          requireThat(
            this.participant(actor.userId)?.state === "JOINED",
            403,
            "Conversation unavailable",
          );
        if (
          event.type === "typing" &&
          (await blocked(this.env, actor.userId, event.payload.userId))
        )
          continue;
        sendSocket(ws, event);
      } catch {
        ws.close(4001, "Conversation unavailable");
      }
    }
  }
  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const actor: Actor = {
      userId: request.headers.get("X-Charoo-User") || "",
      sessionHash: request.headers.get("X-Charoo-Session") || "",
    };
    const permitted = await this.authorize(actor);
    if (!permitted.ok)
      return new Response(permitted.message, { status: permitted.status });
    if (!(await hub(this.env, actor.userId).limit("socket:room", 60, 60)))
      return new Response("Socket limit reached", { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ actor } satisfies SocketState);
    await this.wake();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      requireThat(
        typeof message === "string" && message.length <= 8192,
        400,
        "Invalid event",
      );
      const input = z
          .object({ type: z.enum(["typing", "ping"]) })
          .parse(JSON.parse(message as string)),
        { actor } = ws.deserializeAttachment() as SocketState;
      await this.permit(actor, input.type === "typing");
      requireThat(
        await hub(this.env, actor.userId).limit("socket:event", 100, 60),
        429,
        "Too many events",
      );
      if (input.type === "ping") sendSocket(ws, { type: "pong" });
      else if (await hub(this.env, actor.userId).limit("typing", 2, 2))
        await this.broadcast({
          type: "typing",
          roomId: this.meta().id,
          payload: { userId: actor.userId },
        });
    } catch {
      ws.close(4001, "Session unavailable");
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {}
    await this.wake();
  }
  async webSocketError(ws: WebSocket) {
    try {
      ws.close(4002, "Reconnect to load history");
    } catch {}
    await this.wake();
  }
  async alarm() {
    const r = this.meta(),
      cfg = await settings(this.env);
    if (
      r.state === "OPEN" &&
      ((r.expires_at && r.expires_at <= iso()) ||
        (["STRANGER", "PRIVATE"].includes(r.type) &&
          Date.parse(r.last_activity) +
            cfg.conversation_retention_hours * 3600000 <=
            Date.now()))
    )
      await this.closeInternal(r.creator_id);
    this.ctx.storage.transactionSync(() => {
      for (const c of this.calls())
        if (c.state !== "ENDED" && c.expires_at <= iso()) this.end(c);
      for (const a of this.attachments())
        if (
          a.state !== "APPROVED" &&
          Date.parse(a.created_at) + 3600000 <= Date.now()
        ) {
          a.keys.forEach((key) => this.outbox("object.delete", { key }));
          this.ctx.storage.sql.exec(
            "DELETE FROM charoo_attachments WHERE id=?",
            a.id,
          );
          this.changed();
        }
      const current = this.meta();
      if (
        current.state === "CLOSED" &&
        current.purge_at &&
        current.purge_at <= iso() &&
        !current.purged
      ) {
        this.attachments().forEach((a) =>
          a.keys.forEach((key) => this.outbox("object.delete", { key })),
        );
        this.calls().forEach((c) => {
          if (!c.media_terminated) this.outbox("call.end", { id: c.id });
        });
        for (const table of [
          "charoo_messages",
          "charoo_participants",
          "charoo_reactions",
          "charoo_fingerprints",
          "charoo_attachments",
          "charoo_calls",
        ])
          this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
        current.purged = true;
        delete current.invite;
        current.title = "";
        current.description = "";
        current.category = "";
        current.region = "";
        current.tags = [];
        current.creator_id = "";
        this.save(current);
        this.changed();
      }
    });
    for (const ws of this.ctx.getWebSockets())
      try {
        await this.permit((ws.deserializeAttachment() as SocketState).actor);
      } catch {
        ws.close(4001, "Session unavailable");
      }
    for (const item of this.rows("SELECT id FROM charoo_outbox LIMIT 50"))
      try {
        await this.env.JOBS.send({
          source: "room",
          id: this.meta().id,
          operationId: item.id,
        });
      } catch {}
    await this.wake(60000);
  }
}
async function runAudit(env: Env, id: string, b: any, roomId: string) {
  await env.DB.prepare(
    "INSERT INTO audit_logs(id,actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  )
    .bind(id, b.actor, b.action, roomId, JSON.stringify(b.details), iso())
    .run();
}
