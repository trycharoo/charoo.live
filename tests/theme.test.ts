import { describe, expect, it } from "vitest";
import {
  contrast,
  customizeTheme,
  defaultTheme,
  palettes,
  parseTheme,
  resolveTheme,
} from "../src/theme";

function expectReadable(preferences: typeof defaultTheme) {
  const { variables } = resolveTheme(preferences, false);
  const surfaces = [
    "--bg",
    "--panel",
    "--surface-raised",
    "--surface-hover",
    "--sidebar",
    "--input",
    "--accent-soft",
    "--accent-soft-strong",
    "--success-bg",
    "--warning-bg",
    "--danger-bg",
    "--info-bg",
  ];
  for (const text of ["--text", "--muted", "--subtle", "--accent-text"]) {
    for (const background of surfaces) {
      expect(
        contrast(variables[text], variables[background]),
        `${text} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(
    contrast(variables["--on-accent"], variables["--accent"]),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrast(variables["--on-accent"], variables["--accent-hover"]),
  ).toBeGreaterThanOrEqual(4.5);
}
describe("Theme readability", () => {
  it("keeps every preset readable in both appearances", () => {
    for (const palette of palettes)
      for (const appearance of ["light", "dark"] as const)
        expectReadable({ ...defaultTheme, palette: palette.id, appearance });
  });
  it("keeps matching colors and midtone custom backgrounds readable", () => {
    for (const background of [
      "#000000",
      "#ffffff",
      "#757575",
      "#777777",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#0000ff",
    ]) {
      for (const accent of [background, "#000000", "#ffffff"]) {
        expectReadable(
          customizeTheme(defaultTheme, "dark", { background, accent }),
        );
      }
    }
  });
  it("recovers from malformed and unsupported stored preferences", () => {
    expect(parseTheme("broken")).toEqual(defaultTheme);
    const recovered = parseTheme(
      JSON.stringify({
        palette: "unknown",
        appearance: "other",
        custom: { dark: { accent: "red; display:none", background: "#fff" } },
      }),
    );
    expect(recovered).toEqual(defaultTheme);
  });
});
