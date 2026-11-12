import {
  defaultTheme,
  LEGACY_THEME_STORAGE_KEY,
  migrateTheme,
  parseTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from "./theme";
export function readTheme(): ThemePreferences {
  try {
    const current = localStorage.getItem(THEME_STORAGE_KEY);
    const stored = current || localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!stored) return defaultTheme;

    const previous = parseTheme(stored);
    const migrated = migrateTheme(previous, !current);
    if (!current || migrated !== previous) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(migrated));
      } catch {
        // Stored preferences still apply when this browser cannot save updates.
      }
    }
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
