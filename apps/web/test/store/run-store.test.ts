// useRunStore の actions と reset 挙動を検証する。
import type { RunRequest } from "@pwqa/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createInitialRunState, useRunStore } from "@/store/run-store";

const sampleRequest: RunRequest = {
  projectId: "proj-1",
  specPath: "tests/auth.spec.ts",
  grep: undefined,
  headed: false
};

beforeEach(() => {
  useRunStore.setState(createInitialRunState());
});

describe("useRunStore (initial state)", () => {
  it("activeRunId / lastRequest は null で開始する", () => {
    const state = useRunStore.getState();
    expect(state.activeRunId).toBeNull();
    expect(state.lastRequest).toBeNull();
  });
});

describe("useRunStore.startTracking()", () => {
  it("activeRunId と lastRequest を同時にセットする", () => {
    useRunStore.getState().startTracking("run-42", sampleRequest);
    const state = useRunStore.getState();
    expect(state.activeRunId).toBe("run-42");
    expect(state.lastRequest).toEqual(sampleRequest);
  });

  it("以前の lastRequest を上書きする (再実行で違うリクエスト)", () => {
    useRunStore.getState().startTracking("run-1", sampleRequest);
    const next: RunRequest = { ...sampleRequest, grep: "@smoke" };
    useRunStore.getState().startTracking("run-2", next);
    expect(useRunStore.getState().lastRequest).toEqual(next);
    expect(useRunStore.getState().activeRunId).toBe("run-2");
  });

  it("runId が空文字なら illegal state として throw する", () => {
    expect(() => useRunStore.getState().startTracking("", sampleRequest)).toThrow(
      /runId は空でない文字列/
    );
    // store は初期状態のままで汚染されない
    expect(useRunStore.getState().activeRunId).toBeNull();
    expect(useRunStore.getState().lastRequest).toBeNull();
  });
});

describe("useRunStore (state shape invariants)", () => {
  it("state の非関数フィールドは activeRunId / lastRequest の 2 つだけ", () => {
    // RunStatus 等を将来追加する判断時に本テストが落ちて議論が起こることを期待した invariant
    const state = useRunStore.getState() as unknown as Record<string, unknown>;
    const dataFields = Object.keys(state).filter((k) => typeof state[k] !== "function");
    expect(dataFields.sort()).toEqual(["activeRunId", "lastRequest"]);
  });
});

describe("useRunStore.clearActive()", () => {
  it("activeRunId のみ null に戻す (lastRequest は残す)", () => {
    useRunStore.getState().startTracking("run-9", sampleRequest);
    useRunStore.getState().clearActive();
    const state = useRunStore.getState();
    expect(state.activeRunId).toBeNull();
    // 再実行のため直近リクエストは保持しておきたい
    expect(state.lastRequest).toEqual(sampleRequest);
  });
});

describe("createInitialRunState()", () => {
  it("毎回新しいオブジェクトを返す (immutable)", () => {
    const a = createInitialRunState();
    const b = createInitialRunState();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
