import {
  defaultTheme,
  parseTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from "./theme";
export function readTheme(): ThemePreferences {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
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
