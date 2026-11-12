import type { Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "@charoo/contracts";
import { roomStub } from "../../shared/data";
import { capabilityKey } from "../../shared/crypto";
import { HttpError, requireThat, unwrap } from "../../shared/errors";
import {
  actor,
  body,
  uuid,
  type HttpContext,
  type HttpEnv,
} from "../../http/context";
import { locate } from "../providers/routes";

export const mediaSchema = z.object({
  roomId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[\p{L}\p{N}_. ()-]+$/u),
  mime: z.enum([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/webm",
    "audio/mpeg",
    "application/pdf",
  ]),
  size: z
    .number()
    .int()
    .positive()
    .max(25 * 1048576),
});
export async function boundedBody(
  request: Pick<Request, "body">,
  maximum: number,
) {
  requireThat(request.body, 400, "Missing request body");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      requireThat(size <= maximum, 413, "Request too large");
      chunks.push(r.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
async function scanUrl(
  c: HttpContext,
  attachment: any,
  operation: "read" | "write",
) {
  const jwt = await new SignJWT({
    roomId: attachment.room_id,
    attachmentId: attachment.id,
    attempt: attachment.scanAttempt,
    operation,
  })
    .setProtectedHeader({ alg: "HS256", typ: "charoo-scan" })
    .setAudience("charoo-media-scan")
    .setIssuedAt()
    .setExpirationTime(Math.floor(attachment.scanUntil / 1000))
    .sign(await capabilityKey(c.env.MESSAGE_KEY));
  const url = new URL(
    `/api/media/${attachment.id}/scan/${attachment.scanAttempt}/${operation === "read" ? "input" : "output"}`,
    c.env.WEB_ORIGIN,
  );
  url.searchParams.set("token", jwt);
  return url.toString();
}
export async function scanRequest(c: HttpContext) {
  const id = uuid(c.req.param("id")),
    attempt = uuid(c.req.param("attempt")),
    operation =
      c.req.param("operation") === "input"
        ? "read"
        : c.req.param("operation") === "output"
          ? "write"
          : null;
  requireThat(
    operation && c.req.method === (operation === "read" ? "GET" : "PUT"),
    405,
    "Invalid scan operation",
  );
  let payload: any;
  try {
    ({ payload } = await jwtVerify(
      c.req.query("token") || "",
      await capabilityKey(c.env.MESSAGE_KEY),
      {
        audience: "charoo-media-scan",
        algorithms: ["HS256"],
        typ: "charoo-scan",
      },
    ));
  } catch {
    throw new HttpError(403, "Scan expired");
  }
  requireThat(
    payload.attachmentId === id &&
      payload.attempt === attempt &&
      payload.operation === operation,
    403,
    "Scan unavailable",
  );
  const roomId = uuid(payload.roomId),
    r = unwrap(
      await roomStub(c.env, roomId).scanAccess(id, attempt, operation),
    );
  if (operation === "read") {
    const object = await c.env.MEDIA.get(r.key);
    requireThat(object, 404, "Attachment unavailable");
    return new Response(object.body, {
      headers: {
        "Content-Type": r.mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  requireThat(
    c.req.header("Content-Type")?.split(";")[0] === r.mime,
    400,
    "Invalid media type",
  );
  const bytes = await boundedBody(c.req.raw, r.size);
  requireThat(bytes.length > 0, 400, "Empty media");
  await c.env.MEDIA.put(r.key, bytes, {
    httpMetadata: { contentType: r.mime },
  });
  // An expired or superseded attempt cannot retain a newly uploaded object.
  const current = await roomStub(c.env, roomId).scanAccess(
    id,
    attempt,
    operation,
  );
  if (!current.ok) {
    await c.env.MEDIA.delete(r.key);
    unwrap(current);
  }
  return c.body(null, 204);
}
export function mediaRoutes(app: Hono<HttpEnv>) {
  app.post("/api/media/init", body(mediaSchema), async (c) =>
    c.json(
      unwrap(
        await roomStub(c.env, c.get("input").roomId).command(
          actor(c),
          "attachment.init",
          c.get("input"),
        ),
      ),
      201,
    ),
  );
  app.put("/api/media/:id/upload", async (c) => {
    const r = await locate(c, "attachment"),
      a = unwrap(
        await r.room.command(actor(c), "attachment.upload.begin", { id: r.id }),
      );
    requireThat(
      c.req.header("Content-Type")?.split(";")[0] === a.mime,
      400,
      "Invalid media type",
    );
    const bytes = await boundedBody(c.req.raw, a.size);
    requireThat(bytes.length === a.size, 400, "Upload size changed");
    await c.env.MEDIA.put(a.object_key, bytes, {
      httpMetadata: { contentType: a.mime },
    });
    const completion = await r.room.command(
      actor(c),
      "attachment.upload.finish",
      { id: r.id, attempt: a.attempt },
    );
    if (!completion.ok) {
      await c.env.MEDIA.delete(a.object_key);
      unwrap(completion);
    }
    return c.body(null, 204);
  });
  app.post("/api/media/:id/complete", async (c) => {
    const r = await locate(c, "attachment"),
      a = unwrap(
        await r.room.command(actor(c), "attachment.scan.begin", { id: r.id }),
      );
    if (a.state === "APPROVED") return c.json({ id: a.id, state: a.state });
    requireThat(
      c.env.MEDIA_SCANNER_URL && c.env.MEDIA_SCANNER_TOKEN,
      503,
      "Media scanning is not configured",
    );
    let approved = false,
      size = a.size;
    try {
      const res = await fetch(c.env.MEDIA_SCANNER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.MEDIA_SCANNER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: await scanUrl(c, a, "read"),
          writeUrl: await scanUrl(c, a, "write"),
          mime: a.mime,
          size: a.size,
          stripMetadata: true,
        }),
        signal: AbortSignal.timeout(30000),
        redirect: "manual",
      });
      requireThat(res.ok, 503, "Scanning temporarily unavailable");
      const v = z
        .object({
          clean: z.boolean(),
          magicBytesValid: z.boolean(),
          metadataStripped: z.boolean(),
          contentSafe: z.boolean(),
        })
        .parse(await res.json());
      const output = await c.env.MEDIA.head(a.approved_key);
      approved =
        v.clean &&
        v.magicBytesValid &&
        v.metadataStripped &&
        v.contentSafe &&
        !!output &&
        output.size > 0 &&
        output.size <= a.size &&
        output.httpMetadata?.contentType === a.mime;
      size = output?.size || size;
    } catch {
      await r.room
        .command(actor(c), "attachment.scan.abort", {
          id: r.id,
          attempt: a.scanAttempt,
        })
        .catch(() => {});
      throw new HttpError(503, "Scanning temporarily unavailable");
    }
    return c.json(
      unwrap(
        await r.room.command(actor(c), "attachment.scan.finish", {
          id: r.id,
          attempt: a.scanAttempt,
          approved,
          size,
        }),
      ),
    );
  });
  app.get("/api/media/:id/download", async (c) => {
    const r = await locate(c, "attachment"),
      a = unwrap(
        await r.room.command(actor(c), "attachment.download", { id: r.id }),
      );
    return c.json({ url: `/api/media/${r.id}/content`, name: a.name });
  });
  app.get("/api/media/:id/content", async (c) => {
    const r = await locate(c, "attachment"),
      a = unwrap(
        await r.room.command(actor(c), "attachment.download", { id: r.id }),
      ),
      object = await c.env.MEDIA.get(a.object_key);
    requireThat(object, 404, "Attachment unavailable");
    unwrap(await r.room.authorize(actor(c)));
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
