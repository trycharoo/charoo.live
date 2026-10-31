import {
  defaultTheme,
  LEGACY_THEME_STORAGE_KEY,
  parseTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from "./theme";
export function readTheme(): ThemePreferences {
  try {
    const current = localStorage.getItem(THEME_STORAGE_KEY);
    if (current) return parseTheme(current);

    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!legacy) return defaultTheme;

    const previous = parseTheme(legacy);
    const wasOriginalDefault =
      previous.palette === "lavender" &&
      previous.appearance === "dark" &&
      previous.custom.dark.accent === "#b5a1fa" &&
      previous.custom.dark.background === "#14131c" &&
      previous.custom.light.accent === "#7553d6" &&
      previous.custom.light.background === "#f7f5fc";
    const migrated = wasOriginalDefault ? defaultTheme : previous;
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return defaultTheme;
  }
}
export function applyTheme(
  preferences: ThemePreferences,
  systemDark = matchMedia("(prefers-color-scheme: dark)").matches,
) {
  const theme = resolveTheme(preferences, systemDark);
  for (const [name, value] of Object.entries(theme.variables))
    document.documentElement.style.setProperty(name, value);
  document.documentElement.dataset.theme = theme.scheme;
  document.documentElement.dataset.palette = preferences.palette;
  document.documentElement.style.colorScheme = theme.scheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.colors.background);
}
