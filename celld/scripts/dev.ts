import { spawnSync } from "node:child_process";
import { native, nativeEnvironment, developmentWatchArguments } from "./cli";
import { writeFileSync, existsSync } from "node:fs";

import {
  loadApplicationEnvironment,
  selectWorkerEnvironment,
  serializeDevVars,
} from "./env";

const environment = selectWorkerEnvironment(
  loadApplicationEnvironment(process.env.CELLD_ENV_FILE || ".env"),
);

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
const args = process.argv.slice(2).filter((arg) => arg !== "--");
process.exitCode = await native([
  "dev",
  process.env.CELLD_CONFIG || ".",
  ...developmentWatchArguments(args),
  ...args,
]);
