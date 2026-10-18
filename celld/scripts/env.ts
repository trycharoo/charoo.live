import { existsSync, readFileSync } from "node:fs";
import { parse as parseDotEnv } from "dotenv";

import { workerEnvironment } from "../env";

export type EnvironmentSource = Record<string, string | undefined>;

export function loadApplicationEnvironment(
  envFile = ".env",
  processEnvironment: EnvironmentSource = process.env,
): EnvironmentSource {
  const fileEnvironment = existsSync(envFile)
    ? parseDotEnv(readFileSync(envFile))
    : {};

  return {
    ...fileEnvironment,
    ...processEnvironment,
  };
}

export function selectWorkerEnvironment(
  source: EnvironmentSource,
): Record<string, string> {
  const selected: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of workerEnvironment.required) {
    const value = source[name];

    if (value === undefined || value === "") {
      missing.push(name);
      continue;
    }

    selected[name] = value;
  }

  for (const name of workerEnvironment.optional) {
    const value = source[name];

    if (value !== undefined && value !== "") {
      selected[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required Worker environment variables: ${missing.join(", ")}`,
    );
  }

  for (const name of ["WEB_ORIGIN", "ADMIN_ORIGIN"] as const) {
    if (!selected[name]) continue;
    const origin = new URL(selected[name]);
    if (
      origin.origin !== selected[name] ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error(
        `${name} must be an HTTP origin without a trailing slash`,
      );
    if (selected.NODE_ENV === "production" && origin.protocol !== "https:")
      throw new Error(`Production ${name} must use HTTPS`);
  }
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(selected.MESSAGE_KEY!) ||
    Buffer.from(selected.MESSAGE_KEY!, "base64").length !== 32 ||
    Buffer.from(selected.MESSAGE_KEY!, "base64").toString("base64") !==
      selected.MESSAGE_KEY
  )
    throw new Error("MESSAGE_KEY must be a base64 encoded 32-byte secret");
  for (const group of [
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["MEDIA_SCANNER_URL", "MEDIA_SCANNER_TOKEN"],
    ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
    ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"],
  ]) {
    if (
      group.some((name) => selected[name]) &&
      !group.every((name) => selected[name])
    )
      throw new Error(
        `Configure all provider variables together: ${group.join(", ")}`,
      );
  }
  if (selected.NODE_ENV === "production" && selected.MAILPIT_URL)
    throw new Error("MAILPIT_URL is local only");
  return selected;
}

export function serializeDevVars(environment: Record<string, string>): string {
  const entries = Object.entries(environment).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return entries
    .map(([name, value]) => {
      if (/[\r\n]/u.test(value)) {
        throw new Error(
          `Worker environment variable ${name} contains a newline and cannot be represented in .dev.vars`,
        );
      }

      return `${name}=${JSON.stringify(value)}`;
    })
    .join("\n")
    .concat(entries.length > 0 ? "\n" : "");
}
