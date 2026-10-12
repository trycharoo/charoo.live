export type ThemeMode = "dark" | "light";
export type Appearance = ThemeMode | "system";
export interface ThemeColors {
  accent: string;
  background: string;
}
interface Palette {
  id: string;
  name: string;
  description: string;
  dark: ThemeColors;
  light: ThemeColors;
}
export const palettes: Palette[] = [
  {
    id: "lavender",
    name: "Lavender",
    description: "The original Charoo",
    dark: { accent: "#b5a1fa", background: "#14131c" },
    light: { accent: "#7553d6", background: "#f7f5fc" },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "A little breathing room",
    dark: { accent: "#79bafa", background: "#0e1924" },
    light: { accent: "#176cbe", background: "#f1f7fd" },
  },
  {
    id: "mint",
    name: "Mint",
    description: "Fresh and easygoing",
    dark: { accent: "#83d9bd", background: "#111d1a" },
    light: { accent: "#19765d", background: "#f1f8f4" },
  },
  {
    id: "rose",
    name: "Rose",
    description: "A softer kind of warm",
    dark: { accent: "#f4a4c4", background: "#22151d" },
    light: { accent: "#b63668", background: "#fff4f7" },
  },
  {
    id: "amber",
    name: "Amber",
    description: "Golden-hour energy",
    dark: { accent: "#edc281", background: "#211b13" },
    light: { accent: "#956414", background: "#fff8ed" },
  },
  {
    id: "slate",
    name: "Slate",
    description: "Quiet and understated",
    dark: { accent: "#aebed4", background: "#171b22" },
    light: { accent: "#506984", background: "#f4f6f9" },
  },
];
export interface ThemePreferences {
  palette: string;
  appearance: Appearance;
  custom: Record<ThemeMode, ThemeColors>;
}
export const THEME_STORAGE_KEY = "charoo.theme.v1";
export const defaultTheme: ThemePreferences = {
  palette: "lavender",
  appearance: "dark",
  custom: { dark: { ...palettes[0].dark }, light: { ...palettes[0].light } },
};
const validColor = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
export function parseTheme(value: string | null): ThemePreferences {
  try {
    const input = JSON.parse(value || "null");
    if (!input || typeof input !== "object") return defaultTheme;
    return {
      palette:
        input.palette === "custom" ||
        palettes.some((p) => p.id === input.palette)
          ? input.palette
          : defaultTheme.palette,
      appearance: ["dark", "light", "system"].includes(input.appearance)
        ? input.appearance
        : defaultTheme.appearance,
      custom: {
        dark: {
          accent: validColor(
            input.custom?.dark?.accent,
            defaultTheme.custom.dark.accent,
          ),
          background: validColor(
            input.custom?.dark?.background,
            defaultTheme.custom.dark.background,
          ),
        },
        light: {
          accent: validColor(
            input.custom?.light?.accent,
            defaultTheme.custom.light.accent,
          ),
          background: validColor(
            input.custom?.light?.background,
            defaultTheme.custom.light.background,
          ),
        },
      },
    };
  } catch {
    return defaultTheme;
  }
}
const rgb = (hex: string) =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
export function mix(a: string, b: string, amount: number): string {
  const right = rgb(b);
  return (
    "#" +
    rgb(a)
      .map((channel, i) =>
        Math.round(channel + (right[i] - channel) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function luminance(color: string): number {
  const channels = rgb(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const left = luminance(a),
    right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
function inkFor(backgrounds: string[]): string {
  const minimum = (ink: string) =>
    Math.min(...backgrounds.map((bg) => contrast(ink, bg)));
  return minimum("#ffffff") > minimum("#000000") ? "#ffffff" : "#000000";
}
function readable(color: string, backgrounds: string[], minimum = 4.5): string {
  const ink = inkFor(backgrounds);
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, ink, step / 100);
    if (backgrounds.every((bg) => contrast(candidate, bg) >= minimum))
      return candidate;
  }
  return ink;
}
export function resolveTheme(
  preferences: ThemePreferences,
  systemDark: boolean,
) {
  const mode: ThemeMode =
    preferences.appearance === "system"
      ? systemDark
        ? "dark"
        : "light"
      : preferences.appearance;
  const palette =
    palettes.find((p) => p.id === preferences.palette) || palettes[0];
  const colors =
    preferences.palette === "custom" ? preferences.custom[mode] : palette[mode];
  const { background: bg, accent } = colors;
  const ink = inkFor([bg]);
  const opposite = ink === "#ffffff" ? "#000000" : "#ffffff";
  const surface = (amount: number) => {
    const candidate = mix(bg, ink, amount);
    return contrast(ink, candidate) >= 4.5
      ? candidate
      : mix(bg, opposite, amount);
  };
  const panel = surface(0.045),
    raised = surface(0.075),
    hover = surface(0.1);
  const sidebar = surface(0.02),
    input = surface(0.015);
  const surfaces = [bg, panel, raised, hover, sidebar, input];
  const tinted = (color: string, amount: number) => {
    const candidate = mix(bg, color, amount);
    return contrast(ink, candidate) >= 4.5
      ? candidate
      : mix(bg, opposite, amount);
  };
  const soft = tinted(accent, 0.13),
    strongSoft = tinted(accent, 0.2);
  const status = (color: string) => {
    const background = tinted(color, 0.1);
    return {
      background,
      text: readable(color, [...surfaces, background]),
      line: mix(bg, color, 0.3),
    };
  };
  const success = status("#4ca878"),
    warning = status("#c58a2c"),
    danger = status("#d65c81"),
    info = status("#638bd2");
  const allSurfaces = [
    ...surfaces,
    soft,
    strongSoft,
    success.background,
    warning.background,
    danger.background,
    info.background,
  ];
  const text = readable(mix(bg, ink, 0.94), allSurfaces);
  const muted = readable(mix(bg, ink, 0.65), allSurfaces);
  const subtle = readable(mix(bg, ink, 0.5), allSurfaces);
  const variables: Record<string, string> = {
    "--bg": bg,
    "--panel": panel,
    "--surface-raised": raised,
    "--surface-hover": hover,
    "--sidebar": sidebar,
    "--input": input,
    "--text": text,
    "--muted": muted,
    "--subtle": subtle,
    "--line": mix(bg, ink, 0.16),
    "--line-strong": mix(bg, ink, 0.28),
    "--accent": accent,
    "--accent-hover": mix(
      accent,
      inkFor([accent]) === "#ffffff" ? "#000000" : "#ffffff",
      0.08,
    ),
    "--accent-text": readable(accent, allSurfaces),
    "--on-accent": inkFor([accent]),
    "--accent-soft": soft,
    "--accent-soft-strong": strongSoft,
    "--accent-line": mix(bg, accent, 0.38),
    "--success": success.text,
    "--success-bg": success.background,
    "--success-line": success.line,
    "--warning": warning.text,
    "--warning-bg": warning.background,
    "--warning-line": warning.line,
    "--danger": danger.text,
    "--danger-bg": danger.background,
    "--danger-line": danger.line,
    "--info": info.text,
    "--info-bg": info.background,
    "--info-line": info.line,
  };
  return {
    mode,
    colors,
    variables,
    scheme: ink === "#ffffff" ? "dark" : "light",
  };
}
export function customizeTheme(
  preferences: ThemePreferences,
  mode: ThemeMode,
  changes: Partial<ThemeColors>,
): ThemePreferences {
  const palette =
    palettes.find((p) => p.id === preferences.palette) || palettes[0];
  const custom =
    preferences.palette === "custom"
      ? preferences.custom
      : { dark: { ...palette.dark }, light: { ...palette.light } };
  return {
    ...preferences,
    palette: "custom",
    custom: { ...custom, [mode]: { ...custom[mode], ...changes } },
  };
}
