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

/** dev ビルド時のみ握りつぶした例外を console.warn する */
function warnDev(scope: string, error: unknown): void {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console -- 開発時の診断目的に限定
    console.warn(`[useTheme] ${scope}`, error);
  }
}

/** localStorage アクセスを安全に行うラッパ */
const safeStorage = {
  read(): ThemePreference | null {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return isThemePreference(value) ? value : null;
    } catch (error) {
      // Safari Private Mode などで throw した場合は黙って null を返す
      warnDev("localStorage.getItem failed (Private Mode 等)", error);
      return null;
    }
  },
  write(value: ThemePreference): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Quota 超過 / Private Mode で throw した場合も UI は壊さない
      warnDev("localStorage.setItem failed (Quota 超過 等)", error);
    }
  }
};

/** 公開エクスポート: 外部 (ToggleGroup 等) でも値域チェックに利用できる */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && VALID_PREFERENCES.includes(value as ThemePreference);
}

/** OS のダークモード設定を読む。SSR / 古環境 / matchMedia throw 時は false */
function getSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (error) {
    warnDev("matchMedia failed; OS theme detection disabled", error);
    return false;
  }
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
  /**
   * SSR や非ブラウザ環境向けの初期値。
   * **初期マウント時のみ参照** され、マウント後の再レンダリングでは無視される。
   * 動的にデフォルトを切替えたい場合は `setTheme()` を経由すること。
   */
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

  // OS の prefers-color-scheme 変化を監視 (auto モードで OS 設定変更へ追従するため)
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch (error) {
      warnDev("matchMedia subscription failed", error);
      return;
    }
    const handler = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    // モダンブラウザ: addEventListener / 古い Safari: addListener の両対応
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    const legacy = mql as unknown as {
      addListener?: (h: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (h: (event: MediaQueryListEvent) => void) => void;
    };
    if (typeof legacy.addListener === "function") {
      legacy.addListener(handler);
      return () => legacy.removeListener?.(handler);
    }
    return;
  }, []);

  const resolvedTheme = resolveTheme(theme, systemDark);

  // 解決後のテーマを <html> へ反映 (auto は OS 変化で自動再計算される)
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
