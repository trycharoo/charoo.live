import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export function celldBinary() {
  const candidate =
    process.env.CELLD_BIN || join(homedir(), ".local/bin/celld");
  return existsSync(candidate) ? candidate : "celld";
}
export function nativeEnvironment() {
  return {
    ...process.env,
    PATH: `${resolve("node_modules/.bin")}:${process.env.PATH || ""}`,
  };
}
export function developmentWatchArguments(args: string[]) {
  if (args.includes("--no-watch")) return [];
  return [
    ".context/**",
    "test-results/**",
    "playwright-report/**",
    "coverage/**",
    "tests/**",
    "src/**",
    "public/**",
    "**/*.md",
  ].flatMap((pattern) => ["--watch-ignore", pattern]);
}
export async function native(args: string[]): Promise<number> {
  const version = spawnSync(celldBinary(), ["--version"], { encoding: "utf8" });
  if (version.error)
    throw new Error("Celld 0.6.1 is required. Install Celld or set CELLD_BIN.");
  if (!version.stdout.includes("0.6.1"))
    throw new Error("This application requires Celld 0.6.1.");
  const child = spawn(celldBinary(), args, {
    stdio: "inherit",
    env: nativeEnvironment(),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => child.kill(signal));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
