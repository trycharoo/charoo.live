type Environment = Record<string, string | undefined>;

function readPort(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

export function workspacePort(
  offset: number,
  fallback: number,
  environment: Environment = process.env,
): number {
  const base = readPort(environment.CONDUCTOR_PORT);
  const port = base === undefined ? fallback : base + offset;
  if (port > 65535)
    throw new Error(
      `CONDUCTOR_PORT leaves no port available at offset ${offset}`,
    );
  return port;
}

export function devWebPort(environment: Environment = process.env): number {
  return readPort(environment.VITE_PORT) ?? workspacePort(0, 5173, environment);
}

export function devCelldPort(environment: Environment = process.env): number {
  return (
    readPort(environment.CELLD_PORT) ?? workspacePort(1, 9876, environment)
  );
}

export function nativeRuntimePort(environment: Environment = process.env) {
  return (
    readPort(environment.NATIVE_RUNTIME_PORT) ??
    workspacePort(2, 9887, environment)
  );
}

export function nativeProviderPort(environment: Environment = process.env) {
  return (
    readPort(environment.NATIVE_PROVIDER_PORT) ??
    workspacePort(3, 8026, environment)
  );
}

export function nativeVitePort(environment: Environment = process.env) {
  return (
    readPort(environment.NATIVE_VITE_PORT) ??
    workspacePort(4, 5176, environment)
  );
}

export function workspaceWebOrigin(
  configuredOrigin: string | undefined,
  environment: Environment = process.env,
): string {
  const origin =
    configuredOrigin || `http://127.0.0.1:${devWebPort(environment)}`;
  const url = new URL(origin);
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    (readPort(environment.CONDUCTOR_PORT) || readPort(environment.VITE_PORT))
  )
    url.port = String(devWebPort(environment));
  return url.origin;
}
