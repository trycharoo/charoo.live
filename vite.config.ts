import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import { parse } from "dotenv";
import { parse as parseJsonc } from "jsonc-parser";
import { rewriteSameOriginDevOrigin } from "./vite-origin";
import {
  devCelldPort,
  devWebPort,
  workspaceWebOrigin,
} from "./celld/scripts/ports";
const envFile = process.env.CELLD_ENV_FILE || ".env";
const cloudflareBuildConfig = process.env.CLOUDFLARE_BUILD_CONFIG;
const cloudflareVars = cloudflareBuildConfig
  ? parseJsonc(readFileSync(cloudflareBuildConfig, "utf8")).vars
  : undefined;
const environment: Record<string, string | undefined> = cloudflareBuildConfig
  ? {
      ...process.env,
      NODE_ENV: cloudflareVars?.NODE_ENV,
      WEB_ORIGIN: cloudflareVars?.WEB_ORIGIN,
      LIVEKIT_URL: cloudflareVars?.LIVEKIT_URL,
    }
  : {
      ...(existsSync(envFile) ? parse(readFileSync(envFile)) : {}),
      ...process.env,
    };
const webPort = devWebPort(environment);
const webOrigin =
  process.env.WEB_ORIGIN ||
  workspaceWebOrigin(environment.WEB_ORIGIN, environment);
const providerOrigins = environment.LIVEKIT_URL
  ? [
      new URL(environment.LIVEKIT_URL).origin,
      new URL(environment.LIVEKIT_URL.replace(/^ws/, "http")).origin,
    ]
  : [];
const policy = [
  `default-src 'self'`,
  `script-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `font-src 'self'`,
  `connect-src 'self' ${providerOrigins.join(" ")}`,
  `media-src 'self' blob: ${providerOrigins.join(" ")}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'self'`,
  ...(environment.NODE_ENV === "production"
    ? ["upgrade-insecure-requests"]
    : []),
].join("; ");
const normalizeProxyOrigin = (
  proxyRequest: ClientRequest,
  request: IncomingMessage,
) => {
  const trustedOrigin = rewriteSameOriginDevOrigin(
    request.headers.origin,
    request.headers.host,
    webOrigin,
  );
  if (trustedOrigin) proxyRequest.setHeader("Origin", trustedOrigin);
};
export default defineConfig(({ command }) => ({
  // Worker configuration is loaded above; it must not change Vite's build mode.
  envDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      command === "build" ? "production" : "development",
    ),
  },
  plugins: [
    react(),
    {
      name: "asset-security-headers",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: same-origin\n  Content-Security-Policy: ${policy}\n${environment.NODE_ENV === "production" ? "  Strict-Transport-Security: max-age=31536000; includeSubDomains\n" : ""}/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n`,
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: !!(environment.CONDUCTOR_PORT || environment.VITE_PORT),
    proxy: {
      "/api": {
        target:
          process.env.CELLD_API_TARGET ||
          `http://127.0.0.1:${devCelldPort(environment)}`,
        ws: true,
        configure(proxy) {
          proxy.on("proxyReq", normalizeProxyOrigin);
          proxy.on("proxyReqWs", normalizeProxyOrigin);
        },
      },
    },
  },
}));
