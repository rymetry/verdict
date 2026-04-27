import { useEffect, useState } from "react";
import { SunIcon, MoonIcon, MonitorIcon } from "./icons";

export type Theme = "light" | "auto" | "dark";

const STORAGE_KEY = "pw-theme";

function readSavedTheme(): Theme {
  if (typeof window === "undefined") return "auto";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "auto";
}

export function useTheme(): readonly [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => readSavedTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

interface ThemeToggleProps {
  theme: Theme;
  onChange: (next: Theme) => void;
}

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      <button
        role="radio"
        aria-pressed={theme === "light"}
        title="Light"
        onClick={() => onChange("light")}
      >
        <SunIcon />
      </button>
      <button
        role="radio"
        aria-pressed={theme === "auto"}
        title="System"
        onClick={() => onChange("auto")}
      >
        <MonitorIcon />
      </button>
      <button
        role="radio"
        aria-pressed={theme === "dark"}
        title="Dark"
        onClick={() => onChange("dark")}
      >
        <MoonIcon />
      </button>
    </div>
  );
}
