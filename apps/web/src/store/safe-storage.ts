// localStorage への安全アクセス層。
// - Safari Private Mode / Storage 容量超過 / 値域外 などで throw した場合でも
//   UI を白画面にせず、既知の値域だけ受け取れるようにする。
// - 値域チェック (guard) は呼び出し側から差し込むことで、key ごとに異なる validation を許容する。
import { isDev } from "./env";

/** 開発ビルド時のみ握り潰した例外を console.warn する */
function warnDev(scope: string, error: unknown): void {
  if (isDev) {
    // eslint-disable-next-line no-console -- 開発時の診断目的に限定
    console.warn(`[safe-storage] ${scope}`, error);
  }
}

/** localStorage に格納された string 値が型 T に属するかを判定する guard */
type StringGuard<T extends string> = (value: unknown) => value is T;

/**
 * 値域チェック付きで localStorage の string 値を読む。
 * - storage が存在しない / throw する / 値域外 / null の何れでも `null` を返す。
 */
export function readGuarded<T extends string>(
  key: string,
  guard: StringGuard<T>
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return guard(raw) ? raw : null;
  } catch (error) {
    warnDev(`localStorage.getItem("${key}") failed (Private Mode 等)`, error);
    return null;
  }
}

/**
 * localStorage に string 値を書き込む。
 * - storage が存在しない / Quota 超過 / Private Mode で throw しても黙って無視する。
 *   呼び出し側で永続化失敗を理由に UI を壊してはいけない。
 */
export function writeSafe(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    warnDev(`localStorage.setItem("${key}") failed (Quota 超過 等)`, error);
  }
}
