import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../../env";
import { requireThat } from "../../shared/errors";
import { z } from "@charoo/contracts";
export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
  emailAuthoritative: boolean;
}
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 10000 },
);
export function authorizationUrl(
  env: Env,
  input: { state: string; nonce: string; codeChallenge: string },
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.WEB_ORIGIN}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}
export async function verifyGoogle(
  idToken: string,
  clientId: string,
  nonce: string,
  keySet: Parameters<typeof jwtVerify>[1] = jwks,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, keySet, {
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
  });
  const p = z
    .object({
      sub: z.string().min(1).max(255),
      email: z.string().email().max(254),
      email_verified: z.literal(true),
      nonce: z.string(),
      exp: z.number().int(),
      name: z.string().optional(),
      hd: z.string().min(1).optional(),
    })
    .parse(payload);
  requireThat(
    p.nonce === nonce && p.exp * 1000 > Date.now(),
    403,
    "Google identity verification failed",
  );
  const email = p.email.toLowerCase();
  return {
    subject: p.sub,
    email,
    name:
      p.name && p.name.trim().length >= 2
        ? p.name.trim().slice(0, 40)
        : "New friend",
    emailAuthoritative: email.endsWith("@gmail.com") || !!p.hd,
  };
}
export async function exchange(
  env: Env,
  code: string,
  verifier: string,
  nonce: string,
) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.WEB_ORIGIN}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  requireThat(res.ok, 503, "Google sign-in unavailable");
  const body = z.object({ id_token: z.string() }).parse(await res.json());
  return verifyGoogle(body.id_token, env.GOOGLE_CLIENT_ID!, nonce);
}
