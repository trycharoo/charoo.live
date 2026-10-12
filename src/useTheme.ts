import { useEffect, useLayoutEffect, useState } from "react";
import { applyTheme, readTheme } from "./theme-browser";
import {
  parseTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from "./theme";
export function useTheme() {
  const [saved, setSaved] = useState(true);
  const [preferences, setPreferences] = useState(readTheme);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useLayoutEffect(
    () => applyTheme(preferences, systemDark),
    [preferences, systemDark],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    changed();
    media.addEventListener("change", changed);
    const stored = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        setPreferences(parseTheme(event.newValue));
    };
    window.addEventListener("storage", stored);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", stored);
    };
  }, []);
  const update = (next: ThemePreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };
  return {
    preferences,
    update,
    theme: resolveTheme(preferences, systemDark),
    saved,
  };
}
