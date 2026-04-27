// connectWorkbenchEvents の WebSocket lifecycle と接続状態 (connecting/open/disconnected) を pin する。
// jsdom の WebSocket は実際には接続せず、global を fake socket で差し替える。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectWorkbenchEvents, type WsConnectionState } from "@/api/events";

interface FakeSocket {
  url: string;
  listeners: Record<string, ((event: unknown) => void)[]>;
  addEventListener: (type: string, fn: (event: unknown) => void) => void;
  removeEventListener: (type: string, fn: (event: unknown) => void) => void;
  close: () => void;
  fire: (type: string, event?: unknown) => void;
}

let createdSockets: FakeSocket[] = [];

class FakeWebSocketClass implements FakeSocket {
  url: string;
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    createdSockets.push(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners[type] ??= [];
    this.listeners[type]?.push(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }
  close(): void {
    this.fire("close", { code: 1000 });
  }
  fire(type: string, event: unknown = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

beforeEach(() => {
  createdSockets = [];
  vi.useFakeTimers();
  // jsdom の WebSocket を差し替える。jsdom デフォルト URL (`http://localhost/`) で
  // WebSocket constructor は動作するため、location は触らない (jsdom で host は read-only)。
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: FakeWebSocketClass as unknown as typeof WebSocket
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connectWorkbenchEvents", () => {
  it("初期状態は connecting → open イベントで open に遷移する", () => {
    const stream = connectWorkbenchEvents();
    const seen: WsConnectionState[] = [];
    const unsub = stream.subscribeState((s) => seen.push(s));
    expect(seen).toEqual(["connecting"]);

    const socket = createdSockets[0];
    expect(socket).toBeDefined();
    socket?.fire("open");
    expect(seen).toEqual(["connecting", "open"]);
    expect(stream.getState()).toBe("open");
    unsub();
    stream.close();
  });

  it("close イベントで disconnected に遷移し reconnect timer を仕掛ける", () => {
    const stream = connectWorkbenchEvents();
    const seen: WsConnectionState[] = [];
    stream.subscribeState((s) => seen.push(s));
    createdSockets[0]?.fire("open");
    createdSockets[0]?.fire("close");
    expect(seen).toContain("disconnected");
    expect(stream.getState()).toBe("disconnected");

    // 1500ms 後に reconnect 試行
    vi.advanceTimersByTime(1500);
    expect(createdSockets.length).toBe(2);
    stream.close();
  });

  it("schema 不一致 message は console.error し listener には流さない", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = connectWorkbenchEvents();
    const events: unknown[] = [];
    stream.subscribe((e) => events.push(e));
    createdSockets[0]?.fire("message", { data: JSON.stringify({ totally: "wrong" }) });
    expect(events).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
    stream.close();
  });

  it("不正 JSON は console.error し listener には流さない", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = connectWorkbenchEvents();
    const events: unknown[] = [];
    stream.subscribe((e) => events.push(e));
    createdSockets[0]?.fire("message", { data: "{not json" });
    expect(events).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
    stream.close();
  });

  it("有効な event は listener に届く", () => {
    const stream = connectWorkbenchEvents();
    const events: unknown[] = [];
    stream.subscribe((e) => events.push(e));
    createdSockets[0]?.fire("message", {
      data: JSON.stringify({
        type: "run.stdout",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "hello\n" }
      })
    });
    expect(events).toHaveLength(1);
    stream.close();
  });

  it("close() で closed フラグを立て reconnect は走らない", () => {
    const stream = connectWorkbenchEvents();
    stream.close();
    vi.advanceTimersByTime(2000);
    // close 直後は createdSockets[0] のみ。再接続が走らないことを確認 (tab 切替で WS が湧かない不変条件)。
    expect(createdSockets.length).toBe(1);
  });

  it("error イベントは socket.close() を経由して disconnected に至る", () => {
    const stream = connectWorkbenchEvents();
    const seen: WsConnectionState[] = [];
    stream.subscribeState((s) => seen.push(s));
    createdSockets[0]?.fire("open");
    createdSockets[0]?.fire("error");
    // error → close (FakeWebSocket.close は close を fire) → disconnected
    expect(seen).toContain("disconnected");
    stream.close();
  });

  it("subscribeState はサブスクライブ時に現在値を 1 回 push する", () => {
    const stream = connectWorkbenchEvents();
    createdSockets[0]?.fire("open");
    const seen: WsConnectionState[] = [];
    const unsub = stream.subscribeState((s) => seen.push(s));
    expect(seen).toEqual(["open"]);
    unsub();
    stream.close();
  });

  it("close → reconnect 後の 2 つ目 socket でも open に再遷移する", () => {
    const stream = connectWorkbenchEvents();
    const seen: WsConnectionState[] = [];
    stream.subscribeState((s) => seen.push(s));
    createdSockets[0]?.fire("open");
    createdSockets[0]?.fire("close");
    vi.advanceTimersByTime(1500);
    // 2 つ目の socket が open すれば再び "open" が出る (StatusBar が緑に戻る invariant)
    createdSockets[1]?.fire("open");
    expect(seen).toEqual(["connecting", "open", "disconnected", "connecting", "open"]);
    stream.close();
  });

  it("error 経路でも 1500ms 後に reconnect が走る", () => {
    const stream = connectWorkbenchEvents();
    createdSockets[0]?.fire("open");
    createdSockets[0]?.fire("error");
    vi.advanceTimersByTime(1500);
    expect(createdSockets.length).toBe(2);
    stream.close();
  });

  it("event listener が throw しても他 listener には event が届く (isolation)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = connectWorkbenchEvents();
    const events: unknown[] = [];
    stream.subscribe(() => {
      throw new Error("listener bug");
    });
    stream.subscribe((event) => {
      events.push(event);
    });
    createdSockets[0]?.fire("message", {
      data: JSON.stringify({
        type: "run.stdout",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "hello\n" }
      })
    });
    expect(events).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    stream.close();
  });

  it("JSON.parse('null') は schema validation で error 化する (silent drop しない)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = connectWorkbenchEvents();
    const events: unknown[] = [];
    stream.subscribe((e) => events.push(e));
    createdSockets[0]?.fire("message", { data: "null" });
    expect(events).toHaveLength(0);
    // JSON.parse 自体は成功するため "JSON parse failed" ではなく schema mismatch 経路で log される
    expect(consoleSpy).toHaveBeenCalledWith(
      "[events] WS event schema mismatch",
      expect.anything()
    );
    stream.close();
  });
});
