// アプリ全域で共有する選好状態 (PoC 段階では theme + 派生 systemDark のみ)。
// - persona / agent state はビュー router (γ) と一緒に追加する想定で本ストアに足場だけ用意する。
// - localStorage への永続化は zustand persist middleware ではなく自前で行う:
//   index.html の同期 FOUC 抑止 bootstrap script が `pwqa-theme` の "flat string" 形式を
//   読むため、persist middleware が要求する `{ state, version }` ラップ形式と衝突する。
//   既存のキー形式を維持するために自前 read/write を採用する。
// - matchMedia 監視と <html> への反映は副作用のため store の外 (theme-effects) で行う。
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { readGuarded, writeSafe } from "./safe-storage";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "pwqa-theme";

const VALID_PREFERENCES: ReadonlyArray<ThemePreference> = ["light", "dark", "auto"];

/**
 * `ThemePreference` の値域 guard。外部 (ToggleGroup など) でも値検証に利用する。
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && VALID_PREFERENCES.includes(value as ThemePreference);
}

/**
 * theme 選好と OS 設定から実際に適用するテーマを決める純粋関数。
 * auto モードでは OS の prefers-color-scheme に従い、それ以外は選好値そのまま。
 */
export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (theme === "auto") return systemDark ? "dark" : "light";
  return theme;
}

/** OS のダークモード設定を読む (SSR / matchMedia 未実装 / throw 時は false) */
function readSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // matchMedia が無効なクエリで throw する古環境を安全に処理
    return false;
  }
}

interface AppStateShape {
  /** ユーザー選好値 (永続化対象) */
  theme: ThemePreference;
  /** OS の prefers-color-scheme 状態。auto モードでのみ参照される */
  systemDark: boolean;
}

interface AppActions {
  /** 選好を更新し localStorage へ反映する */
  setTheme: (next: ThemePreference) => void;
  /** matchMedia の change イベントから呼ばれる内部用 setter */
  setSystemDark: (next: boolean) => void;
}

export type AppStore = AppStateShape & AppActions;

/**
 * 初期化用ファクトリ (テストから呼んで初期 state を再構築できるよう露出)。
 * - localStorage から theme を復元 (不正値は "auto" フォールバック)
 * - matchMedia から systemDark を読む
 */
export function computeInitialAppState(): AppStateShape {
  return {
    theme: readGuarded(THEME_STORAGE_KEY, isThemePreference) ?? "auto",
    systemDark: readSystemDark()
  };
}

const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      ...computeInitialAppState(),
      setTheme: (next) => {
        // 永続化に失敗しても state は更新する (UI を白画面にしない)
        writeSafe(THEME_STORAGE_KEY, next);
        set({ theme: next }, false, "app/setTheme");
      },
      setSystemDark: (next) => {
        set({ systemDark: next }, false, "app/setSystemDark");
      }
    }),
    { name: "AppStore", enabled: isDev }
  )
);

/** selector: resolveTheme を state に当てて返す (selector 同一性を保つため呼び出し側で memoize 不要) */
export const selectResolvedTheme = (s: AppStore): ResolvedTheme =>
  resolveTheme(s.theme, s.systemDark);
