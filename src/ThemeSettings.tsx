import { Check, Monitor, Moon, RotateCcw, Sparkles, Sun } from "lucide-react";
import type { CSSProperties } from "react";
import {
  customizeTheme,
  defaultTheme,
  mix,
  palettes,
  type Appearance,
  type ThemeColors,
  type ThemeMode,
  type ThemePreferences,
} from "./theme";
export function ThemeSettings({
  preferences,
  mode,
  colors,
  onChange,
  onDone,
  saved,
}: {
  preferences: ThemePreferences;
  mode: ThemeMode;
  colors: ThemeColors;
  onChange: (preferences: ThemePreferences) => void;
  onDone: () => void;
  saved: boolean;
}) {
  const modes: [Appearance, string, typeof Sun][] = [
    ["light", "Light", Sun],
    ["dark", "Dark", Moon],
    ["system", "Device", Monitor],
  ];
  return (
    <div className="theme-settings">
      <p className="theme-intro">
        Your colors, your corner. Find your favorite palette or make one of your
        own.
      </p>
      <fieldset className="theme-section">
        <legend>Appearance</legend>
        <div className="theme-modes" role="group" aria-label="Appearance mode">
          {modes.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={preferences.appearance === value}
              onClick={() => onChange({ ...preferences, appearance: value })}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="theme-section">
        <legend>Pick a palette</legend>
        <div className="theme-palettes">
          {palettes.map((palette) => {
            const swatches = palette[mode],
              selected = preferences.palette === palette.id;
            return (
              <button
                type="button"
                className="theme-palette"
                key={palette.id}
                aria-label={`${palette.name} palette`}
                aria-pressed={selected}
                onClick={() =>
                  onChange({ ...preferences, palette: palette.id })
                }
              >
                <span
                  className="palette-art"
                  aria-hidden="true"
                  style={
                    {
                      "--preview-bg": swatches.background,
                      "--preview-accent": swatches.accent,
                      "--preview-panel": mix(
                        swatches.background,
                        mode === "dark" ? "#ffffff" : "#000000",
                        0.07,
                      ),
                    } as CSSProperties
                  }
                >
                  <span className="palette-art-sidebar">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="palette-art-content">
                    <i />
                    <span>
                      <i />
                      <i />
                    </span>
                  </span>
                  {selected && (
                    <span className="palette-check">
                      <Check size={13} />
                    </span>
                  )}
                </span>
                <span className="palette-name">{palette.name}</span>
                <span className="palette-description">
                  {palette.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="theme-section custom-theme-section">
        <legend>
          Make it your own{" "}
          {preferences.palette === "custom" && (
            <span className="theme-custom-label">Custom</span>
          )}
        </legend>
        <div className="theme-custom-colors">
          {(
            [
              ["accent", "Accent color", "Buttons, highlights & details"],
              [
                "background",
                "Background color",
                "The canvas for your conversations",
              ],
            ] as const
          ).map(([key, label, description]) => (
            <label className="theme-color-field" key={key}>
              <input
                type="color"
                aria-label={label}
                value={colors[key]}
                onChange={(event) =>
                  onChange(
                    customizeTheme(preferences, mode, {
                      [key]: event.target.value,
                    }),
                  )
                }
              />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
                <code>{colors[key].toUpperCase()}</code>
              </span>
            </label>
          ))}
        </div>
        <p className="theme-color-note">
          Text and panel colors adjust automatically to keep things readable.
        </p>
      </fieldset>
      <div className="theme-preview" aria-label="Live theme preview">
        <div className="theme-preview-heading">
          <span className="theme-preview-avatar">
            <Sparkles size={18} />
          </span>
          <span>
            <strong>A room for your people</strong>
            <small>Your palette, everywhere.</small>
          </span>
          <span className="theme-preview-dot" />
        </div>
        <div className="theme-preview-message">
          Hey! This feels like us. <span aria-hidden="true">✦</span>
        </div>
        <div className="theme-preview-reply">Make yourself at home.</div>
      </div>
      <div className="theme-settings-footer">
        <button
          type="button"
          className="text-button theme-reset"
          onClick={() => onChange(defaultTheme)}
        >
          <RotateCcw size={14} /> Reset to default
        </button>
        <button type="button" className="button small" onClick={onDone}>
          Done <Check size={15} />
        </button>
      </div>
      <p className="theme-save-note">
        <Check size={12} />{" "}
        {saved
          ? "Changes apply instantly and are saved on this device."
          : "Changes apply instantly. This browser couldn’t save them for your next visit."}
      </p>
    </div>
  );
}
