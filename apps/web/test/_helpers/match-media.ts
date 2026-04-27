// MediaQueryList mock の共通 factory。
// theme-effects と app-store のテストで shape が完全に重複していたため抽出。
import { vi } from "vitest";

/**
 * MediaQueryList の最小実装を返す。`overrides` で `matches` / `addEventListener` 等を
 * 個別テスト用に差し替えられる。
 */
export function createMediaQueryListMock(
  overrides: Partial<MediaQueryList> = {}
): MediaQueryList {
  return {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    ...overrides
  } as unknown as MediaQueryList;
}
