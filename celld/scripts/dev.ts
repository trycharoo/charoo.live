import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { native, nativeEnvironment, developmentWatchArguments } from "./cli";
import { writeFileSync, existsSync } from "node:fs";

import {
  loadApplicationEnvironment,
  selectWorkerEnvironment,
  serializeDevVars,
} from "./env";
import { devCelldPort, workspaceWebOrigin } from "./ports";

const source = loadApplicationEnvironment(process.env.CELLD_ENV_FILE || ".env");
const environment = selectWorkerEnvironment({
  ...source,
  WEB_ORIGIN:
    process.env.WEB_ORIGIN || workspaceWebOrigin(source.WEB_ORIGIN, source),
});
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const hasPortArgument =
  args.some((arg, index) => arg === "--port" && !!args[index + 1]) ||
  args.some((arg) => arg.startsWith("--port="));
const allocatedPort = hasPortArgument ? undefined : devCelldPort();

async function portStatus(
  port: number,
): Promise<"celld" | "occupied" | "free"> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(700),
    });
    if (response.ok) return "celld";
  } catch {}

  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (status: "occupied" | "free") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(700, () => finish("occupied"));
    socket.once("connect", () => finish("occupied"));
    socket.once("error", () => finish("free"));
  });
}

if (allocatedPort) {
  const status = await portStatus(allocatedPort);
  if (status === "celld") {
    console.log(
      `Celld is already running at http://127.0.0.1:${allocatedPort}; reusing it.`,
    );
    process.exit(0);
  }
  if (status === "occupied")
    throw new Error(
      `Port ${allocatedPort} is occupied by a service that did not pass the Celld health check. Set CELLD_PORT to a free port or stop that service.`,
    );
}

writeFileSync(".dev.vars", serializeDevVars(environment), {
  encoding: "utf8",
  mode: 0o600,
});

if (!existsSync("dist/index.html")) {
  const build = spawnSync("vite", ["build"], {
    stdio: "inherit",
    env: nativeEnvironment(),
  });
  if (build.status !== 0) throw new Error("Frontend build failed");
}
process.exitCode = await native([
  "dev",
  process.env.CELLD_CONFIG || ".",
  ...developmentWatchArguments(args),
  ...(allocatedPort ? ["--port", String(allocatedPort)] : []),
  ...args,
]);
