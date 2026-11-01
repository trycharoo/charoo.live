import { describe, expect, it } from "vitest";
import {
  devCelldPort,
  devWebPort,
  nativeProviderPort,
  nativeRuntimePort,
  nativeVitePort,
  workspacePort,
  workspaceWebOrigin,
} from "../celld/scripts/ports";

describe("workspace development ports", () => {
  it("uses stable defaults outside Conductor and offsets inside a workspace", () => {
    expect([
      devWebPort({}),
      devCelldPort({}),
      nativeRuntimePort({}),
      nativeProviderPort({}),
      nativeVitePort({}),
    ]).toEqual([5173, 9876, 9887, 8026, 5176]);

    const environment = { CONDUCTOR_PORT: "55050" };
    expect([
      devWebPort(environment),
      devCelldPort(environment),
      nativeRuntimePort(environment),
      nativeProviderPort(environment),
      nativeVitePort(environment),
    ]).toEqual([55050, 55051, 55052, 55053, 55054]);
  });

  it("honors explicit port overrides and rebases loopback origins", () => {
    const environment = {
      CONDUCTOR_PORT: "55050",
      VITE_PORT: "56000",
      CELLD_PORT: "56001",
      NATIVE_RUNTIME_PORT: "56002",
      NATIVE_PROVIDER_PORT: "56003",
      NATIVE_VITE_PORT: "56004",
    };
    expect([
      devWebPort(environment),
      devCelldPort(environment),
      nativeRuntimePort(environment),
      nativeProviderPort(environment),
      nativeVitePort(environment),
    ]).toEqual([56000, 56001, 56002, 56003, 56004]);
    expect(
      workspaceWebOrigin("http://localhost:5173", {
        CONDUCTOR_PORT: "55050",
      }),
    ).toBe("http://localhost:55050");
    expect(
      workspaceWebOrigin("https://app.example.test/", environment),
    ).toBe("https://app.example.test");
  });

  it("rejects allocations that exceed the TCP port range", () => {
    expect(() => workspacePort(1, 9876, { CONDUCTOR_PORT: "65535" })).toThrow(
      "CONDUCTOR_PORT leaves no port available at offset 1",
    );
  });
});
