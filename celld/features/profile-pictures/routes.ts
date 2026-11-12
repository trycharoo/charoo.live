import type { Hono } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { z } from "@charoo/contracts";
import { coordinator, roomStub } from "../../shared/data";
import { capabilityKey } from "../../shared/crypto";
import { HttpError, requireThat, unwrap } from "../../shared/errors";
import {
  actor,
  body,
  uuid,
  userRate,
  type HttpEnv,
  type HttpContext,
} from "../../http/context";
import { boundedBody } from "../media/routes";
import { pictureInitSchema } from "./state";

const command = (c: HttpContext, kind: string, input: any = {}) =>
  coordinator(c.env).command(actor(c), kind, input).then(unwrap);
async function scanUrl(c: HttpContext, p: any, operation: "read" | "write") {
  const token = await new SignJWT({
    pictureId: p.id,
    attempt: p.scanAttempt,
    operation,
  })
    .setProtectedHeader({ alg: "HS256", typ: "charoo-profile-scan" })
    .setAudience("charoo-profile-scan")
    .setIssuedAt()
    .setExpirationTime(Math.floor(p.scanUntil / 1000))
    .sign(await capabilityKey(c.env.MESSAGE_KEY));
  const url = new URL(
    `/api/profile/picture/${p.id}/scan/${p.scanAttempt}/${operation === "read" ? "input" : "output"}`,
    c.env.WEB_ORIGIN,
  );
  url.searchParams.set("token", token);
  return url.toString();
}
export async function pictureScanRequest(c: HttpContext) {
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
        audience: "charoo-profile-scan",
        algorithms: ["HS256"],
        typ: "charoo-profile-scan",
      },
    ));
  } catch {
    throw new HttpError(403, "Scan expired");
  }
  requireThat(
    payload.pictureId === id &&
      payload.attempt === attempt &&
      payload.operation === operation,
    403,
    "Scan unavailable",
  );
  const p = unwrap(
    await coordinator(c.env).pictureScanAccess(id, attempt, operation),
  );
  if (operation === "read") {
    const object = await c.env.MEDIA.get(p.key);
    requireThat(object, 404, "Picture unavailable");
    unwrap(await coordinator(c.env).pictureScanAccess(id, attempt, operation));
    return new Response(object.body, {
      headers: {
        "Content-Type": p.mime,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  requireThat(
    c.req.header("Content-Type")?.split(";")[0] === p.mime,
    400,
    "Invalid media type",
  );
  const bytes = await boundedBody(c.req.raw, p.size);
  requireThat(bytes.length > 0, 400, "Empty media");
  await c.env.MEDIA.put(p.key, bytes, {
    httpMetadata: { contentType: p.mime },
    // Freeze the first sanitized output for this attempt. Scanner retries must
    // not overwrite bytes that completion may already have validated.
    onlyIf: { etagDoesNotMatch: "*" },
  });
  const valid = await coordinator(c.env).pictureScanAccess(
    id,
    attempt,
    operation,
  );
  if (!valid.ok) {
    const published = await coordinator(c.env).pictureScanAccess(
      id,
      attempt,
      "published",
    );
    if (!published.ok || published.value.key !== p.key)
      await c.env.MEDIA.delete(p.key);
    unwrap(valid);
  }
  return c.body(null, 204);
}
export function pictureRoutes(app: Hono<HttpEnv>) {
  app.get("/api/profile/picture", async (c) =>
    c.json(await command(c, "picture.current")),
  );
  app.post("/api/profile/picture/init", body(pictureInitSchema), async (c) => {
    await userRate(
      c,
      "picture-upload",
      10,
      3600,
      "Picture upload limit reached",
    );
    return c.json(await command(c, "picture.init", c.get("input")), 201);
  });
  app.put("/api/profile/picture/:id/upload", async (c) => {
    const id = uuid(c.req.param("id")),
      p = await command(c, "picture.upload.begin", { id });
    requireThat(
      c.req.header("Content-Type")?.split(";")[0] === p.mime,
      400,
      "Invalid media type",
    );
    const bytes = await boundedBody(c.req.raw, p.size);
    requireThat(bytes.length === p.size, 400, "Upload size changed");
    await c.env.MEDIA.put(p.object_key, bytes, {
      httpMetadata: { contentType: p.mime },
    });
    const completion = await coordinator(c.env).command(
      actor(c),
      "picture.upload.finish",
      { id, attempt: p.attempt },
    );
    if (!completion.ok) {
      await c.env.MEDIA.delete(p.object_key);
      unwrap(completion);
    }
    return c.body(null, 204);
  });
  app.post("/api/profile/picture/:id/complete", async (c) => {
    const id = uuid(c.req.param("id")),
      p = await command(c, "picture.scan.begin", { id });
    if (p.state === "APPROVED") return c.json({ id: p.id, state: p.state });
    let approved = false,
      size = p.size;
    try {
      requireThat(
        c.env.MEDIA_SCANNER_URL && c.env.MEDIA_SCANNER_TOKEN,
        503,
        "Media scanning is not configured",
      );
      const readUrl = await scanUrl(c, p, "read"),
        writeUrl = await scanUrl(c, p, "write");
      const res = await fetch(c.env.MEDIA_SCANNER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.MEDIA_SCANNER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: readUrl,
          writeUrl,
          mime: p.mime,
          size: p.size,
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
      const output = await c.env.MEDIA.head(p.approved_key);
      approved =
        v.clean &&
        v.magicBytesValid &&
        v.metadataStripped &&
        v.contentSafe &&
        !!output &&
        output.size > 0 &&
        output.size <= p.size &&
        output.httpMetadata?.contentType === p.mime;
      size = output?.size || size;
    } catch {
      await coordinator(c.env)
        .command(actor(c), "picture.scan.abort", { id, attempt: p.scanAttempt })
        .catch(() => {});
      throw new HttpError(503, "Scanning temporarily unavailable");
    }
    return c.json(
      await command(c, "picture.scan.finish", {
        id,
        attempt: p.scanAttempt,
        approved,
        size,
      }),
    );
  });
  app.get("/api/profile/picture/content", async (c) => {
    const p = await command(c, "picture.download"),
      object = await c.env.MEDIA.get(p.object_key);
    requireThat(object, 404, "Picture unavailable");
    requireThat(
      !c.req.query("pictureId") || c.req.query("pictureId") === p.id,
      409,
      "Picture changed",
    );
    const latest = await command(c, "picture.download");
    requireThat(latest.id === p.id, 409, "Picture changed");
    return new Response(object.body, {
      headers: {
        "Content-Type": p.mime,
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  app.get("/api/rooms/:roomId/pictures/:userId/content", async (c) => {
    const room = roomStub(c.env, uuid(c.req.param("roomId"))),
      input = {
        userId: uuid(c.req.param("userId")),
        pictureId: c.req.query("pictureId"),
      };
    const p = unwrap(await room.command(actor(c), "picture.download", input)),
      object = await c.env.MEDIA.get(p.object_key);
    requireThat(object, 404, "Picture unavailable");
    const latest = unwrap(
      await room.command(actor(c), "picture.download", input),
    );
    requireThat(latest.id === p.id, 409, "Picture changed");
    return new Response(object.body, {
      headers: {
        "Content-Type": p.mime,
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
