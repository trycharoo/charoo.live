import { SignJWT } from "jose";
import type { Env } from "../../env";
import { bytes } from "../../shared/crypto";
import { requireThat } from "../../shared/errors";
export async function callToken(env: Env, id: string, userId: string) {
  requireThat(
    env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL,
    503,
    "Video unavailable",
  );
  return {
    token: await new SignJWT({
      video: {
        roomJoin: true,
        room: `call-${id}`,
        canPublish: true,
        canSubscribe: true,
      },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(env.LIVEKIT_API_KEY)
      .setSubject(userId)
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime("5m")
      .sign(bytes(env.LIVEKIT_API_SECRET)),
    url: env.LIVEKIT_URL,
  };
}
export async function endCall(env: Env, id: string) {
  requireThat(
    env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL,
    503,
    "LiveKit configuration required",
  );
  const jwt = await new SignJWT({
    video: { roomAdmin: true, room: `call-${id}` },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(env.LIVEKIT_API_KEY)
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(bytes(env.LIVEKIT_API_SECRET));
  const res = await fetch(
    `${env.LIVEKIT_URL.replace(/^ws/, "http").replace(/\/$/, "")}/twirp/livekit.RoomService/DeleteRoom`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room: `call-${id}` }),
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    },
  );
  requireThat(res.ok || res.status === 404, 503, "Call termination pending");
}
