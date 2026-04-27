// アプリ全域で共有する選好状態 (η 時点では theme + 派生 systemDark のみ)。
// - persona / agent state はビュー router (γ) と一緒に追加する想定で本ストアに足場だけ用意する。
// - localStorage 永続化は zustand persist middleware ではなく theme-effects 側の subscribe で行う:
//   index.html の同期 FOUC bootstrap script が `pwqa-theme` を flat string で読むため、
//   persist middleware が要求する `{ state, version }` ラップ形式と衝突する。
//   さらに subscribe ベースにすることで `useAppStore.setState({ theme })` 経路 (HMR や test) でも
//   永続化が走る invariant が保てる。setTheme 内では state 更新だけを行う。
// - <html> への反映と matchMedia 監視も副作用のため store の外 (theme-effects.ts) に置く。
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { isDev } from "./env";
import { readGuarded } from "./safe-storage";

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

function warnSystemDarkFailure(error: unknown): void {
  if (isDev) {
    // eslint-disable-next-line no-console -- 開発時の診断目的に限定
    console.warn("[useAppStore] matchMedia(prefers-color-scheme) failed", error);
  }
}

/** OS のダークモード設定を read-once で取得する (subscribe は theme-effects 側) */
function readSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (error) {
    // matchMedia が無効なクエリで throw する古環境を安全に処理
    warnSystemDarkFailure(error);
    return false;
  }
}

interface AppStateShape {
  /** ユーザー選好値 (永続化対象。永続化は theme-effects の subscribe 経由) */
  theme: ThemePreference;
  /** OS の prefers-color-scheme 状態。auto モードでのみ参照される */
  systemDark: boolean;
}

interface AppActions {
  /** 選好値を更新する。永続化は store 外の subscribe が担う */
  setTheme: (next: ThemePreference) => void;
  /**
   * `systemDark` を更新する。matchMedia change ハンドラから呼ばれることを想定した
   * 半内部 setter (Zustand の `setState` 経由でも書き換え可能なため public action として公開)。
   */
  setSystemDark: (next: boolean) => void;
}

export type AppStore = AppStateShape & AppActions;

/**
 * 初期 state を計算する純粋関数 (毎回 storage / matchMedia を再評価して返す)。
 * テストでは `setState(...)` の引数として呼んで store を初期状態へ戻すのに使う。
 */
export function computeInitialAppState(): AppStateShape {
  return {
    theme: readGuarded(THEME_STORAGE_KEY, isThemePreference) ?? "auto",
    systemDark: readSystemDark()
  };
}

export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      ...computeInitialAppState(),
      setTheme: (next) => {
        set({ theme: next }, false, "app/setTheme");
      },
      setSystemDark: (next) => {
        set({ systemDark: next }, false, "app/setSystemDark");
      }
    }),
    { name: "AppStore", enabled: isDev }
  )
);

/**
 * `resolveTheme` を state に当てて返す selector。
 * 戻り値は string literal (`"light" | "dark"`) なので Zustand の Object.is 比較で
 * 自動的に再レンダリング抑止が効く (selector reference の memoize は不要)。
 */
export const selectResolvedTheme = (s: AppStore): ResolvedTheme =>
  resolveTheme(s.theme, s.systemDark);
