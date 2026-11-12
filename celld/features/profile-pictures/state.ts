import { z } from "@charoo/contracts";
import type { Env } from "../../env";
import {
  all,
  authenticate,
  first,
  iso,
  run,
  stmt,
  type Actor,
} from "../../shared/data";
import { requireThat } from "../../shared/errors";

export const pictureInitSchema = z.object({
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1048576),
});
export type Picture = {
  id: string;
  owner_id: string;
  mime: string;
  size: number;
  state: "PENDING" | "APPROVED" | "REJECTED" | "REPLACED";
  created_at: string;
  keys: string[];
  uploaded: boolean;
  object_key?: string;
  uploadAttempt?: string;
  scanAttempt?: string;
  scanUntil?: number;
  scanActor?: Actor;
  approved_key?: string;
};
export async function pictureById(
  env: Env,
  id: string,
): Promise<Picture | null> {
  const r = await first(env, "SELECT data FROM profile_pictures WHERE id=?", [
    id,
  ]);
  return r ? JSON.parse(r.data) : null;
}
export async function currentPicture(
  env: Env,
  owner: string,
): Promise<Picture | null> {
  const r = await first(
    env,
    "SELECT data FROM profile_pictures WHERE owner_id=? AND state='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1",
    [owner],
  );
  return r ? JSON.parse(r.data) : null;
}
const save = (env: Env, p: Picture) =>
  stmt(
    env,
    "INSERT INTO profile_pictures(id,owner_id,state,created_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data",
    [p.id, p.owner_id, p.state, p.created_at, JSON.stringify(p)],
  );
const deletion = (env: Env, key: string) =>
  stmt(
    env,
    "INSERT INTO app_outbox(id,kind,payload,created_at) VALUES(?,'object.delete',?,?)",
    [crypto.randomUUID(), JSON.stringify({ key }), iso()],
  );
