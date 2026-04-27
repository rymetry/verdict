// useAppStore に紐付く副作用 (永続化 / matchMedia 連動 / <html> 反映) のハブ。
// React tree の外で 1 回だけ install することで:
//  * Provider のネストを回避し、view router (γ) を後から差し込んでも影響しない
//  * `useAppStore.setState` 経由 (HMR / test) の更新でも localStorage 書き出しが走る invariant を維持
//  * <html> への class / data 属性反映を idempotent な代入だけで完結させる
// なお `useAppStore.subscribe` は selector を取らないため**全 state 変化**で listener が発火する。
// theme-effects は idempotent なので実害は無いが、η 以降に store の field が増えた段階で
// `subscribeWithSelector` または equality 判定を追加して無関係な変更を弾くこと。
import {
  selectResolvedTheme,
  THEME_STORAGE_KEY,
  useAppStore,
  type ResolvedTheme,
  type ThemePreference
} from "./app-store";
import { writeSafe } from "./safe-storage";

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
 * 1. 現在の解決テーマを <html> に同期反映 (bootstrap script の値を最新で上書き確認)
 * 2. store の theme 変化を localStorage へ persist
 * 3. store の theme / systemDark 変化を <html> へ反映
 * 4. OS の prefers-color-scheme 変化を `setSystemDark` へディスパッチ
 *
 * 戻り値: 全 subscription を解除する cleanup 関数 (主にテスト向け)。
 * 片方の unsubscribe が throw しても残りを確実に解除するため try/finally で連鎖する。
 */
export function installThemeEffects(): () => void {
  if (typeof window === "undefined") return () => {};

  // 1. 初回反映 (bootstrap script が同期で先に当てるが、selector の最新値で再確認)
  const initial = useAppStore.getState();
  applyDocumentTheme(selectResolvedTheme(initial), initial.theme);

  // 2-3. store 変化 → 永続化 + <html> 反映
  let lastPersistedTheme: ThemePreference = initial.theme;
  const unsubscribeStore = useAppStore.subscribe((state) => {
    if (state.theme !== lastPersistedTheme) {
      writeSafe(THEME_STORAGE_KEY, state.theme);
      lastPersistedTheme = state.theme;
    }
    applyDocumentTheme(selectResolvedTheme(state), state.theme);
  });

  // 4. matchMedia 変化 → setSystemDark
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
    // 片方の unsubscribe が throw しても残りを必ず呼ぶ
    try {
      unsubscribeStore();
    } finally {
      unsubscribeMedia();
    }
  };
}
