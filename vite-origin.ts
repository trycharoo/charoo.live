const loopbacks = new Set(["localhost", "127.0.0.1"]);

export function rewriteSameOriginDevOrigin(
  origin: string | undefined,
  host: string | undefined,
  configuredOrigin: string | undefined,
): string | null {
  if (!origin || !host || !configuredOrigin) return null;
  try {
    const requestOrigin = new URL(origin),
      configured = new URL(configuredOrigin);
    if (
      requestOrigin.protocol === "http:" &&
      requestOrigin.host.toLowerCase() === host.toLowerCase() &&
      loopbacks.has(requestOrigin.hostname) &&
      configured.protocol === "http:" &&
      loopbacks.has(configured.hostname)
    )
      return configuredOrigin;
  } catch {}
  return null;
}
