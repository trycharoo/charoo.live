import type { Env } from "../../env";
import { providerFetch } from "./http";
import { hash } from "../../shared/crypto";
import { requireThat } from "../../shared/errors";
export async function mail(env: Env, email: string, url: string) {
  const text = `Sign in or verify your email: ${url}\nThis link expires in 15 minutes. If you did not request it, ignore this message.`;
  if (env.NODE_ENV !== "production" && env.MAILPIT_URL) {
    const sender = env.EMAIL_FROM || "Charoo <hello@localhost>",
      address = sender.match(/<([^>]+)>/)?.[1] || sender;
    const res = await providerFetch(
      `${env.MAILPIT_URL.replace(/\/$/, "")}/api/v1/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: address, Name: "Charoo" },
          To: [{ Email: email }],
          Subject: "Your Charoo sign-in link",
          Text: text,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
      "Email temporarily unavailable",
    );
    requireThat(res.ok, 503, "Email temporarily unavailable");
    return;
  }
  requireThat(
    env.RESEND_API_KEY && env.EMAIL_FROM,
    503,
    "Email service is not configured",
  );
  const res = await providerFetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": await hash(url),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email],
        subject: "Your Charoo sign-in link",
        text,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
    "Email temporarily unavailable",
  );
  requireThat(res.ok, 503, "Email temporarily unavailable");
}
