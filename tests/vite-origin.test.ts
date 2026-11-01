import { describe, expect, it } from "vitest";
import { rewriteSameOriginDevOrigin } from "../vite-origin";

describe("Vite development proxy origin", () => {
  const configuredOrigin = "http://127.0.0.1:5173";

  it("normalizes same-origin fallback ports to WEB_ORIGIN", () => {
    expect(
      rewriteSameOriginDevOrigin(
        "http://127.0.0.1:5174",
        "127.0.0.1:5174",
        configuredOrigin,
      ),
    ).toBe(configuredOrigin);
    expect(
      rewriteSameOriginDevOrigin(
        "http://localhost:5175",
        "localhost:5175",
        configuredOrigin,
      ),
    ).toBe(configuredOrigin);
  });

  it("does not normalize cross-origin or non-loopback requests", () => {
    expect(
      rewriteSameOriginDevOrigin(
        "http://localhost:5174",
        "127.0.0.1:5174",
        configuredOrigin,
      ),
    ).toBeNull();
    expect(
      rewriteSameOriginDevOrigin(
        "http://example.com:5174",
        "example.com:5174",
        configuredOrigin,
      ),
    ).toBeNull();
  });
});
