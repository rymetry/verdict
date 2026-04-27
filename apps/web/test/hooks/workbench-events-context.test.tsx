// WorkbenchEventsProvider / useWorkbenchEventStream の振る舞いを pin する。
// Provider 不在時の throw (silent fallback 防止) と provider 経由の取得を確認する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

import type { EventStream } from "@/api/events";
import {
  WorkbenchEventsProvider,
  useWorkbenchEventStream
} from "@/hooks/workbench-events-context";

afterEach(() => cleanup());

const fakeStream: EventStream = {
  subscribe: () => () => {},
  subscribeState: () => () => {},
  getState: () => "open",
  close: () => {}
};

function Inner({ onStream }: { onStream: (s: EventStream) => void }): React.ReactElement {
  const stream = useWorkbenchEventStream();
  onStream(stream);
  return <span data-testid="resolved" />;
}

describe("WorkbenchEventsProvider / useWorkbenchEventStream", () => {
  it("Provider 経由なら stream を返す", () => {
    let captured: EventStream | undefined;
    render(
      <WorkbenchEventsProvider stream={fakeStream}>
        <Inner onStream={(s) => (captured = s)} />
      </WorkbenchEventsProvider>
    );
    expect(screen.getByTestId("resolved")).toBeInTheDocument();
    expect(captured).toBe(fakeStream);
  });

  it("Provider 不在では throw する (silent fallback 防止)", () => {
    // React は render 中の throw を Error Boundary に拾わせる前提だが、本テストでは
    // Inner が直接 throw するのでテスト framework が catch する。
    // console.error スパムを抑えるため、コンソールを抑制する (テスト失敗ではない正常 throw)。
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      render(<Inner onStream={() => {}} />);
    }).toThrow(/WorkbenchEventsProvider/);
    consoleErrorSpy.mockRestore();
  });
});
