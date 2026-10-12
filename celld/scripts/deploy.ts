import { native } from "./cli";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { parse, type ParseError, printParseErrorCode } from "jsonc-parser";

import { loadApplicationEnvironment, selectWorkerEnvironment } from "./env";

const sourceConfigPath = "wrangler.jsonc";
const deployConfigPath = ".wrangler.deploy.jsonc";

function readWranglerConfig(): Record<string, unknown> {
  const errors: ParseError[] = [];
  const config = parse(readFileSync(sourceConfigPath, "utf8"), errors, {
    allowTrailingComma: true,
  }) as unknown;

  if (errors.length > 0) {
    const summary = errors
      .map(
        (error) =>
          `${printParseErrorCode(error.error)} at offset ${error.offset}`,
      )
      .join(", ");

    throw new Error(`Could not parse ${sourceConfigPath}: ${summary}`);
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${sourceConfigPath} must contain a JSON object`);
  }

  return config as Record<string, unknown>;
}

function createDeployConfig(
  workerEnvironment: Record<string, string>,
): Record<string, unknown> {
  const config = readWranglerConfig();
  const configuredVars =
    config.vars &&
    typeof config.vars === "object" &&
    !Array.isArray(config.vars)
      ? (config.vars as Record<string, unknown>)
      : {};

  return {
    ...config,
    vars: {
      ...configuredVars,
      ...workerEnvironment,
    },
  };
}

async function run(): Promise<number> {
  const environment = selectWorkerEnvironment(
    loadApplicationEnvironment(process.env.CELLD_ENV_FILE || ".env"),
  );
  const deployConfig = createDeployConfig(environment);

  writeFileSync(
    deployConfigPath,
    JSON.stringify(deployConfig, null, 2).concat("\n"),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  return native([
    "deploy",
    "--config",
    deployConfigPath,
    ...process.argv.slice(2).filter((arg) => arg !== "--"),
  ]);
}

try {
  process.exitCode = await run();
} finally {
  rmSync(deployConfigPath, { force: true });
}
