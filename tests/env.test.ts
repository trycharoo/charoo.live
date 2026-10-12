import { describe, expect, it } from "vitest";
import { developmentWatchArguments } from "../celld/scripts/cli";
import {
  selectWorkerEnvironment,
  serializeDevVars,
} from "../celld/scripts/env";
const required = {
  WEB_ORIGIN: "https://charoo.example",
  MESSAGE_KEY: Buffer.from("x".repeat(32)).toString("base64"),
};
describe("Worker environment", () => {
  it("ignores test artifacts and Vite sources in the native watcher while preserving no-watch", () => {
    expect(developmentWatchArguments([])).toContain(".context/**");
    expect(developmentWatchArguments([])).toContain("test-results/**");
    expect(developmentWatchArguments(["--no-watch"])).toEqual([]);
  });
  it("exposes only the application allowlist", () =>
    expect(
      selectWorkerEnvironment({
        ...required,
        CELLD_BUCKET: "private-fleet",
        AWS_SECRET_ACCESS_KEY: "private",
        CI_JOB_TOKEN: "private",
      }),
    ).toEqual(required));
  it("rejects invalid keys, origins and incomplete provider groups", () => {
    expect(() =>
      selectWorkerEnvironment({ ...required, MESSAGE_KEY: "bad" }),
    ).toThrow();
    expect(() =>
      selectWorkerEnvironment({
        ...required,
        WEB_ORIGIN: "https://charoo.example/",
      }),
    ).toThrow();
    expect(() =>
      selectWorkerEnvironment({ ...required, GOOGLE_CLIENT_ID: "partial" }),
    ).toThrow();
  });
  it("rejects Mailpit and HTTP origins in production", () => {
    expect(() =>
      selectWorkerEnvironment({
        ...required,
        NODE_ENV: "production",
        MAILPIT_URL: "http://localhost:8025",
      }),
    ).toThrow();
    expect(() =>
      selectWorkerEnvironment({
        ...required,
        NODE_ENV: "production",
        WEB_ORIGIN: "http://localhost:5173",
      }),
    ).toThrow();
  });
  it("quotes values and rejects newlines", () => {
    expect(serializeDevVars({ EMAIL_FROM: 'Charoo \"Friends\"' })).toBe(
      'EMAIL_FROM="Charoo \\"Friends\\""\n',
    );
    expect(() => serializeDevVars({ MESSAGE_KEY: "a\nb" })).toThrow();
  });
});
