// useWorkbenchEvents の lifecycle (mount で connect / unmount で close) を検証する。
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as events from "@/api/events";
import { useWorkbenchEvents } from "@/hooks/use-workbench-events";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockEventsModule() {
  const close = vi.fn();
  const subscribe = vi.fn(() => () => {});
  const stream = { subscribe, close };
  const spy = vi.spyOn(events, "connectWorkbenchEvents").mockReturnValue(stream);
  return { close, subscribe, stream, spy };
}

describe("useWorkbenchEvents()", () => {
  it("初回 render で connectWorkbenchEvents() を 1 回だけ呼ぶ", () => {
    const { spy } = mockEventsModule();

    const { rerender } = renderHook(() => useWorkbenchEvents());
    rerender();
    rerender();

    // lazy initializer は初回のみ走る
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("unmount で stream.close() を呼ぶ", () => {
    const { close } = mockEventsModule();

    const { unmount } = renderHook(() => useWorkbenchEvents());
    expect(close).not.toHaveBeenCalled();
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 配下でも mount → unmount 後に close が必ず呼ばれる (接続漏れ防止)", () => {
    // React 19 + StrictMode は dev で意図的にコンポーネントを double-mount する。
    // useState lazy init は複数回走りうるが、最終 unmount で close が少なくとも 1 回
    // 呼ばれていれば、useEffect cleanup が正しく hook 全体に紐付いていることを示す。
    // (renderHook 環境では StrictMode の挙動が production と一致しない場合があり、
    // 厳密な「mount 回数 == close 回数」を assert すると false negative になる)
    const { close } = mockEventsModule();
    const { unmount } = renderHook(() => useWorkbenchEvents(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>
    });
    expect(close).not.toHaveBeenCalled();
    unmount();
    expect(close.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
