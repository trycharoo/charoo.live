import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import worker from "../celld/index";
import { fixture } from "./runtime";

const crawler =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const browser =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const clientIp = "192.0.2.10";
const context = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

async function setup(max?: string) {
  const f = await fixture();
  f.env.TRUSTED_CLIENT_IP_HEADER = "CF-Connecting-IP";
  if (max !== undefined) f.env.CRAWLER_REQUESTS_PER_MINUTE = max;
  const assets = vi.fn(
    async (_request: Request) =>
      new Response("<html>Charoo</html>", {
        headers: { "Content-Type": "text/html", "X-Asset-Response": "yes" },
      }),
  );
  f.env.ASSETS = { fetch: assets };
  function request(
    path = "/",
    headers: Record<string, string> = {},
    method = "GET",
    body?: string,
  ) {
    return worker.fetch(
      new Request(`http://localhost:5173${path}`, {
        method,
        headers: {
          "User-Agent": crawler,
          "CF-Connecting-IP": clientIp,
          ...headers,
        },
        body,
      }),
      f.env,
      context,
    );
  }
  return { ...f, assets, request };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("crawler request gateway", () => {
  it("routes both Cloudflare targets through the gateway while retaining Celld asset-first routing", () => {
    for (const file of [
      "wrangler.cloudflare.jsonc",
      "wrangler.staging.jsonc",
    ]) {
      const config = parse(
        readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      );
      expect(config.assets).toMatchObject({
        binding: "ASSETS",
        run_worker_first: true,
        not_found_handling: "single-page-application",
      });
      expect(config.vars.TRUSTED_CLIENT_IP_HEADER).toBe("CF-Connecting-IP");
      if (file === "wrangler.cloudflare.jsonc")
        expect(config.vars.WEB_ORIGIN).toBe("https://chat.charoo.live");
      const quota = Number(config.vars.CRAWLER_REQUESTS_PER_MINUTE);
      expect(Number.isSafeInteger(quota)).toBe(true);
      expect(quota).toBeGreaterThan(0);
    }
    const celld = parse(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    );
    expect(celld.assets.run_worker_first).toEqual(["/api/*", "/health"]);
    expect(celld.assets.binding).toBeUndefined();
  });

  it("permits thirty requests and rejects the next before touching assets or the API", async () => {
    const f = await setup();
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => f.request()),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(f.assets).toHaveBeenCalledTimes(30);

    const ready = vi.spyOn(f.app, "ready"),
      database = vi.spyOn(f.db, "prepare");
    for (const path of ["/", "/api/me"]) {
      const denied = await f.request(path);
      expect(denied.status).toBe(429);
      expect(denied.headers.get("Retry-After")).toBe("60");
      expect(denied.headers.get("Cache-Control")).toBe("no-store");
      expect(denied.headers.get("X-Request-Id")).toBeTruthy();
      expect(await denied.json()).toMatchObject({
        error: expect.any(String),
        requestId: denied.headers.get("X-Request-Id"),
      });
    }
    expect(ready).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(f.assets).toHaveBeenCalledTimes(30);
  });

  it("shares the quota across crawler identities, methods, paths and query strings", async () => {
    const f = await setup("2");
    expect((await f.request("/?page=1")).status).toBe(200);
    expect(
      (
        await f.request(
          "/assets/main.js?version=2",
          { "User-Agent": "ClaudeBot/1.0" },
          "HEAD",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request("/api/auth/guest", {
          "User-Agent": "facebookexternalhit/1.1",
        })
      ).status,
    ).toBe(429);
    expect(f.assets).toHaveBeenCalledTimes(2);
  });

  it("isolates client IPs and gives a crawler using a second IP its own allowance", async () => {
    const f = await setup("1");
    expect((await f.request()).status).toBe(200);
    expect((await f.request()).status).toBe(429);
    expect(
      (await f.request("/", { "CF-Connecting-IP": "192.0.2.11" })).status,
    ).toBe(200);
    expect(
      (await f.request("/", { "CF-Connecting-IP": "192.0.2.11" })).status,
    ).toBe(429);
  });

  it("keeps the window across limiter restarts and restores allowance after sixty seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T00:00:00Z"));
    const f = await setup("1");
    expect((await f.request()).status).toBe(200);
    (
      f.env.RATE_LIMITER as unknown as { restart(name: string): unknown }
    ).restart(`crawler:${clientIp}`);
    vi.setSystemTime(new Date("2026-11-16T00:00:59.999Z"));
    expect((await f.request()).status).toBe(429);
    vi.setSystemTime(new Date("2026-11-16T00:01:00Z"));
    expect((await f.request()).status).toBe(200);
    expect((await f.request()).status).toBe(429);
  });

  it.each(["0", "-1", "1.5", "not-a-number", "9007199254740992", ""])(
    "uses the default allowance for invalid configuration %j",
    async (max) => {
      const f = await setup(max);
      for (let count = 0; count < 30; count++)
        expect((await f.request()).status).toBe(200);
      expect((await f.request()).status).toBe(429);
    },
  );

  it.each([
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
    "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "Claude-User/1.0",
    "Perplexity-User/1.0",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Google-InspectionTool/1.0",
    "GoogleOther",
  ])("limits a declared crawler: %s", async (userAgent) => {
    const f = await setup("1"),
      headers = { "User-Agent": userAgent };
    expect((await f.request("/", headers)).status).toBe(200);
    expect((await f.request("/", headers)).status).toBe(429);
  });

  it("does not let spoofed forwarding headers choose a different crawler allowance", async () => {
    const f = await setup("1");
    expect((await f.request()).status).toBe(200);
    expect(
      (
        await f.request("/", {
          "X-Forwarded-For": "192.0.2.12",
          "X-Real-IP": "192.0.2.13",
          Forwarded: "for=192.0.2.14",
        })
      ).status,
    ).toBe(429);
  });

  it("does not create a shared crawler quota when trusted IP information is unavailable", async () => {
    const f = await setup("1"),
      namespace = vi.spyOn(f.env.RATE_LIMITER, "getByName");
    for (const trustedHeader of [undefined, "X-Ingress-Client-IP"]) {
      f.env.TRUSTED_CLIENT_IP_HEADER = trustedHeader;
      for (let count = 0; count < 3; count++)
        expect(
          (
            await f.request("/", {
              "X-Forwarded-For": "192.0.2.12",
              "X-Real-IP": "192.0.2.13",
            })
          ).status,
        ).toBe(200);
    }
    expect(namespace).not.toHaveBeenCalled();
  });

  it("uses the explicitly configured ingress header", async () => {
    const f = await setup("1");
    f.env.TRUSTED_CLIENT_IP_HEADER = "X-Ingress-Client-IP";
    expect(
      (await f.request("/", { "X-Ingress-Client-IP": "192.0.2.20" })).status,
    ).toBe(200);
    expect(
      (await f.request("/", { "X-Ingress-Client-IP": "192.0.2.20" })).status,
    ).toBe(429);
    expect(
      (await f.request("/", { "X-Ingress-Client-IP": "192.0.2.21" })).status,
    ).toBe(200);
  });

  it("leaves health checks available after the crawler quota is exhausted", async () => {
    const f = await setup("1");
    expect((await f.request()).status).toBe(200);
    expect((await f.request()).status).toBe(429);
    for (const path of ["/health", "/api/health"]) {
      const response = await f.request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });
    }
    expect((await f.request()).status).toBe(429);
    expect(f.assets).toHaveBeenCalledTimes(1);
  });

  it("sanitizes limiter failures before backend or asset work and keeps HEAD bodies empty", async () => {
    const f = await setup("1"),
      limiter = f.env.RATE_LIMITER.getByName(`crawler:${clientIp}`),
      ready = vi.spyOn(f.app, "ready"),
      database = vi.spyOn(f.db, "prepare");
    vi.spyOn(limiter, "limit").mockRejectedValue(
      new Error("private storage implementation detail"),
    );
    for (const [path, method] of [
      ["/", "GET"],
      ["/api/me", "HEAD"],
    ]) {
      const failed = await f.request(path, {}, method);
      expect(failed.status).toBe(503);
      expect(failed.headers.get("Retry-After")).toBe("60");
      expect(failed.headers.get("Cache-Control")).toBe("no-store");
      expect(failed.headers.get("X-Request-Id")).toBeTruthy();
      const body = await failed.text();
      expect(body).not.toContain("private storage implementation detail");
      if (method === "HEAD") expect(body).toBe("");
      else
        expect(JSON.parse(body)).toMatchObject({
          error: expect.any(String),
          requestId: failed.headers.get("X-Request-Id"),
        });
    }
    expect(ready).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(f.assets).not.toHaveBeenCalled();
  });

  it("returns an empty HEAD body when a crawler is rate limited", async () => {
    const f = await setup("1");
    expect((await f.request()).status).toBe(200);
    const denied = await f.request("/", {}, "HEAD");
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect(await denied.text()).toBe("");
  });

  it("passes browser asset requests through without backend work or a crawler quota", async () => {
    const f = await setup("1"),
      ready = vi.spyOn(f.app, "ready"),
      database = vi.spyOn(f.db, "prepare"),
      namespace = vi.spyOn(f.env.RATE_LIMITER, "getByName");
    for (const path of ["/", "/assets/main.js", "/rooms/deep-link"]) {
      const response = await f.request(path, { "User-Agent": browser });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Asset-Response")).toBe("yes");
      expect(await response.text()).toBe("<html>Charoo</html>");
    }
    expect(f.assets).toHaveBeenCalledTimes(3);
    expect(ready).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(namespace).not.toHaveBeenCalled();
  });

  it("preserves API authentication and CSRF checks instead of falling back to the SPA", async () => {
    const f = await setup(),
      user = await f.guest(),
      browserHeaders = { "User-Agent": browser };
    for (const path of ["/api", "/api/me", "/api/unknown"])
      expect((await f.request(path, browserHeaders)).status).toBe(401);
    const me = await f.request("/api/me", {
      ...browserHeaders,
      Cookie: `charoo_session=${user.token}`,
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: user.actor.userId } });
    const rejected = await f.request(
      "/api/presence",
      {
        ...browserHeaders,
        Origin: f.env.WEB_ORIGIN,
        Cookie: `charoo_session=${user.token}`,
        "Content-Type": "application/json",
      },
      "POST",
      JSON.stringify({ status: "Online" }),
    );
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({
      error: "Invalid request token",
    });
    expect(f.assets).not.toHaveBeenCalled();
  });

  it("preserves guest creation limits even when automation claims a browser user agent", async () => {
    const f = await setup("1");
    function createGuest(ip = clientIp) {
      return f.request(
        "/api/auth/guest",
        {
          "User-Agent": browser,
          "CF-Connecting-IP": ip,
          Origin: f.env.WEB_ORIGIN,
          "Content-Type": "application/json",
        },
        "POST",
        JSON.stringify({ communityConsent: true }),
      );
    }
    for (let count = 0; count < 10; count++)
      expect((await createGuest()).status).toBe(201);
    const denied = await createGuest();
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({
      error: "Guest session limit reached",
    });
    expect((await createGuest("192.0.2.11")).status).toBe(201);
    const users = await f.db
      .prepare("SELECT COUNT(*) AS count FROM users")
      .first();
    expect(users.count).toBe(11);
    expect(f.assets).not.toHaveBeenCalled();
  });
});
