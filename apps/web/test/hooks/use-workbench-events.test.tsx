// useWorkbenchEvents の lifecycle (StrictMode-safe singleton) を検証する。
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as events from "@/api/events";
import {
  __resetWorkbenchEventsForTest,
  useWorkbenchEvents,
  useWsConnectionState
} from "@/hooks/use-workbench-events";

afterEach(() => {
  __resetWorkbenchEventsForTest();
  vi.restoreAllMocks();
});

function mockEventsModule() {
  const close = vi.fn();
  const subscribe = vi.fn(() => () => {});
  const subscribeState = vi.fn(() => () => {});
  const getState = vi.fn<() => events.WsConnectionState>(() => "connecting");
  const stream: events.EventStream = { subscribe, subscribeState, getState, close };
  const spy = vi.spyOn(events, "connectWorkbenchEvents").mockReturnValue(stream);
  return { close, subscribe, subscribeState, getState, stream, spy };
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

  it("unmount では stream.close() を呼ばない", () => {
    const { close } = mockEventsModule();

    const { unmount } = renderHook(() => useWorkbenchEvents());
    expect(close).not.toHaveBeenCalled();
    unmount();
    expect(close).not.toHaveBeenCalled();
  });

  it("StrictMode 配下でも singleton stream を cleanup で閉じない", () => {
    const { close, spy } = mockEventsModule();
    const { unmount } = renderHook(() => useWorkbenchEvents(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>
    });
    expect(close).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    expect(close).not.toHaveBeenCalled();
  });

  it("test reset で singleton stream を閉じる", () => {
    const { close } = mockEventsModule();
    renderHook(() => useWorkbenchEvents());
    __resetWorkbenchEventsForTest();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("useWsConnectionState()", () => {
  it("初期値は stream.getState() の戻り値", () => {
    const { stream, getState } = mockEventsModule();
    getState.mockReturnValue("connecting");
    const { result } = renderHook(() => useWsConnectionState(stream));
    expect(result.current).toBe("connecting");
  });

  it("subscribeState は useSyncExternalStore に渡る", () => {
    // useSyncExternalStore は (notify) => unsubscribe を期待する。useWsConnectionState 内では
    // (notify) => stream.subscribeState(() => notify()) のラップ呼び出しをする。
    // ここでは subscribeState が呼ばれることだけを pin (実際の re-render 検証は events.test.ts 側で)。
    const { stream, subscribeState } = mockEventsModule();
    renderHook(() => useWsConnectionState(stream));
    expect(subscribeState).toHaveBeenCalledTimes(1);
  });
});
