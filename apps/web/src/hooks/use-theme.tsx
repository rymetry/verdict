// テーマ切替フック。
// - 値域: "light" | "dark" | "auto" (auto は OS の prefers-color-scheme に追従)
// - localStorage への永続化を行うが、Safari Private Mode / Quota 超過などで
//   throw した場合でも UI を白画面にしないよう全て安全側で握りつぶす。
// - 解決後の "実際に適用するテーマ" (resolvedTheme) は常に "light" | "dark" の 2 値。
import * as React from "react";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pwqa-theme";
const VALID_PREFERENCES: ReadonlyArray<ThemePreference> = ["light", "dark", "auto"];

interface ThemeContextValue {
  /** ユーザーの選好値 (永続化対象) */
  theme: ThemePreference;
  /** 実際にドキュメントへ適用された 2 値 */
  resolvedTheme: ResolvedTheme;
  /** 選好値を変更する */
  setTheme: (next: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/** localStorage アクセスを安全に行うラッパ */
const safeStorage = {
  read(): ThemePreference | null {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return isThemePreference(value) ? value : null;
    } catch {
      // Safari Private Mode などで throw する場合は黙って null を返す
      return null;
    }
  },
  write(value: ThemePreference): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Quota 超過 / Private Mode で throw した場合も UI は壊さない
    }
  }
};

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && VALID_PREFERENCES.includes(value as ThemePreference);
}

/** OS のダークモード設定を読む。SSR / 古環境では false にフォールバック */
function getSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === "auto") {
    return systemDark ? "dark" : "light";
  }
  return pref;
}

function applyDocumentTheme(resolved: ResolvedTheme, pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  // shadcn/ui 慣用: `.dark` クラスでダークモードを判定
  html.classList.toggle("dark", resolved === "dark");
  // データ属性は visual diagnostic 用 (テスト・デバッグ向け)
  html.dataset.theme = resolved;
  html.dataset.themePreference = pref;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  /** SSR や非ブラウザ環境向けの初期値 */
  defaultTheme?: ThemePreference;
}

export function ThemeProvider({
  children,
  defaultTheme = "auto"
}: ThemeProviderProps): React.ReactElement {
  // 初期化時に localStorage から復元する (不正値はデフォルトへフォールバック)
  const [theme, setThemeState] = React.useState<ThemePreference>(() => {
    if (typeof window === "undefined") return defaultTheme;
    return safeStorage.read() ?? defaultTheme;
  });
  const [systemDark, setSystemDark] = React.useState<boolean>(() => getSystemDark());

  // OS の prefers-color-scheme 変化を監視
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const resolvedTheme = resolveTheme(theme, systemDark);

  // ドキュメントへ反映
  React.useEffect(() => {
    applyDocumentTheme(resolvedTheme, theme);
  }, [resolvedTheme, theme]);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    safeStorage.write(next);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** useTheme: ThemeProvider 配下でのみ使用可能 */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (ctx === null) {
    throw new Error("useTheme must be used within a <ThemeProvider>.");
  }
  return ctx;
}
