import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  symlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { celldBinary, nativeEnvironment } from "./cli";
mkdirSync(".context", { recursive: true });
const directory = mkdtempSync(resolve(".context/native-"));
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
config.main = "./tests/native/worker.ts";
config.assets.directory = "./dist";
config.d1_databases[0].migrations_dir = "celld/migrations";
config.vars = {
  NODE_ENV: "development",
  WEB_ORIGIN: "http://127.0.0.1:9887",
  MESSAGE_KEY: Buffer.from("x".repeat(32)).toString("base64"),
  EMAIL_FROM: "Charoo <hello@fixture.example>",
  MAILPIT_URL: "http://127.0.0.1:8026",
  GOOGLE_CLIENT_ID: "fixture-google-client",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  MEDIA_SCANNER_URL: "http://127.0.0.1:8026/scan",
  MEDIA_SCANNER_TOKEN: "fixture-scanner-secret",
  LIVEKIT_URL: "http://127.0.0.1:8026",
  LIVEKIT_API_KEY: "fixture-livekit-key",
  LIVEKIT_API_SECRET: "fixture-livekit-secret",
  AI_BASE_URL: "http://127.0.0.1:8026/v1",
  AI_API_KEY: "fixture-ai-key",
  AI_MODEL: "fixture-model",
  TRUSTED_CLIENT_IP_HEADER: "X-Fixture-Client",
};
writeFileSync(`${directory}/wrangler.jsonc`, JSON.stringify(config));
const build = spawnSync("vite", ["build"], {
  stdio: "inherit",
  env: nativeEnvironment(),
});
if (build.status !== 0) throw new Error("Frontend build failed");
for (const folder of ["celld", "packages", "dist"])
  cpSync(folder, `${directory}/${folder}`, { recursive: true });
mkdirSync(`${directory}/tests/native`, { recursive: true });
cpSync("tests/native/worker.ts", `${directory}/tests/native/worker.ts`);
symlinkSync(resolve("node_modules"), `${directory}/node_modules`, "dir");
const providers = spawn("tsx", ["tests/native/providers.ts"], {
  stdio: "inherit",
  env: nativeEnvironment(),
});
let runtime = spawn(
  celldBinary(),
  ["dev", directory, "--port", "9887", "--no-watch"],
  { stdio: "inherit", env: nativeEnvironment() },
);
let frontend: ReturnType<typeof spawn> | undefined;
async function restart() {
  await new Promise<void>((done) => {
    runtime.once("exit", () => done());
    runtime.kill("SIGINT");
  });
  runtime = spawn(
    celldBinary(),
    ["dev", directory, "--port", "9887", "--no-watch"],
    { stdio: "inherit", env: nativeEnvironment() },
  );
  await ready();
}
async function ready() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null)
      throw new Error("Native runtime exited before readiness");
    try {
      if ((await fetch("http://127.0.0.1:9887/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Native runtime did not start");
}
async function tests(
  args: string[],
  configFile = "playwright.native.config.ts",
) {
  const child = spawn("playwright", ["test", "--config", configFile, ...args], {
    stdio: "inherit",
    env: { ...nativeEnvironment(), BROWSER_BASE_URL: config.vars.WEB_ORIGIN },
  });
  return new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
const stop = () => {
  frontend?.kill("SIGINT");
  runtime.kill("SIGINT");
  providers.kill("SIGINT");
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
try {
  await ready();
  const code = await tests(["--grep-invert", "verify restart persistence"]);
  if (code !== 0) process.exitCode = code;
  else {
    await restart();
    process.exitCode = await tests(["--grep", "verify restart persistence"]);
    if (!process.exitCode)
      process.exitCode = await tests([], "playwright.config.ts");
    if (!process.exitCode) {
      config.vars.WEB_ORIGIN = "http://127.0.0.1:5176";
      writeFileSync(`${directory}/wrangler.jsonc`, JSON.stringify(config));
      await restart();
      frontend = spawn(
        "vite",
        ["--host", "127.0.0.1", "--port", "5176", "--strictPort"],
        {
          stdio: "inherit",
          env: {
            ...nativeEnvironment(),
            CELLD_API_TARGET: "http://127.0.0.1:9887",
          },
        },
      );
      const deadline = Date.now() + 30000;
      let connected = false;
      while (Date.now() < deadline && !connected) {
        if (frontend.exitCode !== null)
          throw new Error("Vite exited before readiness");
        try {
          connected = (await fetch(config.vars.WEB_ORIGIN)).ok;
        } catch {}
        if (!connected) await new Promise((r) => setTimeout(r, 100));
      }
      if (!connected) throw new Error("Vite did not start");
      process.exitCode = await tests([], "playwright.config.ts");
    }
  }
} finally {
  stop();
}