export async function pictureScanAccess(
  env: Env,
  id: string,
  attempt: string,
  operation: string,
) {
  const p = await pictureById(env, id);
  // Internal post-write check only: approval revokes the scanner capability,
  // but an already published object must survive an in-flight writer's reply.
  if (operation === "published") {
    requireThat(
      p?.state === "APPROVED" &&
        p.scanAttempt === attempt &&
        p.object_key &&
        p.object_key === p.approved_key,
      403,
      "Picture is not published",
    );
    return { key: p.object_key, mime: p.mime, size: p.size };
  }
  requireThat(
    p?.state === "PENDING" &&
      p.scanAttempt === attempt &&
      (p.scanUntil || 0) > Date.now() &&
      p.scanActor,
    403,
    "Scan expired",
  );
  await authenticate(env, p.scanActor);
  requireThat(
    operation === "read" || operation === "write",
    403,
    "Invalid scan operation",
  );
  return {
    key: operation === "read" ? p.object_key! : p.approved_key!,
    mime: p.mime,
    size: p.size,
  };
}
export async function pictureCommand(
  env: Env,
  actor: Actor,
  kind: string,
  input: any,
) {
  if (kind === "picture.current") {
    const p = await currentPicture(env, actor.userId);
    return {
      picture: p ? { id: p.id, url: "/api/profile/picture/content" } : null,
      uploadAvailable: !!(env.MEDIA_SCANNER_URL && env.MEDIA_SCANNER_TOKEN),
    };
  }
  if (kind === "picture.download") {
    const p = await currentPicture(env, actor.userId);
    requireThat(p, 404, "Picture unavailable");
    return p;
  }
  if (kind === "picture.init") {
    requireThat(
      env.MEDIA_SCANNER_URL && env.MEDIA_SCANNER_TOKEN,
      503,
      "Media scanning is not configured",
    );
    const b = pictureInitSchema.parse(input),
      p: Picture = {
        ...b,
        id: crypto.randomUUID(),
        owner_id: actor.userId,
        state: "PENDING",
        created_at: iso(),
        keys: [],
        uploaded: false,
      };
    await run(
      env,
      "INSERT INTO profile_pictures(id,owner_id,state,created_at,data) VALUES(?,?,?,?,?)",
      [p.id, p.owner_id, p.state, p.created_at, JSON.stringify(p)],
    );
    return { id: p.id, url: `/api/profile/picture/${p.id}/upload` };
  }
  const p = await pictureById(env, input.id);
  requireThat(p && p.owner_id === actor.userId, 404, "Picture unavailable");
  switch (kind) {
    case "picture.upload.begin": {
      requireThat(
        p.state === "PENDING" && !p.scanAttempt,
        409,
        "Picture already processed",
      );
      p.uploadAttempt = crypto.randomUUID();
      p.uploaded = false;
      p.object_key = `quarantine/profile/${actor.userId}/${p.id}/${p.uploadAttempt}`;
      p.keys.push(p.object_key);
      await env.DB.batch([save(env, p)]);
      return { ...p, attempt: p.uploadAttempt };
    }
    case "picture.upload.finish":
      requireThat(
        p.state === "PENDING" &&
          !p.scanAttempt &&
          p.uploadAttempt === input.attempt,
        409,
        "Upload superseded",
      );
      p.uploaded = true;
      await env.DB.batch([save(env, p)]);
      return null;
    case "picture.scan.begin":
      if (p.state === "APPROVED") return p;
      requireThat(
        p.state === "PENDING" && p.uploaded,
        409,
        "Picture unavailable",
      );
      requireThat(
        !p.scanAttempt || (p.scanUntil || 0) < Date.now(),
        409,
        "Picture is being scanned",
      );
      p.scanActor = actor;
      p.scanAttempt = crypto.randomUUID();
      p.scanUntil = Date.now() + 300000;
      p.approved_key = `approved/profile/${actor.userId}/${p.id}/${p.scanAttempt}`;
      p.keys.push(p.approved_key);
      await env.DB.batch([save(env, p)]);
      return p;
    case "picture.scan.abort":
      if (p.state === "PENDING" && p.scanAttempt === input.attempt) {
        const writes = p.approved_key ? [deletion(env, p.approved_key)] : [];
        delete p.scanAttempt;
        delete p.scanUntil;
        delete p.scanActor;
        delete p.approved_key;
        await env.DB.batch([save(env, p), ...writes]);
      }
      return null;
    case "picture.scan.finish": {
      requireThat(
        p.state === "PENDING" &&
          p.scanAttempt === input.attempt &&
          (p.scanUntil || 0) > Date.now(),
        409,
        "Scan expired",
      );
      p.state = input.approved ? "APPROVED" : "REJECTED";
      if (input.approved) {
        p.object_key = p.approved_key;
        p.size = input.size;
      }
      const writes = [
        save(env, p),
        ...p.keys
          .filter((k) => !input.approved || k !== p.object_key)
          .map((k) => deletion(env, k)),
      ];
      if (input.approved) {
        const old = await currentPicture(env, actor.userId);
        if (old && old.id !== p.id) {
          old.state = "REPLACED";
          writes.push(save(env, old), ...old.keys.map((k) => deletion(env, k)));
        }
      }
      await env.DB.batch(writes);
      requireThat(input.approved, 400, "Picture rejected by safety scanning");
      return { id: p.id, state: p.state };
    }
    default:
      requireThat(false, 400, "Unknown picture operation");
  }
}
// Queue deletions before expiring picture rows or deleting their guest owners.
export async function cleanupPictures(env: Env) {
  const rows = await all(
    env,
    "SELECT p.data FROM profile_pictures p JOIN users u ON u.id=p.owner_id WHERE (p.state<>'APPROVED' AND p.created_at<?) OR (u.verified=0 AND u.guest_expires_at<=?) LIMIT 100",
    [iso(Date.now() - 3600000), iso()],
  );
  for (const r of rows) {
    const p: Picture = JSON.parse(r.data);
    await env.DB.batch([
      ...p.keys.map((k) => deletion(env, k)),
      stmt(env, "DELETE FROM profile_pictures WHERE id=?", [p.id]),
    ]);
  }
}
