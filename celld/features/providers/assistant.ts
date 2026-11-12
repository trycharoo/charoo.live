import type { Env } from "../../env";
import {
  authenticate,
  settings,
  audit,
  hub,
  roomStub,
  type Actor,
} from "../../shared/data";
import { requireThat, unwrap } from "../../shared/errors";
import { providerFetch } from "./http";
import { HttpError } from "../../shared/errors";
import { z } from "@charoo/contracts";
export async function suggestion(
  env: Env,
  actor: Actor,
  input: { roomId: string; style: string },
) {
  const u = await authenticate(env, actor);
  unwrap(await roomStub(env, input.roomId).authorize(actor));
  requireThat(
    (await settings(env)).AI_assistant_enabled &&
      env.AI_BASE_URL &&
      env.AI_API_KEY &&
      env.AI_MODEL,
    503,
    "Conversation assistant is not configured",
  );
  requireThat(
    await hub(env, u.id).limit("ai", 10, 3600),
    429,
    "Assistant limit reached",
  );
  const res = await providerFetch(
    `${env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Write one short, friendly social conversation suggestion for adults. Respect consent. No harassment, coercion, threats, manipulation, stalking, or sexual content involving minors. Never imply availability is consent. Keep it non-explicit.",
          },
          {
            role: "user",
            content: `Give me a ${input.style} conversation starter.`,
          },
        ],
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
    },
    "Assistant temporarily unavailable",
  );
  requireThat(res.ok, 503, "Assistant temporarily unavailable");
  let b;
  try {
    b = z
      .object({
        choices: z
          .array(
            z.object({ message: z.object({ content: z.string().max(2000) }) }),
          )
          .min(1),
      })
      .parse(await res.json());
  } catch {
    throw new HttpError(503, "Assistant temporarily unavailable");
  }
  await audit(env, u.id, "assistant.suggestion", input.roomId);
  return { suggestion: b.choices[0]!.message.content };
}
