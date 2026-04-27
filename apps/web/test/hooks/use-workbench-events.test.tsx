// useWorkbenchEvents の lifecycle (mount で connect / unmount で close) を検証する。
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as events from "@/api/events";
import { useWorkbenchEvents } from "@/hooks/use-workbench-events";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkbenchEvents()", () => {
  it("初回 render で connectWorkbenchEvents() を 1 回だけ呼ぶ", () => {
    const close = vi.fn();
    const subscribe = vi.fn(() => () => {});
    const spy = vi
      .spyOn(events, "connectWorkbenchEvents")
      .mockReturnValue({ subscribe, close });

    const { rerender } = renderHook(() => useWorkbenchEvents());
    rerender();
    rerender();

    // lazy initializer は初回のみ走る
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("unmount で stream.close() を呼ぶ", () => {
    const close = vi.fn();
    const subscribe = vi.fn(() => () => {});
    vi.spyOn(events, "connectWorkbenchEvents").mockReturnValue({ subscribe, close });

    const { unmount } = renderHook(() => useWorkbenchEvents());
    expect(close).not.toHaveBeenCalled();
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("返り値は connectWorkbenchEvents の戻り値そのもの (subscribe / close を露出)", () => {
    const close = vi.fn();
    const subscribe = vi.fn(() => () => {});
    const stream = { subscribe, close };
    vi.spyOn(events, "connectWorkbenchEvents").mockReturnValue(stream);

    const { result } = renderHook(() => useWorkbenchEvents());
    expect(result.current).toBe(stream);
    expect(typeof result.current.subscribe).toBe("function");
    expect(typeof result.current.close).toBe("function");
  });
});
