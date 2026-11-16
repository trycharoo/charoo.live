import type { Env } from "../env";
import { app } from "./app";

// This identifies self-declared crawlers, not browsers that hide automation.
// Claimed search-engine identities get the same quota as other crawlers.
const crawlerAgent =
  /bot\b|crawler|spider|slurp|bingpreview|facebookexternalhit|facebookcatalog|googleother|google-inspectiontool|google-extended|chatgpt-user|claude-user|perplexity-user|anthropic-ai|meta-externalagent|meta-externalfetcher/i;
const windowSeconds = 60;

function unavailable(request: Request, status: 429 | 503) {
  const requestId = crypto.randomUUID();
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({
          error:
            status === 429
              ? "Crawler request limit reached; try again shortly"
              : "Service temporarily unavailable",
          requestId,
        }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store",
        "Retry-After": String(windowSeconds),
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    },
  );
}

export async function fetchRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const health = path === "/health" || path === "/api/health";
  // Only the configured ingress header is trusted. Without it, avoid putting
  // unrelated visitors into a shared anonymous crawler bucket.
  const ip = env.TRUSTED_CLIENT_IP_HEADER
    ? request.headers.get(env.TRUSTED_CLIENT_IP_HEADER)?.trim()
    : undefined;
  if (
    !health &&
    ip &&
    crawlerAgent.test(request.headers.get("User-Agent") || "")
  ) {
    const configured = Number(env.CRAWLER_REQUESTS_PER_MINUTE);
    const max =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 30;
    try {
      if (
        !(await env.RATE_LIMITER.getByName(`crawler:${ip.slice(0, 128)}`).limit(
          "crawl",
          max,
          windowSeconds,
        ))
      )
        return unavailable(request, 429);
    } catch {
      return unavailable(request, 503);
    }
  }
  // Keep asset responses (including CSP/cache headers and SPA fallback) intact,
  // and avoid application/session/database work for frontend requests.
  if (
    env.ASSETS &&
    path !== "/api" &&
    !path.startsWith("/api/") &&
    path !== "/health"
  )
    return env.ASSETS.fetch(request);
  return app.fetch(request, env, ctx);
}
