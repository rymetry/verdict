// useAppStore の theme / systemDark を <html> へ反映する副作用ハブ。
// - React の effect ではなく vanilla subscribe で実装する。これにより:
//   * StrictMode の二重 mount で document が乱れない (idempotent)
//   * matchMedia → store dispatch の経路を React tree から独立させ、
//     view router (γ) 導入時に Provider のネストが要らなくなる
// - main.tsx の起動時に installThemeEffects() を 1 回だけ呼ぶ。
//   返り値の cleanup 関数は通常使わないが、テストで生存管理するために露出する。
import { selectResolvedTheme, useAppStore, type ResolvedTheme, type ThemePreference } from "./app-store";

/** <html> への class / data 属性反映 (テストから直接呼べるよう export) */
export function applyDocumentTheme(resolved: ResolvedTheme, preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  // shadcn/ui 慣用: `.dark` クラスでダークモードを判定
  html.classList.toggle("dark", resolved === "dark");
  // 視覚的診断 / E2E 検証用の hint 属性
  html.dataset.theme = resolved;
  html.dataset.themePreference = preference;
}

/** matchMedia の addEventListener / 古 Safari の addListener を吸収する subscribe ヘルパ */
function subscribeMediaQuery(
  mql: MediaQueryList,
  handler: (event: MediaQueryListEvent) => void
): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  // 古 Safari (< 14) は addListener しか持たない
  const legacy = mql as unknown as {
    addListener?: (h: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (h: (event: MediaQueryListEvent) => void) => void;
  };
  if (typeof legacy.addListener === "function") {
    legacy.addListener(handler);
    return () => legacy.removeListener?.(handler);
  }
  // どちらも無い環境では subscribe 不能 (no-op cleanup)
  return () => {};
}

/**
 * テーマ関連の副作用を一括 install する。
 * 1. 現在の解決テーマを <html> に同期反映
 * 2. store の theme / systemDark 変化を subscribe して <html> を更新
 * 3. OS の prefers-color-scheme 変化を subscribe して store.setSystemDark を呼ぶ
 *
 * 戻り値: 全 subscription を解除する cleanup 関数 (主にテスト向け)
 */
export function installThemeEffects(): () => void {
  if (typeof window === "undefined") return () => {};

  // 1. 初回反映 (bootstrap script が同期で先に当てるが、selector の最新値で再確認)
  const initial = useAppStore.getState();
  applyDocumentTheme(selectResolvedTheme(initial), initial.theme);

  // 2. store の変化を subscribe → <html> 反映
  const unsubscribeStore = useAppStore.subscribe((state) => {
    applyDocumentTheme(selectResolvedTheme(state), state.theme);
  });

  // 3. matchMedia 変化を subscribe → setSystemDark
  let unsubscribeMedia: () => void = () => {};
  if (typeof window.matchMedia === "function") {
    try {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      unsubscribeMedia = subscribeMediaQuery(mql, (event) => {
        useAppStore.getState().setSystemDark(event.matches);
      });
    } catch {
      // matchMedia が無効クエリで throw する環境は OS 追従不可で確定。
      // 既に store の初期値に systemDark=false が入っているのでそのまま。
    }
  }

  return () => {
    unsubscribeStore();
    unsubscribeMedia();
  };
}
